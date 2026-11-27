/**
 * Public shows and episodes as the Library's list rows, for Search and a topic's page: one template
 * in the page (PodcastRowTemplate.astro), filled here, so the markup has one home. Also the three
 * route reads those pages make; each answers null when the route fails, so a page draws what it has.
 */
import type { EpisodeRow, ShowRow } from "../server/podcasts/shapes";

/** A row to draw: where it leads, its art, its title and one quiet line of facts. */
export interface PodcastRow {
  href: string;
  cover: string | null;
  title: string;
  facts: string;
}

export const showHref = (id: number): string => `/show?id=${id}`;
export const episodeHref = (id: string): string => `/episode?id=${encodeURIComponent(id)}`;

/** A show with an index id: one only Apple found has no page to open yet. */
export function showRow(show: ShowRow): PodcastRow | null {
  if (show.id === null) return null;
  return { href: showHref(show.id), cover: show.cover, title: show.title, facts: show.author };
}

const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "Hard Fork · 10 Nov · 31 min", leaving out what the episode does not say. */
export function episodeRow(episode: EpisodeRow, showCover: string | null = null): PodcastRow {
  const facts = [episode.show_title];
  if (episode.published_at) facts.push(day.format(new Date(episode.published_at)));
  if (episode.duration_s) facts.push(`${Math.max(1, Math.round(episode.duration_s / 60))} min`);
  return {
    href: episodeHref(episode.id),
    cover: episode.cover ?? showCover,
    title: episode.title,
    facts: facts.join(" · "),
  };
}

/** A row only ever leads to a page of this app: anything else (a stored or odd address) leads nowhere. */
function inApp(href: string): string | null {
  try {
    const url = new URL(href, location.origin);
    return url.origin === location.origin ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

/** The row each drawn item was made from, so a page reads its data back instead of its markup. */
const drawn = new WeakMap<Element, PodcastRow>();

/** The row an element inside a drawn item came from. */
export function rowOf(element: Element): PodcastRow | undefined {
  const item = element.closest("li");
  return item ? drawn.get(item) : undefined;
}

/** Fills a list with rows cloned from the page's row template. */
export function drawRows(list: HTMLElement, rows: readonly PodcastRow[]): void {
  const template = document.querySelector<HTMLTemplateElement>("template[data-podcast-row]");
  if (!template) return;
  list.replaceChildren(
    ...rows.map((row) => {
      const item = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
      const link = item.querySelector<HTMLAnchorElement>("a");
      const image = item.querySelector<HTMLImageElement>("img");
      const title = item.querySelector<HTMLElement>("[data-row-title]");
      const facts = item.querySelector<HTMLElement>("[data-row-facts]");
      const target = inApp(row.href);
      if (link && target) link.href = target;
      if (image && row.cover) image.src = row.cover;
      else image?.remove();
      if (title) title.textContent = row.title;
      if (facts) facts.textContent = row.facts;
      drawn.set(item, row);
      return item;
    }),
  );
}

async function read<T>(address: string): Promise<T | null> {
  try {
    const response = await fetch(address, { credentials: "same-origin" });
    return response.ok ? ((await response.json()) as T) : null;
  } catch {
    return null;
  }
}

/** The index's trending shows, for one category or all of them. */
export async function trending(category?: string): Promise<ShowRow[] | null> {
  const query = new URLSearchParams({ lang: "en" });
  if (category) query.set("topic", category);
  const body = await read<{ shows?: ShowRow[] }>(`/api/podcasts/trending?${query}`);
  return body?.shows ?? null;
}

/** Shows matching the words. */
export async function searchShows(term: string): Promise<ShowRow[] | null> {
  const body = await read<{ shows?: ShowRow[] }>(
    `/api/podcasts/search?${new URLSearchParams({ q: term })}`,
  );
  return body?.shows ?? null;
}

/** One show's newest episodes. */
export async function showEpisodes(id: number): Promise<EpisodeRow[] | null> {
  const body = await read<{ episodes?: EpisodeRow[] }>(`/api/podcasts/show?id=${id}`);
  return body?.episodes ?? null;
}

/** What is new across these shows since a time (seconds), newest first. */
export async function newSince(
  ids: readonly number[],
  since: number,
): Promise<EpisodeRow[] | null> {
  if (ids.length === 0) return [];
  const query = new URLSearchParams({ ids: ids.join(","), since: String(since) });
  const body = await read<{ episodes?: EpisodeRow[] }>(`/api/podcasts/new?${query}`);
  return body?.episodes ?? null;
}
