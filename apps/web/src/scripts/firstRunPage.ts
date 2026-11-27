import { sendToast } from "@singularityfm/design-system/toastEvent";
import { favoriteShows, setShowFavorite } from "../podcasts/deviceStore";
import { coverAt } from "../podcasts/episodeDigest";
import {
  FIRST_RUN_ADDED_KEY,
  markFirstRunDone,
  pickedCategories,
  pickedTopics,
  setPickedTopics,
} from "../podcasts/firstRun";
import { fetchShow } from "../podcasts/shows";
import { follow } from "../podcasts/transfer";
import type { ShowRow } from "../server/podcasts/shapes";
import { installImportPicker } from "./importPage";
import { searchShows, trending } from "./podcastRows";

/**
 * First run's three steps (pages/welcome*.astro). Each step keeps its picks as they are made, so
 * Skip at any step keeps what was done and ends first run; Done on the last does the same.
 */

/** The most shows step 2 offers before a search, as the canvas draws: Continue stays near. */
const SUGGESTED = 6;
/** How many of the picked topics' charts step 2 reads: enough to mix them, few enough to be quick. */
const CHARTS = 3;

/** The picked topics' charts, interleaved so the first row mixes them, each show once. */
async function suggestions(): Promise<ShowRow[]> {
  const categories = pickedCategories().slice(0, CHARTS);
  const charts = await Promise.all(
    (categories.length > 0 ? categories : [undefined]).map(
      async (category) => (await trending(category)) ?? [],
    ),
  );
  const seen = new Set<number>();
  const mixed: ShowRow[] = [];
  const longest = Math.max(0, ...charts.map((chart) => chart.length));
  for (let i = 0; i < longest && mixed.length < SUGGESTED; i++) {
    for (const chart of charts) {
      const show = chart[i];
      // A show only Apple found has no page here yet (podcastRows.ts, showRow).
      if (!show || show.id === null || seen.has(show.id) || mixed.length >= SUGGESTED) continue;
      seen.add(show.id);
      mixed.push(show);
    }
  }
  return mixed;
}

function installTopics(root: HTMLElement): void {
  const group = root.querySelector<HTMLElement>("[data-first-run-topics]");
  if (!group) return;
  const boxes = [...group.querySelectorAll<HTMLInputElement>("input[type=checkbox]")];
  // Back from step 2: the picks made, not the defaults.
  const picked = pickedTopics();
  if (picked.length > 0)
    for (const box of boxes) box.checked = (picked as string[]).includes(box.value);
  const save = (): void =>
    setPickedTopics(boxes.filter((box) => box.checked).map((box) => box.value));
  group.addEventListener("change", save);
  root.querySelector("[data-first-run-next]")?.addEventListener("click", save);
  root.querySelector("[data-first-run-skip]")?.addEventListener("click", save);
}

function installShows(root: HTMLElement): void {
  const list = root.querySelector<HTMLUListElement>("[data-first-run-shows]");
  const template = root.querySelector<HTMLTemplateElement>("template[data-first-run-show]");
  const form = root.querySelector<HTMLFormElement>("[data-first-run-search]");
  const query = root.querySelector<HTMLInputElement>("[data-first-run-query]");
  const none = root.querySelector<HTMLElement>("[data-first-run-none]");
  const status = root.querySelector<HTMLElement>("[data-first-run-status]");
  if (!list || !template || !form || !query || !none || !status) return;
  const favorites = new Set<number>();
  let suggested: ShowRow[] | null = [];
  let asked = 0;

  const toggle = async (id: number, title: string, box: HTMLInputElement): Promise<void> => {
    // The ring shows at once; a show that cannot be read takes it back.
    if (!box.checked) {
      favorites.delete(id);
      await setShowFavorite(id, false, null);
      return;
    }
    favorites.add(id);
    const answer = await fetchShow(id);
    // Unticked while the show loaded: the last tap wins.
    if (!box.checked) return;
    if (typeof answer === "string") {
      favorites.delete(id);
      box.checked = false;
      sendToast({ message: `Couldn't add ${title}. Try again.`, kind: "error" });
      return;
    }
    await follow(answer);
    if (!box.checked) await setShowFavorite(id, false, null);
  };

  const resting = none.textContent ?? "";
  const draw = (rows: readonly ShowRow[] | null): void => {
    // A list that did not load says so, where an empty one says nothing matched.
    none.textContent = rows === null ? "Couldn't load shows. Check your connection." : resting;
    if (rows === null) {
      list.replaceChildren();
      none.hidden = false;
      return;
    }
    const cards: HTMLElement[] = [];
    for (const show of rows) {
      const id = show.id;
      if (id === null) continue;
      const card = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
      const image = card.querySelector<HTMLImageElement>("img") as HTMLImageElement;
      if (show.cover) image.src = coverAt(show.cover, 256);
      else image.remove();
      (card.querySelector("[data-show-pick-title]") as HTMLElement).textContent = show.title;
      (card.querySelector("[data-show-pick-facts]") as HTMLElement).textContent = show.author;
      const box = card.querySelector<HTMLInputElement>("[data-first-run-pick]") as HTMLInputElement;
      box.value = String(id);
      box.checked = favorites.has(id);
      box.addEventListener("change", () => void toggle(id, show.title, box));
      cards.push(card);
    }
    list.replaceChildren(...cards);
    none.hidden = cards.length > 0 || query.value.trim() === "";
  };

  form.addEventListener("submit", (event) => event.preventDefault());
  let timer = 0;
  query.addEventListener("input", () => {
    clearTimeout(timer);
    const term = query.value.trim();
    if (term.length < 2) return draw(suggested);
    timer = window.setTimeout(async () => {
      const mine = ++asked;
      const found = await searchShows(term);
      if (mine === asked) draw(found);
    }, 300);
  });

  void (async () => {
    for (const show of await favoriteShows()) favorites.add(show.id);
    suggested = await suggestions();
    if (suggested.length === 0) suggested = null;
    if (query.value.trim().length < 2) draw(suggested);
  })();
}

function installImport(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("[data-import-page]");
  if (section) installImportPicker(section);
  // Back from the Add a show page with the show it added.
  try {
    const added = sessionStorage.getItem(FIRST_RUN_ADDED_KEY);
    sessionStorage.removeItem(FIRST_RUN_ADDED_KEY);
    if (added) sendToast({ message: `Added ${added} to your favorites` });
  } catch {
    // Nothing to say.
  }
}

export function installFirstRun(): void {
  const root = document.querySelector<HTMLElement>("[data-first-run]");
  if (!root) return;
  const step = root.dataset.firstRun;
  if (step === "1") installTopics(root);
  if (step === "2") installShows(root);
  if (step === "3") installImport(root);
  const finish = (): void => {
    markFirstRunDone();
    location.assign("/");
  };
  root.querySelector("[data-first-run-skip]")?.addEventListener("click", finish);
  // The last step's button is Done, with no address of its own.
  const next = root.querySelector<HTMLElement>("[data-first-run-next]");
  if (next && !next.hasAttribute("href")) next.addEventListener("click", finish);
}
