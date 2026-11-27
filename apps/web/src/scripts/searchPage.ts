/**
 * Search (pages/search.astro), to the 12 Nov canvas and the flow spec's Search rules. Before typing:
 * what you opened from results lately, topic tiles with covers from each topic's chart, and the top
 * shows. From two letters, after a short pause: shows that match, the newest episodes of the best
 * match, and the Catchups the page holds (libraryPage.ts searches those as the field changes).
 */
import { syncSearchClear } from "@singularityfm/design-system/searchField";
import type { ShowRow } from "../server/podcasts/shapes";
import {
  drawRows,
  episodeRow,
  listCover,
  type PodcastRow,
  rowOf,
  searchShows,
  showEpisodes,
  showRow,
  trending,
} from "./podcastRows";

/** Results start at two letters (the route's own floor), after this pause. */
const MIN_LETTERS = 2;
const PAUSE_MS = 300;
const TOP_SHOWS = 5;
const SHOW_RESULTS = 20;
const EPISODE_RESULTS = 5;
const RECENT_KEY = "singularity:search-recent";
const RECENT_MAX = 6;

/** A stored row is drawn only whole and pointing inside the app; anything else is dropped. */
function isRow(row: unknown): row is PodcastRow {
  const item = row as Partial<PodcastRow> | null;
  return (
    typeof item?.href === "string" &&
    item.href.startsWith("/") &&
    !item.href.startsWith("//") &&
    typeof item.title === "string" &&
    typeof item.facts === "string" &&
    (item.cover === null || typeof item.cover === "string")
  );
}

function readRecent(): PodcastRow[] {
  try {
    const rows = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]") as unknown;
    return Array.isArray(rows) ? rows.filter(isRow).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(rows: PodcastRow[]): void {
  try {
    if (rows.length === 0) localStorage.removeItem(RECENT_KEY);
    else localStorage.setItem(RECENT_KEY, JSON.stringify(rows.slice(0, RECENT_MAX)));
  } catch {
    // Not remembered; the search still works.
  }
}

/** A show's link or feed (first run thread's contract): Add a show resolves it, not search. */
function isShowLink(text: string): boolean {
  return /^(https?|feed|pcast|podcast):/i.test(text) || /^[\w-]+(\.[\w-]+)+\/\S*$/.test(text);
}

/** Words the episode's title holds all of, as the Library matches. */
function hasWords(text: string, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const lower = text.toLowerCase();
  return words.every((word) => lower.includes(word));
}

function install(): void {
  const pageFound = document.querySelector<HTMLElement>("[data-search-page]");
  if (!pageFound || pageFound.dataset.ready !== undefined) return;
  const page: HTMLElement = pageFound;
  page.dataset.ready = "";
  const one = <T extends HTMLElement>(selector: string): T | null =>
    page.querySelector<T>(selector);
  const field = one<HTMLInputElement>("[data-library-search]");
  const discoverPart = one("[data-discover]");
  const resultsPart = one("[data-results]");
  if (!field || !discoverPart || !resultsPart) return;
  const input: HTMLInputElement = field;
  const discover: HTMLElement = discoverPart;
  const results: HTMLElement = resultsPart;
  const recent = one("[data-recent]");
  const recentList = one("[data-recent-list]");
  const top = one("[data-top]");
  const topList = one("[data-top-list]");
  const showsList = one("[data-shows-list]");
  const episodesList = one("[data-episodes-list]");
  const note = one("[data-results-note]");
  const status = one("[data-results-status]");
  const chips = [...page.querySelectorAll<HTMLInputElement>("[data-kind]")];
  const section = (kind: string) => one(`[data-section="${kind}"]`);

  // ---------------------------------------------------------------- before typing

  function drawRecent(): void {
    const rows = readRecent();
    if (recent) recent.hidden = rows.length === 0;
    if (recentList) drawRows(recentList, rows);
  }
  drawRecent();
  one("[data-recent-clear]")?.addEventListener("click", () => {
    writeRecent([]);
    drawRecent();
    input.focus();
  });

  // Each tile shows up to three covers from its topic's chart; a topic that does not answer keeps its name.
  for (const tile of page.querySelectorAll<HTMLAnchorElement>("[data-topic]")) {
    void trending(tile.dataset.topic).then((shows) => {
      const covers = (shows ?? []).flatMap((show) => (show.cover ? [show.cover] : [])).slice(0, 3);
      for (const src of covers) {
        const image = document.createElement("img");
        image.alt = "";
        image.loading = "lazy";
        image.src = listCover(src);
        tile.append(image);
      }
    });
  }

  void trending().then((shows) => {
    const rows = (shows ?? []).flatMap((show) => showRow(show) ?? []).slice(0, TOP_SHOWS);
    if (!top || !topList || rows.length === 0) return;
    drawRows(topList, rows);
    top.hidden = false;
  });

  // A result opened is remembered, newest first, once.
  results.addEventListener("click", (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("[data-podcast-list] a");
    if (!link) return;
    const row = rowOf(link);
    if (!row) return;
    writeRecent([row, ...readRecent().filter((kept) => kept.href !== row.href)]);
  });

  // ---------------------------------------------------------------- typing

  let asked = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let found = { shows: 0, episodes: 0 };
  /** Whether the shows' search failed for the words asked; null until it answers. */
  let failed: boolean | null = null;

  /** Which sections show: the ticked chip's, or every one with something in it. The count is said
   *  only once the shows have answered, so a keystroke never announces the last word's total. */
  function showSections(announce = true): void {
    const chosen = chips.find((chip) => chip.checked)?.value;
    const catchups = page.querySelectorAll("[data-search-only] [data-card]:not([hidden])").length;
    const counts: Record<string, number> = { ...found, catchups };
    for (const kind of ["shows", "episodes", "catchups"]) {
      const element = section(kind);
      if (element) element.hidden = (chosen !== undefined && chosen !== kind) || counts[kind] === 0;
    }
    const total = chosen ? (counts[chosen] ?? 0) : found.shows + found.episodes + catchups;
    if (status && announce) status.textContent = total === 0 ? "No results" : `${total} results`;
    // Once the shows have answered, the note says why the page is empty: a failure, or no match.
    if (note && failed !== null) {
      note.hidden = !failed && total > 0;
      note.textContent = failed
        ? "Search did not answer. Try again in a minute."
        : "Nothing matches these words. Try fewer, or other ones.";
    }
  }

  async function ask(term: string): Promise<void> {
    asked = term;
    const shows = await searchShows(term);
    if (asked !== term) return;
    const showRows = (shows ?? []).flatMap((show: ShowRow) => showRow(show) ?? []);
    if (showsList) drawRows(showsList, showRows.slice(0, SHOW_RESULTS));
    found = { shows: Math.min(showRows.length, SHOW_RESULTS), episodes: 0 };
    // The shows show now; the best match's episodes join them when they arrive.
    failed = shows === null;
    showSections(false);
    // The index cannot search every episode of every show: the best match's newest, those that
    // hold the words first (flow spec, Episodes chip).
    const best = shows?.find((show) => show.id !== null);
    if (best?.id != null) {
      const episodes = await showEpisodes(best.id);
      if (asked !== term) return;
      const ordered = [
        ...(episodes ?? []).filter((episode) => hasWords(episode.title, term)),
        ...(episodes ?? []).filter((episode) => !hasWords(episode.title, term)),
      ].slice(0, EPISODE_RESULTS);
      if (episodesList)
        drawRows(
          episodesList,
          ordered.map((episode) => episodeRow(episode, best.cover)),
        );
      found.episodes = ordered.length;
    } else episodesList?.replaceChildren();
    failed = shows === null;
    showSections();
  }

  /** Hands a link to Add a show, which reads ?link= and resolves it at once. */
  function addShow(link: string): void {
    location.assign(`/add-show?${new URLSearchParams({ link })}`);
  }

  /** The words in the address, so Back from a result brings them back (with or without Catchups). */
  function keepWords(term: string): void {
    const url = new URL(location.href);
    if (term) url.searchParams.set("q", term);
    else url.searchParams.delete("q");
    if (url.href !== location.href) history.replaceState(history.state, "", url);
  }

  function apply(event?: Event): void {
    const term = input.value.trim();
    keepWords(term);
    // A pasted link goes straight on; one typed waits for the Search key, so "http" mid-word never
    // jumps. Until then the page shows discover, not the results of the link's first letters.
    if (isShowLink(term)) {
      clearTimeout(timer);
      asked = "";
      failed = null;
      if (note) note.hidden = true;
      discover.hidden = false;
      results.hidden = true;
      if ((event as InputEvent | undefined)?.inputType === "insertFromPaste") addShow(term);
      return;
    }
    // New words disown the request in flight, so its late answer never lands under them.
    if (term !== asked) {
      asked = "";
      failed = null;
      if (note) note.hidden = true;
    }
    const typing = term.length >= MIN_LETTERS;
    discover.hidden = typing;
    results.hidden = !typing;
    clearTimeout(timer);
    if (!typing) {
      asked = "";
      found = { shows: 0, episodes: 0 };
      showsList?.replaceChildren();
      episodesList?.replaceChildren();
      return;
    }
    // The Catchups answer at once, from the page; the shows after the pause.
    requestAnimationFrame(() => showSections(false));
    if (asked === "") timer = setTimeout(() => void ask(term), PAUSE_MS);
  }

  input.addEventListener("input", apply);
  // The Catchups' search ran again (its full-text index arrived): count and say them anew.
  page.addEventListener("library:applied", () => {
    if (!results.hidden && asked === input.value.trim()) showSections();
  });
  // Enter would reload the page; the keyboard's Search key puts the keyboard away over the results,
  // or hands a link to Add a show.
  one("[data-search-form]")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const term = input.value.trim();
    if (isShowLink(term)) addShow(term);
    else input.blur();
  });
  for (const chip of chips) {
    chip.addEventListener("change", () => {
      for (const other of chips) if (other !== chip) other.checked = false;
      showSections();
    });
  }
  // Back from a result keeps the words (keepWords writes ?q=).
  const start = new URLSearchParams(location.search).get("q");
  if (start) {
    input.value = start;
    syncSearchClear(input);
  }
  apply();
}

document.addEventListener("astro:page-load", install);
install();
