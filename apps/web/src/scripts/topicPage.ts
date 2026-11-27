/**
 * A topic's page (pages/topic.astro): the topic's chart from the trending route, whole shows as a
 * grid of covers that open the show's page (never single episodes). Without a topic it is the chart
 * of every topic, and the heading says "Top shows".
 */
import { type BrowseTopic, topicNamed } from "../lib/topics";
import { drawRows, showRow, trending } from "./podcastRows";

const TOP_SHOWS = 30;

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
    const top = (answer ?? []).filter((show) => show.id !== null).slice(0, TOP_SHOWS);
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
  });
}

document.addEventListener("astro:page-load", install);
install();
