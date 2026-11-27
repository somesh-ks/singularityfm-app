/**
 * Home (components/HomeView.astro, 12 Nov canvas): draws what only the device knows into the page
 * the server sent. The speed dial (the Catchups' tiles and every favorite show's), Continue
 * listening, the new episodes of the shows followed, a trending shelf, the chips that narrow all of
 * it, and the long press menus of the dial, the resume cards and the show rows. The rules are one
 * file each (podcasts/rules.ts, podcasts/home.ts), so Home, a show's page and the player agree.
 */
import { DIAL_SELECTORS as DIAL } from "@singularityfm/design-system/dial";
import { installPageArrows } from "@singularityfm/design-system/pageDots";
import { RESUME_CARD_SELECTORS as RESUME } from "@singularityfm/design-system/resumeCard";
import { sendToast } from "@singularityfm/design-system/toastEvent";
import { whenIdle } from "../narration/prewarmPage";
import { readRemembered, safeLocalStorage, setPlayed } from "../player/core/resume";
import { heardOnDevice } from "../podcasts/after";
import { continueIds, dropContinue, readContinue } from "../podcasts/continueListening";
import {
  episodesOfShow,
  favoriteShows,
  followingOf,
  getEpisode,
  getShow,
  PODCASTS_CHANGED_EVENT,
  type StoredEpisode,
  type StoredShow,
  saveEpisodes,
  setEpisodeDismissed,
  setEpisodeFavorite,
  setShowFavorite,
  setShowHidden,
  setShowPinned,
} from "../podcasts/deviceStore";
import { dialOrder, dialPages, type HomeFilter, shownBy } from "../podcasts/home";
import { loadPlayer, nowPlaying, onPlayerChange, pressPlay, queueEpisode } from "../podcasts/play";
import {
  isNewEpisode,
  isShowEpisodeId,
  newCount,
  pickPlay,
  showEpisodeUrl,
  showIdOf,
  showUrl,
} from "../podcasts/rules";
import { fetchShow } from "../podcasts/shows";
import { dayLabel, lengthLabel, timeFact } from "../podcasts/view";
import type { EpisodeRow, ShowRow } from "../server/podcasts/shapes";
import { holdOpens, installCardHold } from "./cardHold";
import { newSince, trending } from "./podcastRows";

/** From here the dial is one row of six that scrolls sideways (the side column's width). */
const WIDE = "(width >= 64rem)";
/** How many new episodes Home lists; See all opens the shows in the Library. */
const NEW_SHOWN = 4;
const TRENDING_TOPIC = "Technology";

type Held =
  | { sheet: "dial"; kind: "show"; showId: number; tile: HTMLElement }
  | { sheet: "dial"; kind: "catchup"; id: string; href: string; tile: HTMLElement }
  | { sheet: "resume"; id: string; href: string };

function install(): void {
  const found = document.querySelector<HTMLElement>("[data-home]");
  if (!found || found.dataset.ready !== undefined) return;
  const root = found;
  root.dataset.ready = "";
  const life = new AbortController();
  const on = { signal: life.signal };
  document.addEventListener("astro:before-swap", () => life.abort(), { once: true });

  const storage = safeLocalStorage();
  const heardOf = heardOnDevice(storage);
  const q = <T extends Element = HTMLElement>(selector: string): T | null =>
    root.querySelector<T>(selector);
  const template = (name: string): HTMLElement | null => {
    const host = q<HTMLTemplateElement>(`template[${name}]`);
    return (host?.content.firstElementChild?.cloneNode(true) as HTMLElement | null) ?? null;
  };
  let serial = 0;
  /** A cloned row's menu gets an id of its own, and its dots point at it. */
  const ownMenu = (row: HTMLElement, title: string): void => {
    const menu = row.querySelector<HTMLElement>("[popover]");
    const more = row.querySelector<HTMLElement>("[data-hero-more]");
    if (!menu || !more) return;
    menu.id = `home-menu-${++serial}`;
    more.setAttribute("popovertarget", menu.id);
    // Hung under its own dots on desktop (library.css), as showPage.ts does for a show's rows.
    row.querySelector<HTMLElement>("[data-row-menu]")?.style.setProperty("--card-anchor", `--${menu.id}`);
    const heading = menu.querySelector("h2");
    if (heading) heading.textContent = title;
    more.setAttribute("aria-label", `More actions for ${title}`);
  };

  /* ------------------------------------------------------------------ the speed dial */

  const pagesHost = q("[data-home-dial-pages]");
  const dots = q(".home-dial-dots");
  // The Catchups' tiles came with the page: they are kept and laid out with the shows'.
  // DialTile hands its data attributes to its press area: the tile (what the dial lays out) takes
  // them too, so every tile is read one way.
  const catchupTiles = [
    ...root.querySelectorAll<HTMLElement>(`${DIAL.hit}[data-home-kind="catchup"]`),
  ]
    .map((hit) => {
      const tile = hit.closest<HTMLElement>(DIAL.tile);
      if (tile) Object.assign(tile.dataset, hit.dataset);
      return tile;
    })
    .filter((tile): tile is HTMLElement => tile !== null);
  let dialTiles: HTMLElement[] = [...catchupTiles];

  /** "New" on a Catchup's tile until it is heard to the end. */
  const paintCatchupBadges = (): void => {
    for (const tile of catchupTiles) {
      const count = tile.querySelector<HTMLElement>(DIAL.count);
      if (count) count.hidden = heardOf(tile.dataset.homeId ?? "").played;
    }
  };

  /** Each favorite on the dial with its count of new episodes. */
  async function dialShows(): Promise<Array<{ show: StoredShow; count: number }>> {
    const shows = (await favoriteShows()).filter((show) => show.hidden_at === null);
    return Promise.all(
      shows.map(async (show) => {
        const episodes = await episodesOfShow(show.id);
        const dismissed = new Set(episodes.filter((e) => e.dismissed).map((e) => e.id));
        return { show, count: newCount(episodes, followingOf(show), heardOf, dismissed) };
      }),
    );
  }

  function showTiles(entries: ReadonlyArray<{ show: StoredShow; count: number }>): HTMLElement[] {
    return entries.map(({ show, count }) => {
      const tile = template("data-home-dial-template") ?? document.createElement("li");
      tile.dataset.homeShow = String(show.id);
      tile.dataset.homeAuthor = show.author;
      tile.dataset.homeAt = show.newest_at ?? "";
      if (show.pinned_at) tile.dataset.homePinned = show.pinned_at;
      const hit = tile.querySelector<HTMLElement>(DIAL.hit);
      hit?.setAttribute(
        "aria-label",
        count > 0 ? `Play ${show.title}, ${count} new` : `Play ${show.title}`,
      );
      const name = tile.querySelector(DIAL.name);
      if (name) name.textContent = show.title;
      const img = tile.querySelector("img");
      if (img && show.cover) img.src = show.cover;
      if (!show.pinned_at) tile.querySelector(DIAL.pin)?.remove();
      const badge = tile.querySelector<HTMLElement>(DIAL.count);
      if (badge) {
        // The Badge inside the count holds the number.
        const label = badge.firstElementChild ?? badge;
        if (count > 0) label.textContent = String(count);
        else badge.remove();
      }
      return tile;
    });
  }

  /** Nine a page with dots under them on the phone, one sideways row with arrows on desktop. */
  function layoutDial(): void {
    if (!pagesHost) return;
    const ordered = dialOrder(
      dialTiles.map((tile) => ({
        tile,
        first: tile.dataset.homeFirst !== undefined,
        pinnedAt: tile.dataset.homePinned ?? null,
        newestAt: tile.dataset.homeAt || null,
      })),
    ).map((entry) => entry.tile);
    // A tile a chip leaves out takes no place in a page, so no page shows a hole.
    const shown = ordered.filter((tile) => !tile.hasAttribute("data-home-out"));
    const wide = matchMedia(WIDE).matches;
    const pages = wide ? [shown] : dialPages(shown);
    const lists = pages.map((tiles) => {
      const list = template(wide ? "data-home-dial-wide-template" : "data-home-dial-page-template");
      if (!list) return document.createElement("ul");
      list.replaceChildren(...tiles);
      return list;
    });
    // Tiles left out stay in the document so a chip can bring them back.
    const parked = ordered.filter((tile) => tile.hasAttribute("data-home-out"));
    lists.at(-1)?.append(...parked);
    pagesHost.replaceChildren(...lists);
    pagesHost.dataset.paged = String(!wide && pages.length > 1);
    if (dots) {
      const count = wide ? 1 : pages.length;
      dots.hidden = count <= 1;
      dots.replaceChildren(
        ...Array.from({ length: count }, (_, page) => {
          const dot = document.createElement("span");
          if (page === 0) dot.setAttribute("aria-current", "true");
          return dot;
        }),
      );
      dots.setAttribute("aria-label", `Page 1 of ${count}`);
    }
    q<HTMLElement>("[data-home-dial-section]")?.toggleAttribute("hidden", shown.length === 0);
    paintPlaying();
  }

  pagesHost?.addEventListener(
    "scroll",
    () => {
      if (!dots || dots.hidden || !pagesHost.clientWidth) return;
      const page = Math.round(pagesHost.scrollLeft / pagesHost.clientWidth);
      const all = [...dots.children];
      all.forEach((dot, at) => {
        if (at === page) dot.setAttribute("aria-current", "true");
        else dot.removeAttribute("aria-current");
      });
      dots.setAttribute("aria-label", `Page ${page + 1} of ${all.length}`);
    },
    { passive: true, ...on },
  );
  matchMedia(WIDE).addEventListener("change", layoutDial, on);

  // A position is saved every few seconds while something plays (resume.ts), and each save asks for a
  // redraw: the dial is built again only when what it shows changed, so a focused tile, an open
  // sheet and the page in view stay as they are.
  let dialDrawn = "";
  async function drawDial(): Promise<void> {
    paintCatchupBadges();
    const entries = await dialShows();
    const drawn = JSON.stringify(
      entries.map(({ show, count }) => [show.id, count, show.pinned_at, show.title, show.cover]),
    );
    if (drawn === dialDrawn) return;
    dialDrawn = drawn;
    dialTiles = [...catchupTiles, ...showTiles(entries)];
    applyFilter();
    layoutDial();
  }

  /* ------------------------------------------------------------------ Continue listening */

  const resumeList = q("[data-home-resume]");
  const resumeSection = q("[data-home-resume-section]");

  const halfHeard = (id: string): boolean => {
    const heard = heardOf(id);
    return heard.seconds > 0 && !heard.played;
  };

  function paintResume(item: HTMLElement, total: number): void {
    const id = item.dataset.homeResumeId ?? "";
    const seconds = readRemembered(storage, id, total).seconds;
    const part = total > 0 ? Math.min(1, seconds / total) : 0;
    item
      .querySelector<HTMLElement>(RESUME.bar)
      ?.style.setProperty("--progress", `${Math.round(part * 100)}%`);
    const left = item.querySelector(RESUME.left);
    if (left) left.textContent = total > 0 ? `${lengthLabel(total - seconds)} left` : "";
  }

  async function drawResume(): Promise<void> {
    if (!resumeList || !resumeSection) return;
    const ids = continueIds(readContinue(storage), halfHeard);
    const items: HTMLElement[] = [];
    for (const id of ids) {
      if (isShowEpisodeId(id)) {
        const episode = await getEpisode(id);
        if (!episode) continue;
        const show = await getShow(episode.show_id);
        const item =
          resumeList.querySelector<HTMLElement>(`[data-home-resume-id="${CSS.escape(id)}"]`) ??
          template("data-home-resume-template");
        if (!item) continue;
        item.dataset.homeResumeId = id;
        item.dataset.homeHref = showEpisodeUrl(id);
        const title = item.querySelector(RESUME.title);
        if (title) title.textContent = episode.title;
        const facts = item.querySelector(RESUME.show);
        if (facts) facts.textContent = episode.show_title;
        const hit = item.querySelector(RESUME.hit);
        hit?.setAttribute("aria-label", `Resume ${episode.title}`);
        // A clone carries the template's description id: each card names its own, or a screen reader
        // reads every card's button with the first card's title and time left.
        const said = hit?.getAttribute("aria-describedby");
        const description = said ? item.querySelector(`[id="${CSS.escape(said)}"]`) : null;
        if (hit && description) {
          description.id = `home-resume-${++serial}`;
          hit.setAttribute("aria-describedby", description.id);
        }
        const img = item.querySelector("img");
        const cover = episode.cover ?? show?.cover ?? null;
        if (img && cover) img.src = cover;
        paintResume(item, episode.duration_s ?? 0);
        items.push(item);
      } else {
        const item = resumeList.querySelector<HTMLElement>(
          `[data-home-resume-id="${CSS.escape(id)}"]`,
        );
        if (!item) continue;
        paintResume(item, Number(item.dataset.homeSeconds) || 0);
        items.push(item);
      }
    }
    for (const item of resumeList.querySelectorAll<HTMLElement>("[data-home-resume-id]")) {
      item.hidden = !items.includes(item);
    }
    for (const item of items) item.hidden = false;
    // In the order heard, the one heard last first.
    resumeList.prepend(...items);
    resumeSection.hidden = items.length === 0;
    paintPlaying();
    applyFilter();
  }

  async function pressResume(item: HTMLElement): Promise<void> {
    const id = item.dataset.homeResumeId ?? "";
    if (isShowEpisodeId(id)) {
      const episode = await getEpisode(id);
      if (episode && !pressPlay(episode)) sendToast({ message: "This episode can't play here" });
      return;
    }
    await playCatchup(id, item.dataset.homeHref);
  }

  /** A Catchup plays from its page, as a cover's play does in a list (player/core/coverPress.ts). */
  async function playCatchup(id: string, href: string | undefined): Promise<void> {
    const [{ runtime }, cover] = await Promise.all([
      loadPlayer(),
      import("../player/core/coverPress"),
    ]);
    cover.pressCover({
      store: runtime.getPlayerStore(),
      // shortcut: a Catchup with no audio yet is not narrated on arrival from here; its page's Play
      // narrates it. Route through readerSync's onNarrate if Home ever lists one without audio.
      expectPage: () => {},
      id,
      href,
    });
  }

  /** A dial tile's press: the show's one Play (rules.ts, pickPlay), or the Catchup. */
  async function pressDial(tile: HTMLElement): Promise<void> {
    const showId = Number(tile.dataset.homeShow);
    if (!showId) {
      await playCatchup(tile.dataset.homeId ?? "", tile.dataset.homeHref);
      return;
    }
    const show = await getShow(showId);
    if (!show) return;
    let episodes = await episodesOfShow(showId);
    if (episodes.length === 0 && typeof (await fetchShow(showId)) === "object") {
      episodes = await episodesOfShow(showId);
    }
    const pick = pickPlay(show, episodes, followingOf(show), heardOf, show.last_episode_id);
    if (!pick) sendToast({ message: "This show has no episodes yet" });
    else if (!pressPlay(pick.episode)) sendToast({ message: "This episode can't play here" });
  }

  /* ------------------------------------------------------------------ New from your favorites */

  const newList = q("[data-home-new]");
  const newSection = q("[data-home-new-section]");

  function episodeRow(
    episode: StoredEpisode | EpisodeRow,
    show: StoredShow | null,
  ): HTMLElement | null {
    const row = template("data-home-episode-row");
    if (!row) return null;
    row.dataset.id = episode.id;
    row.dataset.homeEpisode = episode.id;
    row.querySelector("a")?.setAttribute("href", showEpisodeUrl(episode.id));
    const title = row.querySelector("[data-home-title]");
    if (title) title.textContent = episode.title;
    const facts = row.querySelector("[data-home-facts]");
    if (facts) {
      facts.textContent = [
        episode.show_title,
        dayLabel(episode.published_at, new Date()),
        timeFact(episode.duration_s, heardOf(episode.id)),
      ]
        .filter(Boolean)
        .join(" · ");
    }
    const img = row.querySelector("img");
    const cover = episode.cover ?? show?.cover ?? null;
    if (img && cover) img.src = cover;
    ownMenu(row, episode.title);
    paintFavorite(row, "favorite_at" in episode && episode.favorite_at !== null);
    return row;
  }

  let newDrawn = "";
  async function drawNew(): Promise<void> {
    if (!newList || !newSection) return;
    const shows = (await favoriteShows()).filter((show) => show.hidden_at === null);
    const fresh: Array<{ episode: StoredEpisode; show: StoredShow }> = [];
    for (const show of shows) {
      const following = followingOf(show);
      for (const episode of await episodesOfShow(show.id)) {
        // One half heard is on Continue listening already.
        if (halfHeard(episode.id)) continue;
        if (isNewEpisode(episode, following, heardOf(episode.id), episode.dismissed)) {
          fresh.push({ episode, show });
        }
      }
    }
    fresh.sort((a, b) =>
      (b.episode.published_at ?? "").localeCompare(a.episode.published_at ?? ""),
    );
    const picked = fresh.slice(0, NEW_SHOWN);
    // Rebuilt only when the list changed: an open row menu outlives the saves made while playing.
    const drawn = JSON.stringify(picked.map(({ episode }) => [episode.id, episode.favorite_at]));
    if (drawn === newDrawn) return;
    newDrawn = drawn;
    const rows = picked
      .map(({ episode, show }) => episodeRow(episode, show))
      .filter((row): row is HTMLElement => row !== null);
    newList.replaceChildren(...rows);
    newSection.hidden = rows.length === 0;
    applyFilter();
  }

  /** Asks the index once for every favorite's new episodes and keeps them on the device. */
  async function refreshNew(): Promise<void> {
    const shows = await favoriteShows();
    if (shows.length === 0) return;
    const since = Math.min(
      ...shows.map((show) => Date.parse(show.favorite_at ?? "") || Date.now()),
    );
    // The route takes at most NEW_MAX_SHOWS ids a call (server/podcasts/routes.ts).
    for (const batch of dialPages(
      shows.map((show) => show.id),
      200,
    )) {
      // Offline or refused: Home draws what the device holds.
      const episodes = await newSince(batch, Math.floor(since / 1000)).catch(() => null);
      if (episodes) await saveEpisodes(episodes);
    }
  }

  /* ------------------------------------------------------------------ Trending */

  const trendingList = q("[data-home-trending]");
  const trendingSection = q("[data-home-trending-section]");
  const trendingShows = new Map<number, ShowRow>();

  async function drawTrending(): Promise<void> {
    if (!trendingList || !trendingSection) return;
    // Offline, or the index down: the shelf stays away.
    const shows: ShowRow[] = (await trending(TRENDING_TOPIC)) ?? [];
    const cards: HTMLElement[] = [];
    for (const show of shows) {
      if (show.id === null) continue;
      const stored = await getShow(show.id);
      if (stored?.hidden_at) continue;
      trendingShows.set(show.id, show);
      const card = template("data-home-show-card");
      if (!card) continue;
      card.dataset.homeShow = String(show.id);
      card.querySelector("a")?.setAttribute("href", showUrl(show.id));
      const title = card.querySelector("[data-home-title]");
      if (title) title.textContent = show.title;
      const facts = card.querySelector("[data-home-facts]");
      if (facts) facts.textContent = show.author;
      const img = card.querySelector("img");
      if (img && show.cover) img.src = show.cover;
      ownMenu(card, show.title);
      paintFavorite(card, Boolean(stored?.favorite_at));
      paintPin(card, Boolean(stored?.pinned_at));
      cards.push(card);
    }
    trendingList.replaceChildren(...cards);
    trendingSection.hidden = cards.length === 0;
    applyFilter();
  }

  /** Each topic tile shows up to three covers from its topic's chart, as on Search. */
  function drawTopics(): void {
    for (const tile of root.querySelectorAll<HTMLAnchorElement>(
      "[data-home-topics] [data-topic]",
    )) {
      void trending(tile.dataset.topic).then((shows) => {
        const covers = (shows ?? [])
          .flatMap((show) => (show.cover ? [show.cover] : []))
          .slice(0, 3);
        for (const src of covers) {
          const image = document.createElement("img");
          image.alt = "";
          image.loading = "lazy";
          image.src = src;
          tile.append(image);
        }
      });
    }
  }

  /* ------------------------------------------------------------------ the chips */

  let filter: HomeFilter | "all" = "all";
  const chips = [...root.querySelectorAll<HTMLInputElement>("input[data-home-filter]")];

  function applyFilter(): void {
    root.dataset.filter = filter;
    let dialMoved = false;
    const things = root.querySelectorAll<HTMLElement>(
      `${DIAL.tile}, [data-home-resume-id], [data-home-new] > .card, [data-home-trending] > .card, [data-home-band] .card`,
    );
    for (const thing of things) {
      const kind =
        thing.closest<HTMLElement>("[data-home-kind]")?.dataset.homeKind === "show"
          ? "show"
          : "catchup";
      const id = thing.dataset.id ?? thing.dataset.homeResumeId ?? thing.dataset.homeId ?? "";
      const keep = shownBy(filter, {
        kind,
        played: id !== "" && heardOf(id).played,
        downloaded: thing.hasAttribute("data-downloaded"),
      });
      if (thing.hasAttribute("data-home-out") === keep) {
        thing.toggleAttribute("data-home-out", !keep);
        if (thing.matches(DIAL.tile)) dialMoved = true;
      }
    }
    if (dialMoved) layoutDial();
    // A section with nothing left to show steps aside, so the page never shows a bare heading.
    for (const section of root.querySelectorAll<HTMLElement>(
      "[data-home-dial-section], [data-home-resume-section], [data-home-new-section], [data-home-trending-section], [data-home-band]",
    )) {
      const items = [
        ...section.querySelectorAll<HTMLElement>(
          `${DIAL.tile}, [data-home-resume-id]:not([hidden]), .card`,
        ),
      ];
      section.toggleAttribute(
        "data-home-out",
        items.length > 0 && items.every((item) => item.hasAttribute("data-home-out")),
      );
    }
  }

  root.addEventListener(
    "change",
    (event) => {
      const chip = event.target as HTMLInputElement;
      if (!chip.matches("input[data-home-filter]")) return;
      // Single choice, as the Library's: ticking one unticks the others; unticking shows everything.
      for (const other of chips) if (other !== chip) other.checked = false;
      filter = chip.checked ? (chip.value as HomeFilter) : "all";
      applyFilter();
    },
    on,
  );

  /* ------------------------------------------------------------------ playing */

  function paintPlaying(): void {
    const now = nowPlaying();
    const id = now?.id ?? null;
    const showId = id ? showIdOf(id) : null;
    for (const tile of root.querySelectorAll<HTMLElement>(DIAL.tile)) {
      const playing =
        id !== null &&
        (tile.dataset.homeId === id ||
          (showId !== null && tile.dataset.homeShow === String(showId)));
      tile.dataset.playing = String(playing);
      const hit = tile.querySelector(DIAL.hit);
      if (playing) hit?.setAttribute("aria-current", "true");
      else hit?.removeAttribute("aria-current");
    }
    for (const item of root.querySelectorAll<HTMLElement>("[data-home-resume-id]")) {
      const sounding = id !== null && item.dataset.homeResumeId === id && Boolean(now?.playing);
      item.querySelector(RESUME.card)?.setAttribute("data-playing", String(sounding));
    }
  }

  /* ------------------------------------------------------------------ menus */

  function paintFavorite(row: HTMLElement, favorite: boolean): void {
    const pick = row.querySelector<HTMLElement>('[data-home-pick="favorite"]');
    if (!pick) return;
    pick.setAttribute("aria-checked", String(favorite));
    pick.dataset.on = String(favorite);
    const label = pick.querySelector("[data-menu-label]");
    if (label) label.textContent = favorite ? "Unfavorite" : "Favorite";
  }

  function paintPin(row: HTMLElement, pinned: boolean): void {
    const label = row.querySelector('[data-home-pick="pin"] [data-menu-label]');
    if (label) label.textContent = pinned ? "Unpin" : "Pin";
  }

  async function share(title: string, path: string): Promise<void> {
    const url = new URL(path, location.origin).href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else {
        await navigator.clipboard.writeText(url);
        sendToast({ message: "Link copied" });
      }
    } catch {
      // Closed without sharing.
    }
  }

  const go = (href: string): void => {
    void import("astro:transitions/client").then(({ navigate }) => navigate(href));
  };

  /** A show that is not on the device yet (a trending one) is read first: a heart needs its record. */
  async function ensureShow(showId: number): Promise<StoredShow | null> {
    const stored = await getShow(showId);
    if (stored) return stored;
    const answer = await fetchShow(showId);
    return typeof answer === "object" ? getShow(showId) : null;
  }

  async function newestId(showId: number): Promise<string | null> {
    const episodes = await episodesOfShow(showId);
    return episodes.find((episode) => episode.kind === "full")?.id ?? null;
  }

  /** A pick in a show card's or an episode row's own menu. */
  async function pickInRow(row: HTMLElement, pick: string): Promise<void> {
    const showIdText = row.dataset.homeShow;
    const episodeId = row.dataset.homeEpisode;
    if (showIdText) {
      const showId = Number(showIdText);
      const show = await ensureShow(showId);
      if (!show) {
        sendToast({ message: "Couldn't reach this show. Try again when you're online." });
        return;
      }
      if (pick === "favorite") {
        const favorite = show.favorite_at === null;
        await setShowFavorite(showId, favorite, await newestId(showId));
        paintFavorite(row, favorite);
        sendToast({ message: favorite ? "Added to favorites" : "Removed from favorites" });
      } else if (pick === "pin") {
        const pinned = show.pinned_at === null;
        // A pin is a place on the dial, and the dial holds favorites.
        if (pinned && show.favorite_at === null)
          await setShowFavorite(showId, true, await newestId(showId));
        await setShowPinned(showId, pinned);
        paintPin(row, pinned);
        sendToast({ message: pinned ? "Pinned to your speed dial" : "Unpinned" });
      } else if (pick === "share") await share(show.title, showUrl(showId));
      else if (pick === "show") go(showUrl(showId));
      else if (pick === "hide") {
        await setShowHidden(showId, true);
        row.remove();
        sendToast({
          message: "We'll show you less of this",
          actionLabel: "Undo",
          onAction: () => void setShowHidden(showId, false).then(drawTrending),
        });
      }
      return;
    }
    if (!episodeId) return;
    const episode = await getEpisode(episodeId);
    if (!episode) return;
    if (pick === "favorite") {
      const favorite = episode.favorite_at === null;
      await setEpisodeFavorite(episodeId, favorite);
      paintFavorite(row, favorite);
      sendToast({ message: favorite ? "Added to favorites" : "Removed from favorites" });
    } else if (pick === "queue") {
      const added = await queueEpisode(episode, "last");
      sendToast({ message: added ? "Added to queue" : "Already in the queue" });
    } else if (pick === "share") await share(episode.title, showEpisodeUrl(episodeId));
    else if (pick === "played") {
      setPlayed(storage, episodeId, true);
      sendToast({
        message: "Marked as played",
        actionLabel: "Undo",
        onAction: () => setPlayed(storage, episodeId, false),
      });
    } else if (pick === "show") go(showUrl(episode.show_id));
    else if (pick === "hide") {
      await setEpisodeDismissed(episodeId, true);
      sendToast({
        message: "Removed from new episodes",
        actionLabel: "Undo",
        onAction: () => void setEpisodeDismissed(episodeId, false),
      });
    }
  }

  /* The dial's and Continue listening's sheets: one each, filled for what was held. A finger holds
     the tile or card, a mouse right-clicks it and a keyboard presses the menu key (contextmenu). */
  let held: Held | null = null;
  const dialSheet = q<HTMLElement>("#home-dial-menu");
  const resumeSheet = q<HTMLElement>("#home-resume-menu");

  /** Fills the sheet for the tile or card held and returns it, ready to open. */
  function fillFor(target: Element): HTMLElement | null {
    // The sheet hangs under what was held where a mouse opens it (home.css).
    for (const old of root.querySelectorAll("[data-home-held]"))
      old.removeAttribute("data-home-held");
    target.setAttribute("data-home-held", "");
    const tile = target.closest<HTMLElement>(DIAL.tile);
    const resume = target.closest<HTMLElement>("[data-home-resume-id]");
    if (tile && dialSheet) {
      const showId = tile.dataset.homeShow;
      const title = tile.querySelector(DIAL.name)?.textContent ?? "";
      if (showId) {
        held = { sheet: "dial", kind: "show", showId: Number(showId), tile };
        fillSheet(dialSheet, title, tile.dataset.homeAuthor ?? "");
        paintPin(dialSheet, tile.dataset.homePinned !== undefined);
        showPicks(dialSheet, ["pin", "show", "share", "hide"]);
      } else {
        const href = tile.dataset.homeHref ?? "/library";
        held = { sheet: "dial", kind: "catchup", id: tile.dataset.homeId ?? "", href, tile };
        fillSheet(
          dialSheet,
          title,
          tile
            .querySelector(DIAL.hit)
            ?.getAttribute("aria-label")
            ?.replace(/^[^,]*, /, "") ?? "",
        );
        // The newest Daily is always first; a Catchup is never a show to pin or take off.
        showPicks(dialSheet, ["show", "share"]);
      }
      return dialSheet;
    }
    if (resume && resumeSheet) {
      const id = resume.dataset.homeResumeId ?? "";
      held = { sheet: "resume", id, href: resume.dataset.homeHref ?? "/" };
      fillSheet(
        resumeSheet,
        resume.querySelector(RESUME.title)?.textContent ?? "",
        [
          resume.querySelector(RESUME.show)?.textContent,
          resume.querySelector(RESUME.left)?.textContent,
        ]
          .filter(Boolean)
          .join(" · "),
      );
      showPicks(resumeSheet, ["played", "drop", "queue", "show"]);
      const goLabel = resumeSheet.querySelector('[data-home-pick="show"]');
      if (goLabel?.lastChild)
        goLabel.lastChild.textContent = isShowEpisodeId(id) ? "Go to show" : "Go to podcast";
      return resumeSheet;
    }
    return null;
  }

  const sheetOpen = (): boolean =>
    Boolean(dialSheet?.matches(":popover-open") || resumeSheet?.matches(":popover-open"));

  function fillSheet(sheet: HTMLElement, title: string, subtitle: string): void {
    const heading = sheet.querySelector("h2");
    if (heading) heading.textContent = title;
    const sub = heading?.nextElementSibling;
    if (sub && sub.tagName === "P") sub.textContent = subtitle;
    sheet.querySelector('[role="menu"]')?.setAttribute("aria-label", title);
  }

  function showPicks(sheet: HTMLElement, picks: string[]): void {
    for (const item of sheet.querySelectorAll<HTMLElement>("[data-home-pick]")) {
      item.hidden = !picks.includes(item.dataset.homePick ?? "");
    }
  }

  async function pickInSheet(pick: string): Promise<void> {
    const target = held;
    if (!target) return;
    (target.sheet === "dial" ? dialSheet : resumeSheet)?.hidePopover();
    if (target.sheet === "dial" && target.kind === "show") {
      const show = await getShow(target.showId);
      if (!show) return;
      if (pick === "pin") {
        await setShowPinned(target.showId, show.pinned_at === null);
      } else if (pick === "show") go(showUrl(target.showId));
      else if (pick === "share") await share(show.title, showUrl(target.showId));
      else if (pick === "hide") {
        await setShowHidden(target.showId, true);
        sendToast({
          message: "Removed from your speed dial",
          actionLabel: "Undo",
          onAction: () => void setShowHidden(target.showId, false),
        });
      }
      return;
    }
    if (target.sheet === "dial") {
      if (pick === "show") go(target.href);
      else if (pick === "share")
        await share(target.tile.querySelector(DIAL.name)?.textContent ?? "", target.href);
      return;
    }
    const { id, href } = target;
    if (pick === "played") {
      setPlayed(storage, id, true);
      sendToast({
        message: "Marked as played",
        actionLabel: "Undo",
        onAction: () => setPlayed(storage, id, false),
      });
    } else if (pick === "drop") {
      dropContinue(storage, id);
      void drawResume();
    } else if (pick === "queue") {
      const episode = isShowEpisodeId(id) ? await getEpisode(id) : null;
      if (episode) {
        const added = await queueEpisode(episode, "last");
        sendToast({ message: added ? "Added to queue" : "Already in the queue" });
      } else {
        const detail: { id: string; added?: boolean } = { id };
        document.dispatchEvent(new CustomEvent("singularity:queue-add", { detail }));
        sendToast({ message: detail.added === false ? "Already in the queue" : "Added to queue" });
      }
    } else if (pick === "show") {
      const showId = showIdOf(id);
      go(showId === null ? href : showUrl(showId));
    }
  }

  root.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element;
      const pick = target.closest<HTMLElement>("[data-home-pick]");
      if (pick) {
        const sheet = pick.closest("#home-dial-menu, #home-resume-menu");
        if (sheet) void pickInSheet(pick.dataset.homePick ?? "");
        else {
          const row = pick.closest<HTMLElement>("[data-home-show], [data-home-episode]");
          if (row) void pickInRow(row, pick.dataset.homePick ?? "");
        }
        return;
      }
      const dial = target.closest(DIAL.hit)?.closest<HTMLElement>(DIAL.tile);
      if (dial) {
        void pressDial(dial);
        return;
      }
      const resume = target.closest<HTMLElement>("[data-resume-play]");
      const item = resume?.closest<HTMLElement>("[data-home-resume-id]");
      if (item) void pressResume(item);
    },
    on,
  );

  // A mouse right-clicks a tile or card, a keyboard presses the menu key. Android also sends one at
  // the end of a long press, when the hold below has opened the sheet already.
  root.addEventListener(
    "contextmenu",
    (event) => {
      const target = (event.target as Element).closest(`${DIAL.hit}, ${RESUME.hit}`);
      if (!target) return;
      event.preventDefault();
      if (sheetOpen()) return;
      fillFor(target)?.showPopover();
    },
    on,
  );

  // A finger's hold is the Library's (cardHold.ts), with its fix for iPhone Safari closing a sheet
  // at the lift; this page fills the sheet when it fires.
  installCardHold();
  const stopHold = holdOpens(`${DIAL.hit}, ${RESUME.hit}`, (target) =>
    sheetOpen() ? null : fillFor(target),
  );
  life.signal.addEventListener("abort", stopHold);

  /* ------------------------------------------------------------------ keeping in step */

  const redraw = (): void => {
    void drawDial();
    void drawResume();
    void drawNew();
  };
  document.addEventListener(PODCASTS_CHANGED_EVENT, redraw, on);
  // A position saved, or an episode heard to the end (resume.ts): the shelf and the counts move.
  window.addEventListener("singularity:resume", redraw, on);
  window.addEventListener("storage", redraw, on);
  const downloads = new MutationObserver(applyFilter);
  downloads.observe(root, {
    subtree: true,
    attributes: true,
    attributeFilter: ["data-downloaded"],
  });
  life.signal.addEventListener("abort", () => downloads.disconnect());

  redraw();
  installPageArrows();
  whenIdle(() => {
    void refreshNew();
    void drawTrending();
    drawTopics();
    void loadPlayer().then(() => {
      paintPlaying();
      void onPlayerChange(paintPlaying).then((stop) => life.signal.addEventListener("abort", stop));
    });
    // The Catchups' menus (Download, Queue, Share, Favorite) and every hold are the Library's code.
    void import("./libraryMenu").then((menu) => menu.installLibraryMenu());
  });
}

install();
document.addEventListener("astro:page-load", install);
