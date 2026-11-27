/**
 * A public show's page (pages/show.astro): draws the show from the device, then from the show
 * route, and keeps every row in step with the player. The rules it follows are one file
 * (podcasts/rules.ts), so this page, the dial and the player answer "new", "played" and "what does
 * Play start" the same way.
 */
import { installSearchClear, syncSearchClear } from "@singularityfm/design-system/searchField";
import { sendToast } from "@singularityfm/design-system/toastEvent";
import { whenIdle } from "../narration/prewarmPage";
import { safeLocalStorage, setPlayed, setPlayedAll } from "../player/core/resume";
import { heardOnDevice } from "../podcasts/after";
import { getEpisode, setEpisodeFavorite, setShowFavorite } from "../podcasts/deviceStore";
import { coverAt } from "../podcasts/episodeDigest";
import { loadPlayer, nowPlaying, onPlayerChange, pressPlay, queueEpisode } from "../podcasts/play";
import {
  type Following,
  type HeardOf,
  isNewEpisode,
  pickPlay,
  showEpisodeUrl,
  showIdOf,
} from "../podcasts/rules";
import { fetchShow, storedShow } from "../podcasts/shows";
import { dayLabel, matchesSearch, timeFact } from "../podcasts/view";
import type { EpisodeRow, ShowDetail } from "../server/podcasts/shapes";

/** How many rows one draw adds: a show can hold a thousand episodes, and a page that many menus. */
const PAGE = 50;

interface View {
  show: ShowDetail;
  /** Newest first, as the route and the device give them. */
  episodes: EpisodeRow[];
  following: Following | null;
  lastId: string | null;
  /** The long list has been asked for, so a search covers the whole show. */
  whole: boolean;
  /** How many matching rows are drawn. */
  shown: number;
}

const pluralEpisodes = (count: number): string =>
  `${count.toLocaleString("en")} ${count === 1 ? "episode" : "episodes"}`;

function install(): void {
  const page = document.querySelector<HTMLElement>("[data-show-page]");
  if (!page || page.dataset.ready !== undefined) return;
  const root = page;
  root.dataset.ready = "";
  const showId = Number(new URLSearchParams(location.search).get("id"));
  const part = <T extends HTMLElement>(name: string): T | null =>
    root.querySelector<T>(`[data-show-${name}]`);
  const body = part("body");
  const list = part<HTMLUListElement>("episodes");
  const rowTemplate = root.querySelector<HTMLTemplateElement>("template[data-show-episode]");
  const newTemplate = root.querySelector<HTMLTemplateElement>("template[data-show-new]");
  if (!body || !list || !rowTemplate) return;

  const storage = safeLocalStorage();
  const heardOf: HeardOf = heardOnDevice(storage);
  const search = root.querySelector<HTMLInputElement>("input[data-show-search]");
  const unplayed = root.querySelector<HTMLInputElement>("input[data-show-unplayed]");
  const sortHost = part("sort");
  const sort = sortHost?.matches("select")
    ? (sortHost as unknown as HTMLSelectElement)
    : (sortHost?.querySelector("select") ?? null);
  const play = part<HTMLButtonElement>("play");
  const heart = part<HTMLButtonElement>("favorite");
  const status = part("status");
  // The page's listeners end with the page: the document outlives it (client-side navigation).
  const life = new AbortController();
  const on = { signal: life.signal };
  document.addEventListener("astro:before-swap", () => life.abort(), { once: true });

  let view: View | null = null;
  const rows = new Map<string, HTMLElement>();
  const byId = (id: string | undefined): EpisodeRow | undefined =>
    view?.episodes.find((episode) => episode.id === id);

  const show = (state: "ready" | "missing" | "failed"): void => {
    root.dataset.state = state;
    root.removeAttribute("aria-busy");
    body.hidden = state !== "ready";
    const missing = part("missing");
    const failed = part("failed");
    if (missing) missing.hidden = state !== "missing";
    if (failed) {
      failed.hidden = state !== "failed";
      // Try again asks for this same show.
      failed
        .querySelector<HTMLAnchorElement>("[data-astro-reload]")
        ?.setAttribute("href", location.pathname + location.search);
    }
  };

  if (!Number.isSafeInteger(showId) || showId <= 0) {
    show("missing");
    return;
  }

  /* ------------------------------------------------------------------ the header */

  /** This show's episode in the player, if one is. */
  function playingHere(): EpisodeRow | undefined {
    const current = nowPlaying()?.id;
    return current && showIdOf(current) === showId ? byId(current) : undefined;
  }

  /** The episode the header's Play acts on: the one from this show in the player, else the rules' pick. */
  function playTarget(): { episode: EpisodeRow; reason: string } | null {
    if (!view) return null;
    const playing = playingHere();
    if (playing) return { episode: playing, reason: "current" };
    return pickPlay(view.show, view.episodes, view.following, heardOf, view.lastId);
  }

  function paintPlay(): void {
    if (!play) return;
    const target = playTarget();
    if (!target) {
      play.setAttribute("aria-disabled", "true");
      play.setAttribute("aria-label", "Play");
      return;
    }
    play.removeAttribute("aria-disabled");
    const { episode, reason } = target;
    const now = nowPlaying();
    const sounding = now?.id === episode.id && now.playing;
    play.dataset.state = now?.id === episode.id ? "current" : "idle";
    play.dataset.playing = String(sounding);
    const left = timeFact(episode.duration_s, heardOf(episode.id));
    const name = sounding
      ? `Pause ${episode.title}`
      : reason === "current" || reason === "resume"
        ? `Resume ${episode.title}${left ? `, ${left}` : ""}`
        : reason === "new"
          ? `Play the next new episode: ${episode.title}`
          : reason === "first"
            ? `Play the first episode: ${episode.title}`
            : `Play the latest episode: ${episode.title}`;
    if (play.getAttribute("aria-label") !== name) play.setAttribute("aria-label", name);
  }

  function paintHeader(): void {
    if (!view) return;
    const { show: detail } = view;
    const title = part("title");
    if (title) title.textContent = detail.title;
    document.title = `${detail.title}, Singularity`;
    const facts = part("facts");
    if (facts) {
      const count = detail.episode_count ?? view.episodes.length;
      facts.replaceChildren(
        ...[detail.author, count > 0 ? pluralEpisodes(count) : ""].filter(Boolean).map((text) => {
          const span = document.createElement("span");
          span.textContent = text;
          return span;
        }),
      );
    }
    const cover = part<HTMLImageElement>("cover");
    if (cover && detail.cover) {
      const src = coverAt(detail.cover, 512);
      if (cover.getAttribute("src") !== src) {
        cover.srcset = `${coverAt(detail.cover, 256)} 256w, ${src} 512w`;
        cover.sizes = "(width < 40rem) 60vw, 16rem";
        cover.src = src;
      }
      cover.hidden = false;
    }
    heart?.setAttribute("aria-pressed", String(view.following !== null));
    const menuTitle = root.querySelector("#show-menu-title");
    if (menuTitle) menuTitle.textContent = detail.title;
    const site = root.querySelector<HTMLElement>('[data-show-action="site"]');
    if (site) site.hidden = !detail.link;
    const about = part("about");
    const description = part("description");
    const more = part<HTMLButtonElement>("about-more");
    if (about && description) {
      about.hidden = !detail.description;
      if (description.textContent !== detail.description) {
        description.textContent = detail.description;
        // More only where three lines do not hold it all.
        if (more) more.hidden = description.scrollHeight <= description.clientHeight + 1;
      }
    }
    paintPlay();
  }

  /* ------------------------------------------------------------------ the rows */

  function paintRow(row: HTMLElement, episode: EpisodeRow): void {
    const heard = heardOf(episode.id);
    const now = nowPlaying();
    const current = now?.id === episode.id;
    const fresh = isNewEpisode(episode, view?.following ?? null, heard);
    row.toggleAttribute("data-played", heard.played);
    const facts = row.querySelector<HTMLElement>("[data-episode-facts]");
    if (facts) {
      const words = [
        dayLabel(episode.published_at, new Date()),
        timeFact(episode.duration_s, heard),
        episode.kind === "trailer" ? "Trailer" : episode.kind === "bonus" ? "Bonus" : "",
      ].filter(Boolean);
      const key = `${fresh ? "new " : ""}${words.join("|")}`;
      if (facts.dataset.key !== key) {
        facts.dataset.key = key;
        const spans = words.map((text) => {
          const span = document.createElement("span");
          span.textContent = text;
          return span;
        });
        // New stands after the day and the time (owner, 2026-11-26), before a Trailer or Bonus word.
        const mark = fresh ? newTemplate?.content.firstElementChild?.cloneNode(true) : null;
        if (mark) spans.splice(2, 0, mark as HTMLSpanElement);
        facts.replaceChildren(...spans);
      }
    }
    const chip = row.querySelector<HTMLElement>("[data-episode-play]");
    if (chip) {
      const sounding = current && now.playing;
      chip.dataset.state = current ? "current" : heard.played ? "played" : "idle";
      chip.dataset.playing = String(sounding);
      const verb = sounding
        ? "Pause"
        : heard.played
          ? "Play again"
          : heard.seconds > 0
            ? "Resume"
            : "Play";
      const name = `${verb} ${episode.title}`;
      if (chip.getAttribute("aria-label") !== name) chip.setAttribute("aria-label", name);
    }
    const label = row.querySelector<HTMLElement>('[data-pick="played"] [data-menu-label]');
    if (label) label.textContent = heard.played ? "Mark as unplayed" : "Mark as played";
  }

  let serial = 0;
  function buildRow(episode: EpisodeRow): HTMLElement | null {
    const row = rowTemplate?.content.firstElementChild?.cloneNode(true);
    if (!(row instanceof HTMLElement)) return null;
    row.dataset.episode = episode.id;
    const link = row.querySelector<HTMLAnchorElement>(".show-episode-link");
    if (link) link.href = showEpisodeUrl(episode.id);
    const title = row.querySelector("[data-episode-title]");
    if (title) title.textContent = episode.title;
    // Each row's menu is its own popover, hung under its own dots.
    const menu = row.querySelector<HTMLElement>("[popover]");
    const more = row.querySelector<HTMLElement>("[data-hero-more]");
    const holder = row.querySelector<HTMLElement>("[data-row-menu]");
    if (menu && more && holder) {
      const id = `episode-menu-${++serial}`;
      menu.id = id;
      more.setAttribute("popovertarget", id);
      more.setAttribute("aria-label", `More actions for ${episode.title}`);
      holder.style.setProperty("--card-anchor", `--${id}`);
      const heading = menu.querySelector("h2");
      if (heading) {
        heading.id = `${id}-title`;
        heading.textContent = episode.title;
      }
      menu.querySelector('[role="menu"]')?.setAttribute("aria-label", episode.title);
    }
    paintRow(row, episode);
    return row;
  }

  function matching(): EpisodeRow[] {
    if (!view) return [];
    const query = search?.value.trim() ?? "";
    const only = unplayed?.checked ?? false;
    const found = view.episodes.filter(
      (episode) =>
        (!query || matchesSearch(episode, query)) && (!only || !heardOf(episode.id).played),
    );
    return sort?.value === "oldest" ? found.reverse() : found;
  }

  /** Draws the list again from the top: the first page of what matches. */
  function drawList(keep = PAGE): void {
    if (!view) return;
    const found = matching();
    view.shown = Math.min(Math.max(keep, PAGE), found.length);
    const page = found.slice(0, view.shown);
    // The same episodes in the same order (the route answering what the device already held): the
    // rows stay, so an open row menu, the focus and a finger's hold are not torn away.
    const same =
      page.length === rows.size && [...rows.keys()].every((id, at) => page[at]?.id === id);
    if (same) paintRows();
    else {
      rows.clear();
      const drawn: HTMLElement[] = [];
      for (const episode of page) {
        const row = buildRow(episode);
        if (!row) continue;
        rows.set(episode.id, row);
        drawn.push(row);
      }
      list?.replaceChildren(...drawn);
    }
    const filtered = Boolean(search?.value.trim()) || Boolean(unplayed?.checked);
    const none = part("none");
    if (none) {
      none.hidden = found.length > 0;
      const message = part("none-message");
      if (message)
        message.textContent = filtered ? "No episodes match." : "This show has no episodes yet.";
      const clear = part("clear");
      if (clear) clear.hidden = !filtered;
    }
    const total = view.show.episode_count ?? 0;
    const more = part("more");
    // More to draw, or more on the server than the first answer held.
    if (more)
      more.hidden = !(found.length > view.shown || (!view.whole && total > view.episodes.length));
    if (status && filtered) status.textContent = `${pluralEpisodes(found.length)} found`;
  }

  const paintRows = (): void => {
    for (const [id, row] of rows) {
      const episode = byId(id);
      if (episode) paintRow(row, episode);
    }
    paintPlay();
  };

  /* ------------------------------------------------------------------ reading */

  /** What the device holds now, with `fallback` where it holds nothing (no database here). */
  async function read(fallback?: { show: ShowDetail; episodes: EpisodeRow[] }): Promise<boolean> {
    const stored = await storedShow(showId);
    // The reader left while the device answered: the next page is not ours to draw on.
    if (life.signal.aborted) return true;
    const source = stored ?? fallback;
    if (!source) return false;
    view = {
      show: source.show,
      episodes: source.episodes,
      following: stored?.show.favorite_at
        ? { favorite_at: stored.show.favorite_at, newest_id: stored.show.newest_id }
        : null,
      lastId: stored?.show.last_episode_id ?? null,
      whole: view?.whole ?? false,
      shown: view?.shown ?? PAGE,
    };
    show("ready");
    paintHeader();
    drawList(view.shown);
    return true;
  }

  const toldInOrder = (): boolean => view?.show.order === "serial";
  let asking: Promise<boolean> | null = null;
  /**
   * Asks for the whole show once: a search, oldest first, Mark all, or a show told in order (whose
   * Play starts at its first episode, not at the oldest of the newest page) means all of it. False
   * when the whole list could not be had.
   */
  function readWhole(): Promise<boolean> {
    if (!view) return Promise.resolve(false);
    if (view.whole) return Promise.resolve(true);
    asking ??= fetchShow(showId, true).then(async (answer) => {
      asking = null;
      if (typeof answer === "string" || !view) return false;
      view.whole = true;
      await read(answer);
      return true;
    });
    return asking;
  }

  void (async () => {
    const held = await read();
    const answer = await fetchShow(showId);
    if (life.signal.aborted) return;
    if (typeof answer !== "string") await read(answer);
    else if (!held) show(answer === "not_found" ? "missing" : "failed");
    if (toldInOrder()) void readWhole();
  })();

  /* ------------------------------------------------------------------ presses */

  const refuse = (): void =>
    sendToast({ message: "This episode can't be played here", kind: "error" });

  /**
   * The header's Play. A show told in order starts at its first unplayed episode, which is in the
   * whole list, not in its newest page: the press waits for that list, and says so when it cannot
   * be had, in place of starting somewhere in the middle.
   */
  async function playShow(): Promise<void> {
    if (toldInOrder() && !playingHere() && !(await readWhole())) {
      if (!life.signal.aborted)
        sendToast({ message: "Couldn't load every episode. Try again.", kind: "error" });
      return;
    }
    const pick = playTarget();
    if (pick && !pressPlay(pick.episode)) refuse();
  }

  async function act(action: string, episode: EpisodeRow): Promise<void> {
    if (action === "played") {
      setPlayed(storage, episode.id, !heardOf(episode.id).played);
      return;
    }
    if (action === "favorite") {
      const next = !(await getEpisode(episode.id))?.favorite_at;
      await setEpisodeFavorite(episode.id, next);
      // The device's own answer: a private window keeps nothing.
      const kept = Boolean((await getEpisode(episode.id))?.favorite_at);
      if (kept === next)
        sendToast({ message: next ? "Added to favorites" : "Removed from favorites" });
      else sendToast({ message: "Couldn't change favorites on this device", kind: "error" });
      return;
    }
    if (action === "share") {
      await shareLink(episode.title, new URL(showEpisodeUrl(episode.id), location.origin).href);
      return;
    }
    const where = action === "next" ? "next" : "last";
    const added = await queueEpisode(episode, where);
    sendToast({
      message: added
        ? where === "next"
          ? "Playing next"
          : "Added to the queue"
        : "Already in the queue",
    });
  }

  async function markAll(): Promise<void> {
    // The whole show, not only the newest page of it.
    if (!(await readWhole()) || !view) {
      // Marking only the newest page would say "all" and leave the older ones unplayed.
      sendToast({ message: "Couldn't load every episode. Try again.", kind: "error" });
      return;
    }
    const marked = view.episodes.filter((episode) => !heardOf(episode.id).played);
    if (marked.length === 0) {
      sendToast({ message: "Every episode is already played" });
      return;
    }
    const ids = marked.map((episode) => episode.id);
    setPlayedAll(storage, ids, true);
    sendToast({
      message: `${pluralEpisodes(marked.length)} marked as played`,
      actionLabel: "Undo",
      // Undo gives back "unplayed"; a position inside an episode is not kept.
      onAction: () => {
        setPlayedAll(storage, ids, false);
      },
    });
  }

  async function shareLink(title: string, url: string): Promise<void> {
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        sendToast({ message: "Link copied" });
      }
    } catch {
      // Closed without sharing: nothing to say.
    }
  }

  async function shareShow(): Promise<void> {
    if (view) await shareLink(view.show.title, location.href);
  }

  async function toggleFavorite(): Promise<void> {
    if (!view) return;
    const favorite = view.following === null;
    const newest = view.episodes.find((episode) => episode.kind === "full")?.id ?? null;
    await setShowFavorite(showId, favorite, newest);
    await read();
    const kept = (view.following !== null) === favorite;
    sendToast(
      kept
        ? { message: favorite ? "Added to favorites" : "Removed from favorites" }
        : { message: "Couldn't change favorites on this device", kind: "error" },
    );
  }

  // A row's sheet says whether its episode is a favorite once it opens: the list does not hold it.
  root.addEventListener(
    "toggle",
    (event) => {
      const row = (event.target as Element).closest<HTMLElement>("[data-episode]");
      const id = row?.dataset.episode;
      if (!row || !id || (event as ToggleEvent).newState !== "open") return;
      void getEpisode(id).then((stored) => {
        const saved = Boolean(stored?.favorite_at);
        row.toggleAttribute("data-saved", saved);
        const label = row.querySelector('[data-pick="favorite"] [data-menu-label]');
        if (label) label.textContent = saved ? "Unfavorite" : "Favorite";
      });
    },
    { capture: true, signal: life.signal },
  );

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element;
      const row = target.closest<HTMLElement>("[data-episode]");
      const episode = byId(row?.dataset.episode);
      if (episode && target.closest("[data-episode-play]")) {
        if (!pressPlay(episode)) refuse();
        return;
      }
      const picked = target.closest<HTMLElement>("[data-pick]");
      if (episode && picked?.dataset.pick) {
        void act(picked.dataset.pick, episode);
        return;
      }
      if (target.closest("[data-show-play]")) {
        void playShow();
      } else if (target.closest("[data-show-favorite]")) void toggleFavorite();
      else if (target.closest("[data-show-share]")) void shareShow();
      else if (target.closest('[data-show-action="mark-all"]')) void markAll();
      else if (target.closest('[data-show-action="site"]')) {
        if (view?.show.link) window.open(view.show.link, "_blank", "noopener");
      } else if (target.closest("[data-show-about-more]")) {
        const description = part("description");
        const more = part("about-more");
        const open = description?.toggleAttribute("data-clamped") === false;
        if (more) {
          more.setAttribute("aria-expanded", String(open));
          more.textContent = open ? "Less" : "More";
        }
      } else if (target.closest("[data-show-clear]")) {
        if (search) {
          search.value = "";
          syncSearchClear(search);
        }
        if (unplayed) unplayed.checked = false;
        drawList();
      } else if (target.closest("[data-show-all]")) {
        if (!view) return;
        const next = view.shown + PAGE;
        if (matching().length > view.shown) drawList(next);
        else void readWhole().then(() => drawList(next));
      }
    },
    on,
  );

  const filter = (): void => {
    drawList();
    // A search, and the oldest episodes, are in the whole show, not its newest fifty.
    if (search?.value.trim() || sort?.value === "oldest") void readWhole();
  };
  search?.addEventListener("input", filter, on);
  unplayed?.addEventListener("change", filter, on);
  sort?.addEventListener("change", filter, on);

  // A position kept, an episode finished or marked: its row and the header's Play say so.
  // With Unplayed chosen, one that has just become played leaves the list, and the count follows.
  window.addEventListener(
    "singularity:resume",
    () => (unplayed?.checked ? drawList(view?.shown) : paintRows()),
    on,
  );
  void onPlayerChange(paintRows).then((off) => {
    if (life.signal.aborted) off();
    else life.signal.addEventListener("abort", off, { once: true });
    paintRows();
  });
  void loadPlayer();
}

installSearchClear();
// The menus open by themselves (native popovers); their keys, and a finger's hold on a row, are not
// needed to draw the page, so they load once it is idle and stay out of its first load (D361).
whenIdle(() => {
  void import("./heroMenu").then((menu) => menu.installHeroMenu());
  void import("./cardHold").then((hold) => hold.installCardHold());
});
document.addEventListener("astro:page-load", install);
install();
