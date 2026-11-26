import { addShowByLink } from "../podcasts/addShow";
import { favoriteShows, setShowFavorite } from "../podcasts/deviceStore";
import { coverAt } from "../podcasts/episodeDigest";
import {
  markFirstRunDone,
  pickedCategories,
  pickedTopics,
  setPickedTopics,
} from "../podcasts/firstRun";
import { fetchShow, findShow } from "../podcasts/shows";
import { follow } from "../podcasts/transfer";
import type { ShowRow } from "../server/podcasts/shapes";
import { installImportPicker } from "./importPage";

/**
 * First run's three steps (pages/welcome*.astro). Each step keeps its picks as they are made, so
 * Skip at any step keeps what was done and ends first run; Done on the last does the same.
 */

/** The most shows step 2 offers before a search: two rows of the phone's grid, three of desktop's. */
const SUGGESTED = 12;
/** How many of the picked topics' charts step 2 reads: enough to mix them, few enough to be quick. */
const CHARTS = 3;

async function shows(path: string): Promise<ShowRow[]> {
  try {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) return [];
    const body = (await response.json()) as { shows?: ShowRow[] };
    return Array.isArray(body.shows) ? body.shows : [];
  } catch {
    return [];
  }
}

/** The picked topics' charts, interleaved so the first row mixes them, each show once. */
async function suggestions(): Promise<ShowRow[]> {
  const categories = pickedCategories().slice(0, CHARTS);
  const charts = await Promise.all(
    (categories.length > 0 ? categories : [""]).map((topic) =>
      shows(`/api/podcasts/trending${topic ? `?topic=${encodeURIComponent(topic)}` : ""}`),
    ),
  );
  const seen = new Set<string>();
  const mixed: ShowRow[] = [];
  for (let i = 0; mixed.length < SUGGESTED && charts.some((chart) => i < chart.length); i++) {
    for (const chart of charts) {
      const show = chart[i];
      const key = show ? `${show.id ?? `a${show.apple_id}`}` : "";
      if (!show || seen.has(key) || mixed.length >= SUGGESTED) continue;
      seen.add(key);
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
  let suggested: ShowRow[] = [];
  let asked = 0;

  const draw = (rows: readonly ShowRow[]): void => {
    list.replaceChildren(
      ...rows.map((show) => {
        const card = template.content.firstElementChild?.cloneNode(true) as HTMLElement;
        const press = card.querySelector<HTMLButtonElement>("button") as HTMLButtonElement;
        const image = card.querySelector<HTMLImageElement>("img") as HTMLImageElement;
        if (show.cover) image.src = coverAt(show.cover, 256);
        else image.remove();
        (card.querySelector(".card-title") as HTMLElement).textContent = show.title;
        (card.querySelector(".card-facts") as HTMLElement).textContent = show.author;
        press.setAttribute("aria-pressed", String(show.id !== null && favorites.has(show.id)));
        press.addEventListener("click", () => void toggle(show, press));
        return card;
      }),
    );
    none.hidden = rows.length > 0 || query.value.trim() === "";
  };

  const toggle = async (show: ShowRow, press: HTMLButtonElement): Promise<void> => {
    const on = press.getAttribute("aria-pressed") !== "true";
    // Rings at once; a show that cannot be read gives its ring back.
    press.setAttribute("aria-pressed", String(on));
    if (!on && show.id !== null) {
      favorites.delete(show.id);
      await setShowFavorite(show.id, false, null);
      status.textContent = `Removed ${show.title}`;
      return;
    }
    const answer =
      show.id !== null
        ? await fetchShow(show.id)
        : show.apple_id !== null
          ? await findShow({ apple: show.apple_id })
          : "failed";
    if (typeof answer === "string" || answer.show.id === null) {
      press.setAttribute("aria-pressed", "false");
      status.textContent = `Couldn't add ${show.title}. Try again.`;
      return;
    }
    favorites.add(answer.show.id);
    await follow(answer);
    status.textContent = `Added ${show.title}`;
  };

  form.addEventListener("submit", (event) => event.preventDefault());
  let timer = 0;
  query.addEventListener("input", () => {
    clearTimeout(timer);
    const term = query.value.trim();
    if (term.length < 2) return draw(suggested);
    timer = window.setTimeout(async () => {
      const mine = ++asked;
      const found = await shows(`/api/podcasts/search?q=${encodeURIComponent(term)}`);
      if (mine === asked) draw(found);
    }, 300);
  });

  void (async () => {
    for (const show of await favoriteShows()) favorites.add(show.id);
    suggested = await suggestions();
    if (query.value.trim().length < 2) draw(suggested);
  })();
}

function installImport(root: HTMLElement): void {
  const section = root.querySelector<HTMLElement>("[data-import-page]");
  if (!section) return;
  installImportPicker(section);
  const paste = section.querySelector<HTMLButtonElement>("[data-first-run-paste]");
  const form = section.querySelector<HTMLFormElement>("[data-add-show-form]");
  const input = form?.querySelector<HTMLInputElement>("[data-add-show-input]");
  const error = form?.querySelector<HTMLElement>("[data-add-show-error]");
  const status = section.querySelector<HTMLElement>("[data-import-status]");
  if (!paste || !form || !input || !error || !status) return;
  paste.addEventListener("click", () => {
    form.hidden = false;
    paste.setAttribute("aria-expanded", "true");
    input.focus();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.hidden = true;
    const result = await addShowByLink(input.value);
    if (!result.ok) {
      error.textContent = result.message;
      error.hidden = false;
      input.focus();
      return;
    }
    input.value = "";
    status.textContent = result.added
      ? `Added ${result.title} to your favorites.`
      : `${result.title} is already a favorite.`;
    status.hidden = false;
  });
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
