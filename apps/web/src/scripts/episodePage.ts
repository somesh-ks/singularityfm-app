/**
 * One episode of a public show (pages/episode.astro): drawn from the device, where anything played,
 * queued or favorited is kept, else from its show's route. Its Play, its marks and its menu follow
 * the same rules as its row on the show's page (podcasts/rules.ts, podcasts/play.ts).
 */
import { badgeClass } from "@singularityfm/design-system/badge";
import { sendToast } from "@singularityfm/design-system/toastEvent";
import { whenIdle } from "../narration/prewarmPage";
import { formatClock } from "../player/core/formatTime";
import { getPreferences, type SponsorChoice } from "../player/core/preferences";
import { safeLocalStorage, setPlayed } from "../player/core/resume";
import { heardOnDevice } from "../podcasts/after";
import { getEpisode, setEpisodeFavorite } from "../podcasts/deviceStore";
import { coverAt } from "../podcasts/episodeDigest";
import { badgedTitle, chapterRows, episodeBreaks, loadExtras } from "../podcasts/extras";
import { loadPlayer, nowPlaying, onPlayerChange, pressPlay, queueEpisode } from "../podcasts/play";
import { isShowEpisodeId, showIdOf, showUrl } from "../podcasts/rules";
import { fetchShow } from "../podcasts/shows";
import { breaksSummary } from "../podcasts/sponsors";
import { dayLabel, noteParagraphs, timeFact } from "../podcasts/view";
import type { EpisodeRow } from "../server/podcasts/shapes";

function install(): void {
  const page = document.querySelector<HTMLElement>("[data-episode-page]");
  if (!page || page.dataset.ready !== undefined) return;
  const root = page;
  root.dataset.ready = "";
  const params = new URLSearchParams(location.search);
  const id = params.get("id") ?? "";
  // A first chapter's link says t=0: still a position, not the resume point.
  const linkedAt = params.has("t") ? Number(params.get("t")) : Number.NaN;
  let startAt: number | undefined =
    Number.isFinite(linkedAt) && linkedAt >= 0 ? linkedAt : undefined;
  const showId = isShowEpisodeId(id) ? showIdOf(id) : null;
  const part = <T extends HTMLElement>(name: string): T | null =>
    root.querySelector<T>(`[data-episode-${name}]`);
  const storage = safeLocalStorage();
  const heardOf = heardOnDevice(storage);
  const play = part<HTMLButtonElement>("play");
  const heart = part<HTMLButtonElement>("favorite");
  const life = new AbortController();
  const on = { signal: life.signal };
  document.addEventListener("astro:before-swap", () => life.abort(), { once: true });

  const linkTemplate = root.querySelector<HTMLTemplateElement>("template[data-episode-note-link]");

  let episode: EpisodeRow | null = null;
  let favorite = false;

  const show = (state: "ready" | "missing" | "failed"): void => {
    root.dataset.state = state;
    root.removeAttribute("aria-busy");
    const body = part("body");
    const missing = part("missing");
    const failed = part("failed");
    if (body) body.hidden = state !== "ready";
    if (missing) missing.hidden = state !== "missing";
    if (failed) {
      failed.hidden = state !== "failed";
      failed
        .querySelector<HTMLAnchorElement>("[data-astro-reload]")
        ?.setAttribute("href", location.pathname + location.search);
    }
  };

  if (showId === null) {
    show("missing");
    return;
  }

  /** What changes as the episode plays: the facts, the played mark and Play's name. */
  function paintHeard(): void {
    if (!episode) return;
    const heard = heardOf(episode.id);
    const facts = part("facts");
    if (facts) {
      const words = [
        dayLabel(episode.published_at, new Date()),
        timeFact(episode.duration_s, heard),
        episode.kind === "trailer" ? "Trailer" : episode.kind === "bonus" ? "Bonus" : "",
      ].filter(Boolean);
      const key = words.join("|");
      if (facts.dataset.key !== key) {
        facts.dataset.key = key;
        for (const span of facts.querySelectorAll(":scope > span:not(.hero-mark)")) span.remove();
        for (const node of [...facts.childNodes])
          if (node.nodeType === Node.TEXT_NODE) node.remove();
        facts.prepend(
          ...words.map((text) => {
            const span = document.createElement("span");
            span.textContent = text;
            return span;
          }),
        );
      }
      // "Played", as a briefing's header says it (HeroMarks.astro).
      const marked = facts.querySelector(".hero-played");
      if (!heard.played) marked?.remove();
      else if (!marked) {
        const mark = facts.querySelector<HTMLTemplateElement>("template[data-played-mark]");
        if (mark) facts.append(mark.content.cloneNode(true));
      }
    }
    if (play) {
      const now = nowPlaying();
      const current = now?.id === episode.id;
      const sounding = current && now.playing;
      play.dataset.state = current ? "current" : "idle";
      play.dataset.playing = String(sounding);
      const left = timeFact(episode.duration_s, heard);
      const name = sounding
        ? "Pause the episode"
        : heard.seconds > 0 && !heard.played
          ? `Resume the episode${left ? `, ${left}` : ""}`
          : heard.played
            ? "Play the episode again"
            : `Play the episode${left ? `, ${left}` : ""}`;
      if (play.getAttribute("aria-label") !== name) play.setAttribute("aria-label", name);
    }
    const label = root.querySelector<HTMLElement>('[data-pick="played"] [data-menu-label]');
    if (label) label.textContent = heard.played ? "Mark as unplayed" : "Mark as played";
  }

  /** The sponsor switch says the setting it is (Settings, Show settings: Sponsor breaks). */
  function paintSponsorSwitch(): void {
    const toggle = part<HTMLInputElement>("sponsor-switch");
    if (toggle) toggle.checked = getPreferences().get().sponsors === "skip";
  }

  /**
   * Chapters and sponsor breaks, once the publisher's files are read through the extras route. An
   * episode whose show publishes neither keeps neither section.
   */
  let extrasFor: string | null = null;
  function paintExtras(): void {
    if (!episode) return;
    const current = episode;
    // The length too: a refreshed feed that adds one closes a last sponsor chapter's break.
    const key = `${current.id}|${current.chapters ?? ""}|${current.transcript ?? ""}|${current.duration_s ?? ""}`;
    if (extrasFor === key) return;
    extrasFor = key;
    void loadExtras(current.id, current).then((extras) => {
      if (life.signal.aborted || episode?.id !== current.id) return;
      // Offline: the device coming back online asks again (the listener below).
      if (extras.partial) extrasFor = null;
      // The same length the player measures breaks against (extras.ts, withExtras).
      const duration = current.duration_s || Number.POSITIVE_INFINITY;
      const breaks = episodeBreaks(extras, duration);
      const sponsors = part("sponsors");
      if (sponsors) sponsors.hidden = breaks.length === 0;
      const hint = part("sponsor-hint");
      if (hint) hint.textContent = breaks.length > 0 ? breaksSummary(breaks) : "";
      paintSponsorSwitch();
      const rows = chapterRows(extras.chapters, breaks, duration);
      const chapters = part("chapters");
      const list = part("chapter-rows");
      const template = root.querySelector<HTMLTemplateElement>(
        "template[data-episode-chapter-row]",
      );
      if (!chapters || !list || !template) return;
      chapters.hidden = rows.length === 0;
      // Past an hour a start reads h:mm:ss: every time takes that width, so the names share one edge.
      list.toggleAttribute(
        "data-hours",
        rows.some((row) => row.start_s >= 3600),
      );
      list.replaceChildren(
        ...rows.map((row) => {
          const node = template.content.firstElementChild?.cloneNode(true) as HTMLAnchorElement;
          node.dataset.chapterAt = String(row.start_s);
          // The episode at that moment; a plain press plays it here (the click handler below).
          node.href = `${location.pathname}?id=${encodeURIComponent(current.id)}&t=${Math.floor(row.start_s)}`;
          const time = node.querySelector("[data-time]");
          const title = node.querySelector("[data-title]");
          if (time) time.textContent = formatClock(row.start_s);
          if (title) title.textContent = badgedTitle(row);
          if (!row.sponsor) node.querySelector(`.${badgeClass()}`)?.remove();
          return node;
        }),
      );
    });
  }

  function paint(): void {
    if (!episode) return;
    show("ready");
    const title = part("title");
    if (title) title.textContent = episode.title;
    document.title = `${episode.title}, Singularity`;
    const menuTitle = root.querySelector("#episode-page-menu-title");
    if (menuTitle) menuTitle.textContent = episode.title;
    const back = part<HTMLAnchorElement>("show");
    if (back) {
      back.textContent = episode.show_title;
      back.href = showUrl(episode.show_id);
    }
    const cover = part<HTMLImageElement>("cover");
    if (cover && episode.cover) {
      const src = coverAt(episode.cover, 512);
      if (cover.getAttribute("src") !== src) cover.src = src;
      cover.hidden = false;
    }
    heart?.setAttribute("aria-pressed", String(favorite));
    // The sheet's Favorite says the same as the heart (show.css swaps its glyph).
    heart?.closest(".hero")?.toggleAttribute("data-saved", favorite);
    const favoriteLabel = root.querySelector('[data-pick="favorite"] [data-menu-label]');
    if (favoriteLabel) favoriteLabel.textContent = favorite ? "Unfavorite" : "Favorite";
    const notes = part("notes");
    if (notes && notes.dataset.for !== episode.description) {
      notes.dataset.for = episode.description;
      notes.hidden = !episode.description;
      notes.replaceChildren(
        ...noteParagraphs(episode.description).map((parts) => {
          const paragraph = document.createElement("p");
          for (const entry of parts) {
            if (!entry.href) {
              paragraph.append(entry.text);
              continue;
            }
            const link = linkTemplate?.content.firstElementChild?.cloneNode(true);
            if (!(link instanceof HTMLAnchorElement)) {
              paragraph.append(entry.text);
              continue;
            }
            link.href = entry.href;
            link.textContent = entry.text;
            paragraph.append(link);
          }
          return paragraph;
        }),
      );
    }
    paintHeard();
    paintExtras();
  }

  /** The device's copy; true when it holds one. */
  async function read(): Promise<boolean> {
    const stored = await getEpisode(id);
    // The reader left while the device answered: the next page's title is not ours to write.
    if (life.signal.aborted) return true;
    if (!stored) return false;
    episode = stored;
    favorite = stored.favorite_at !== null;
    paint();
    return true;
  }

  void (async () => {
    const held = await read();
    // The show's newest page brings whole notes and a moved audio address; the long list finds an
    // older episode the device never held.
    let answer = await fetchShow(showId);
    if (life.signal.aborted) return;
    const inAnswer = (): EpisodeRow | undefined =>
      typeof answer === "string" ? undefined : answer.episodes.find((row) => row.id === id);
    if (typeof answer !== "string" && !inAnswer() && !held) answer = await fetchShow(showId, true);
    if (life.signal.aborted) return;
    if (await read()) return;
    const found = inAnswer();
    if (found) {
      // No database on this device: the route's answer is drawn as it came.
      episode = found;
      paint();
    } else if (!held) show(answer === "failed" ? "failed" : "missing");
  })();

  root.addEventListener(
    "click",
    (event) => {
      if (!episode) return;
      const current = episode;
      const target = event.target as Element;
      const chapter = target.closest<HTMLElement>("[data-chapter-at]");
      // A press with a modifier opens the link as the browser would (a new tab).
      const modified =
        event instanceof MouseEvent && (event.metaKey || event.ctrlKey || event.shiftKey);
      if (chapter && !modified) {
        event.preventDefault();
        // A chosen chapter replaces the link's position: Play is Play after it.
        startAt = undefined;
        if (!pressPlay(current, Number(chapter.dataset.chapterAt)))
          sendToast({ message: "This episode can't be played here", kind: "error" });
        return;
      }
      if (target.closest("[data-episode-play]")) {
        // A chapter's link (?t=) plays from its chapter the first time; Play is Play after that.
        const at = startAt;
        startAt = undefined;
        if (!pressPlay(current, at))
          sendToast({ message: "This episode can't be played here", kind: "error" });
        return;
      }
      if (target.closest('[data-episode-favorite], [data-pick="favorite"]')) {
        const next = !favorite;
        void setEpisodeFavorite(current.id, next)
          .then(read)
          .then(() =>
            sendToast(
              favorite === next
                ? { message: next ? "Added to favorites" : "Removed from favorites" }
                : { message: "Couldn't change favorites on this device", kind: "error" },
            ),
          );
        return;
      }
      if (target.closest('[data-episode-share], [data-pick="share"]')) {
        const url = location.href;
        void (async () => {
          try {
            if (navigator.share) await navigator.share({ title: current.title, url });
            else {
              await navigator.clipboard.writeText(url);
              sendToast({ message: "Link copied" });
            }
          } catch {
            // Closed without sharing: nothing to say.
          }
        })();
        return;
      }
      const action = target.closest<HTMLElement>("[data-pick]")?.dataset.pick;
      if (action === "played") setPlayed(storage, current.id, !heardOf(current.id).played);
      else if (action === "show") {
        // The client router's move: a full load would stop what is playing.
        const to = showUrl(current.show_id);
        void import("../player/core/navigation").then(({ navigateTo }) => navigateTo(to));
      } else if (action === "next" || action === "queue") {
        const where = action === "next" ? "next" : "last";
        void queueEpisode(current, where).then((added) =>
          sendToast({
            message: added
              ? where === "next"
                ? "Playing next"
                : "Added to the queue"
              : "Already in the queue",
          }),
        );
      }
    },
    on,
  );

  root.addEventListener(
    "change",
    (event) => {
      if (event.target !== part("sponsor-switch")) return;
      const checked = (event.target as HTMLInputElement).checked;
      // Off again returns to the choice it replaced, so an Off made in Settings stays Off.
      const choice = getPreferences().get().sponsors;
      if (checked && choice !== "skip") before = choice;
      getPreferences().set({ sponsors: checked ? "skip" : before });
    },
    on,
  );
  let before: SponsorChoice = "button";
  // Another tab, or Settings, may change the choice while this page is open.
  const offPreferences = getPreferences().subscribe(paintSponsorSwitch);
  life.signal.addEventListener("abort", offPreferences, { once: true });

  window.addEventListener("singularity:resume", paintHeard, on);
  window.addEventListener("online", paintExtras, on);
  void onPlayerChange(paintHeard).then((off) => {
    if (life.signal.aborted) off();
    else life.signal.addEventListener("abort", off, { once: true });
    paintHeard();
  });
  void loadPlayer();
}

// The menu opens by itself (a native popover); its keys load once the page is idle (D361).
whenIdle(() => void import("./heroMenu").then((menu) => menu.installHeroMenu()));
document.addEventListener("astro:page-load", install);
install();
