import { safeLocalStorage } from "../player/core/resume";
import { heardOnDevice } from "../podcasts/after";
import { listenedEpisodes, PODCASTS_CHANGED_EVENT } from "../podcasts/deviceStore";
import { coverAt } from "../podcasts/episodeDigest";
import { catchupHistory, historyDay } from "../podcasts/history";
import { showEpisodeUrl } from "../podcasts/rules";
import { timeFact } from "../podcasts/view";
import { mountEachVisit } from "./pageMount";

/**
 * History: the Catchups this device heard (their rows are on the page, as the Library draws them)
 * and the public shows' episodes (rows built from the device store), newest first under a heading
 * per day. Redrawn when the device store or a position changes.
 */
export function installHistoryPage(): void {
  mountEachVisit("[data-history]", mountHistory);
}

function mountHistory(root: HTMLElement, life: AbortSignal): void {
  const list = root.querySelector<HTMLElement>("[data-history-list]");
  const grid = list?.querySelector<HTMLElement>("[data-library-grid]");
  const empty = root.querySelector<HTMLElement>("[data-history-empty]");
  const dayTemplate = root.querySelector<HTMLTemplateElement>("template[data-history-day]");
  const rowTemplate = root.querySelector<HTMLTemplateElement>("template[data-podcast-row]");
  if (!list || !grid || !empty || !dayTemplate || !rowTemplate) return;
  const catchups = new Map(
    [...grid.querySelectorAll<HTMLElement>("[data-card][data-id]")].map((card) => [
      card.dataset.id ?? "",
      card,
    ]),
  );

  const draw = async (): Promise<void> => {
    const heard = heardOnDevice(safeLocalStorage());
    const rows: { at: string; card: HTMLElement }[] = [];
    for (const listen of catchupHistory()) {
      const card = catchups.get(listen.id);
      if (card) rows.push({ at: listen.at, card });
    }
    for (const episode of await listenedEpisodes()) {
      const card = rowTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement;
      card.dataset.id = episode.id;
      (card.querySelector("a") as HTMLAnchorElement).href = showEpisodeUrl(episode.id);
      const image = card.querySelector("img") as HTMLImageElement;
      if (episode.cover) image.src = coverAt(episode.cover, 256);
      else image.remove();
      (card.querySelector("[data-row-title]") as HTMLElement).textContent = episode.title;
      const facts = [episode.show_title, timeFact(episode.duration_s, heard(episode.id))];
      (card.querySelector("[data-row-facts]") as HTMLElement).textContent = facts
        .filter(Boolean)
        .join(" · ");
      if (heard(episode.id).played) card.dataset.played = "";
      rows.push({ at: episode.listened_at ?? "", card });
    }
    rows.sort((a, b) => b.at.localeCompare(a.at));
    // The Catchups not heard stay on the page, hidden, for the next redraw.
    for (const card of catchups.values()) card.hidden = true;
    const now = new Date();
    const drawn: HTMLElement[] = [];
    let day = "";
    for (const { at, card } of rows) {
      const label = historyDay(at, now);
      if (label !== day) {
        day = label;
        const head = dayTemplate.content.firstElementChild?.cloneNode(true) as HTMLElement;
        (head.querySelector("h2") as HTMLElement).textContent = label;
        if (drawn.length === 0) head.dataset.first = "";
        drawn.push(head);
      }
      card.hidden = false;
      drawn.push(card);
    }
    grid.replaceChildren(...drawn, ...[...catchups.values()].filter((card) => card.hidden));
    list.hidden = rows.length === 0;
    empty.hidden = rows.length > 0;
  };

  void draw();
  document.addEventListener(PODCASTS_CHANGED_EVENT, () => void draw(), { signal: life });
  window.addEventListener("singularity:resume", () => void draw(), { signal: life });
}
