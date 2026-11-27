/**
 * A topic's page (pages/topic.astro): the topic's chart from the trending route, then what its top
 * shows published in the last week, from the new-episodes route in one call. Without a topic it is
 * the chart of every topic, and the heading says "Top shows".
 */
import { type BrowseTopic, topicNamed } from "../lib/topics";
import { drawRows, episodeRow, newSince, showRow, trending } from "./podcastRows";

const TOP_SHOWS = 10;
const NEW_FROM = 10;
const NEW_SHOWN = 10;
const WEEK_S = 7 * 86_400;

function install(): void {
  const page = document.querySelector<HTMLElement>("[data-topic-page]");
  if (!page || page.dataset.ready !== undefined) return;
  page.dataset.ready = "";
  const one = <T extends HTMLElement>(selector: string): T | null =>
    page.querySelector<T>(selector);
  const topic: BrowseTopic | undefined = topicNamed(
    new URLSearchParams(location.search).get("name"),
  );
  const title = one("[data-topic-title]");
  if (topic && title) {
    title.textContent = topic.name;
    document.title = `${topic.name}, Singularity`;
  }
  const shows = one("[data-topic-shows]");
  // The page heading already says "Top shows" without a topic: the list needs no second one.
  if (!topic) {
    shows?.setAttribute("aria-labelledby", "page-title");
    shows?.querySelector(".shelf-head")?.remove();
  }

  void trending(topic?.query).then(async (answer) => {
    const note = one("[data-topic-note]");
    const top = (answer ?? [])
      .filter((show) => show.id !== null)
      .slice(0, topic ? TOP_SHOWS : undefined);
    if (top.length === 0) {
      if (note) {
        if (answer !== null) note.textContent = "No shows here yet. Try another topic.";
        note.hidden = false;
      }
      return;
    }
    const list = one("[data-topic-shows-list]");
    if (list && shows) {
      drawRows(
        list,
        top.flatMap((show) => showRow(show) ?? []),
      );
      shows.hidden = false;
    }
    if (!topic) return;
    const covers = new Map(top.map((show) => [show.id, show.cover]));
    const since = Math.floor(Date.now() / 1000) - WEEK_S;
    const fresh = await newSince(
      top.slice(0, NEW_FROM).flatMap((show) => (show.id === null ? [] : [show.id])),
      since,
    );
    const section = one("[data-topic-new]");
    const newList = one("[data-topic-new-list]");
    if (!fresh || fresh.length === 0 || !section || !newList) return;
    drawRows(
      newList,
      fresh
        .slice(0, NEW_SHOWN)
        .map((episode) => episodeRow(episode, covers.get(episode.show_id) ?? null)),
    );
    section.hidden = false;
  });
}

document.addEventListener("astro:page-load", install);
install();
