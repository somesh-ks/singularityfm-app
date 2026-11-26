/**
 * One episode of a public show (pages/episode.astro): drawn from the device, where anything played,
 * queued or favorited is kept, else from its show's route. Its Play, its marks and its menu follow
 * the same rules as its row on the show's page (podcasts/rules.ts, podcasts/play.ts).
 */
import { sendToast } from "@singularityfm/design-system/toastEvent";
import { whenIdle } from "../narration/prewarmPage";
import { safeLocalStorage, setPlayed } from "../player/core/resume";
import { heardOnDevice } from "../podcasts/after";
import { getEpisode, setEpisodeFavorite } from "../podcasts/deviceStore";
import { coverAt } from "../podcasts/episodeDigest";
import { loadPlayer, nowPlaying, onPlayerChange, pressPlay, queueEpisode } from "../podcasts/play";
import { isShowEpisodeId, showIdOf, showUrl } from "../podcasts/rules";
import { fetchShow } from "../podcasts/shows";
import { dayLabel, noteParagraphs, timeFact } from "../podcasts/view";
import type { EpisodeRow } from "../server/podcasts/shapes";

function install(): void {
  const page = document.querySelector<HTMLElement>("[data-episode-page]");
  if (!page || page.dataset.ready !== undefined) return;
  const root = page;
  root.dataset.ready = "";
  const id = new URLSearchParams(location.search).get("id") ?? "";
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
  }

  /** The device's copy; true when it holds one. */
  async function read(): Promise<boolean> {
    const stored = await getEpisode(id);
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
      if (target.closest("[data-episode-play]")) {
        if (!pressPlay(current))
          sendToast({ message: "This episode can't be played here", kind: "error" });
        return;
      }
      if (target.closest("[data-episode-favorite]")) {
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
      if (target.closest("[data-episode-share]")) {
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
      else if (action === "show") location.assign(showUrl(current.show_id));
      else if (action === "next" || action === "queue") {
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

  window.addEventListener("singularity:resume", paintHeard, on);
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
