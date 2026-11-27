/**
 * The Library's rows that only this device knows (12 Nov canvas, boards Library: Shows and Library:
 * Favorites): the shows favorited, whose line counts their new episodes, and the episodes of shows
 * hearted, which sit with the hearted Catchups. Each is cloned from the page's podcast row template
 * (PodcastRowTemplate.astro) and carries the data attributes the Library's search, sort and filter
 * read, so libraryPage.ts treats them as it treats a Catchup's card.
 */

import { SHOW_EPISODE_KIND, SHOW_KIND } from "../lib/library";
import { safeLocalStorage } from "../player/core/resume";
import { heardOnDevice } from "../podcasts/after";
import {
  episodesOfShow,
  favoriteEpisodes,
  favoriteShows,
  followingOf,
  getShow,
} from "../podcasts/deviceStore";
import { newCount } from "../podcasts/rules";
import { episodeRow, type PodcastRow, showHref } from "./podcastRows";

/** The day an ISO time falls on, as a card's data-date ("2026-11-26"); empty without one. */
const dayOf = (iso: string | null): string => (iso ? iso.slice(0, 10) : "");

function row(
  template: HTMLTemplateElement,
  content: PodcastRow,
  data: { id: string; kind: string; date: string; minutes: number; search: string },
): HTMLElement {
  const item = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
  const link = item.querySelector<HTMLAnchorElement>("a");
  const image = item.querySelector<HTMLImageElement>("img");
  const title = item.querySelector<HTMLElement>("[data-row-title]");
  const facts = item.querySelector<HTMLElement>("[data-row-facts]");
  if (link) link.href = content.href;
  if (image && content.cover) image.src = content.cover;
  else image?.remove();
  if (title) title.textContent = content.title;
  if (facts) facts.textContent = content.facts;
  item.dataset.id = data.id;
  item.dataset.kind = data.kind;
  item.dataset.date = data.date;
  item.dataset.minutes = String(data.minutes);
  // The title and the facts are the row's own lines: a search finds it by either.
  item.dataset.search = data.search;
  item.dataset.metaLines = "2";
  item.dataset.favorite = "";
  return item;
}

/** Every device row, newest first: the favorite shows, then the hearted episodes. */
export async function deviceRows(template: HTMLTemplateElement): Promise<HTMLElement[]> {
  const heardOf = heardOnDevice(safeLocalStorage());
  const shows = await favoriteShows();
  const showRows = await Promise.all(
    shows.map(async (show) => {
      const episodes = await episodesOfShow(show.id);
      const dismissed = new Set(episodes.filter((e) => e.dismissed).map((e) => e.id));
      const count = newCount(episodes, followingOf(show), heardOf, dismissed);
      const facts = [show.author, count > 0 ? `${count} new` : ""].filter(Boolean).join(" · ");
      return row(
        template,
        { href: showHref(show.id), cover: show.cover, title: show.title, facts },
        {
          id: `show:${show.id}`,
          kind: SHOW_KIND,
          date: dayOf(show.newest_at ?? show.favorite_at),
          minutes: 0,
          search: `${show.title}\n${show.author}`,
        },
      );
    }),
  );
  const episodeRows = await Promise.all(
    (await favoriteEpisodes()).map(async (episode) => {
      const cover = episode.cover ? null : ((await getShow(episode.show_id))?.cover ?? null);
      const content = episodeRow(episode, cover);
      return row(template, content, {
        id: episode.id,
        kind: SHOW_EPISODE_KIND,
        date: dayOf(episode.published_at),
        minutes: Math.round((episode.duration_s ?? 0) / 60),
        search: `${episode.title}\n${content.facts}`,
      });
    }),
  );
  return [...showRows, ...episodeRows];
}
