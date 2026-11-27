import { sendToast } from "@singularityfm/design-system/toastEvent";
import { favoriteShows, setShowFavorite } from "../podcasts/deviceStore";
import { coverAt } from "../podcasts/episodeDigest";
import {
  FIRST_RUN_ADDED_KEY,
  markFirstRunDone,
  pickedCategories,
  pickedTopics,
  setPickedTopics,
  topicsSaved,
} from "../podcasts/firstRun";
import { fetchShow } from "../podcasts/shows";
import type { ShowRow } from "../server/podcasts/shapes";
import { installImportPicker, transfer } from "./importPage";
import { mountEachVisit } from "./pageMount";
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
  // Back from step 2: the picks made, none included, not the defaults.
  if (topicsSaved()) {
    const picked: string[] = pickedTopics();
    for (const box of boxes) box.checked = picked.includes(box.value);
  }
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

  // The show's box now: a search redraws the list, so the box first tapped may be gone.
  const boxOf = (id: number): HTMLInputElement | null =>
    list.querySelector<HTMLInputElement>(`[data-first-run-pick][value="${id}"]`);
  const toggle = async (id: number, title: string, picked: boolean): Promise<void> => {
    // The ring shows at once; a show that cannot be read takes it back. The last tap wins, by
    // `favorites`, which every tap writes at once.
    if (!picked) {
      favorites.delete(id);
      await setShowFavorite(id, false, null);
      return;
    }
    favorites.add(id);
    const answer = await fetchShow(id);
    if (!favorites.has(id)) return;
    // The follow code loads now (D361); offline it fails like the fetch.
    const shows = typeof answer === "string" ? null : await transfer().catch(() => null);
    if (!favorites.has(id)) return;
    // Kept, or the store did not take it (follow throws): either way the ring says the truth.
    const kept =
      shows !== null &&
      typeof answer !== "string" &&
      (await shows.follow(answer).then(
        () => true,
        () => false,
      ));
    if (!kept) {
      favorites.delete(id);
      const box = boxOf(id);
      if (box) box.checked = false;
      sendToast({ message: `Couldn't add ${title}. Try again.`, kind: "error" });
      return;
    }
    if (!favorites.has(id)) await setShowFavorite(id, false, null);
  };

  const resting = none.textContent ?? "";
  const draw = (rows: readonly ShowRow[] | null): void => {
    // A list that did not load says so, where an empty one says nothing matched.
    none.textContent =
      rows === null ? "Couldn't load shows. Try again when you're back online." : resting;
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
      box.addEventListener("change", () => {
        const work = toggle(id, show.title, box.checked);
        saving.add(work);
        void work.finally(() => saving.delete(work));
      });
      cards.push(card);
    }
    list.replaceChildren(...cards);
    none.hidden = cards.length > 0 || query.value.trim() === "";
  };

  form.addEventListener("submit", (event) => event.preventDefault());
  let timer = 0;
  query.addEventListener("input", () => {
    clearTimeout(timer);
    // Every keystroke makes any answer still on its way stale, a short one included.
    const mine = ++asked;
    const term = query.value.trim();
    if (term.length < 2) return draw(suggested);
    timer = window.setTimeout(async () => {
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
  // Done or Skip mid-import would leave the page with the file half read: both wait for it.
  const leave = root.querySelectorAll<HTMLButtonElement>(
    "button[data-first-run-next], button[data-first-run-skip]",
  );
  if (section) {
    installImportPicker(section, (importing) => {
      for (const button of leave) button.disabled = importing;
    });
  }
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
  mountEachVisit("[data-first-run]", mountFirstRun);
}

/** Picks on step 2 still being saved, which Skip waits for. */
const saving = new Set<Promise<void>>();

function mountFirstRun(root: HTMLElement): void {
  const step = root.dataset.firstRun;
  if (step === "1") installTopics(root);
  if (step === "2") installShows(root);
  if (step === "3") installImport(root);
  const finish = async (): Promise<void> => {
    markFirstRunDone();
    // A show tapped a moment ago is still being saved; leaving the page now would drop it.
    await Promise.allSettled(saving);
    location.assign("/");
  };
  root.querySelector("[data-first-run-skip]")?.addEventListener("click", finish);
  // The last step's button is Done, with no address of its own.
  const next = root.querySelector<HTMLElement>("[data-first-run-next]");
  if (next && !next.hasAttribute("href")) next.addEventListener("click", finish);
}
