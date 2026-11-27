import { sendToast } from "@singularityfm/design-system/toastEvent";
import { type AddShowResult, addPicked, addShowFrom } from "../podcasts/addShow";
import { FIRST_RUN_ADDED_KEY } from "../podcasts/firstRun";
import { installImportPicker, reportImport, transfer } from "./importPage";
import { mountEachVisit } from "./pageMount";
import { drawRows, type PodcastRow, showRow } from "./podcastRows";

/**
 * The Add a show page: one field for a name, a link or a pasted list (podcasts/addShow.ts). A show
 * found for certain is a favorite at once and its page opens; else the closest are listed to pick
 * from. Search hands a pasted link here as ?link=, which looks at once but follows nothing until the
 * show is tapped. A file dropped anywhere on the page is imported, as the Choose file row does.
 */
export function installAddShowPage(): void {
  mountEachVisit("[data-add-show]", mountAddShow);
}

function mountAddShow(root: HTMLElement, life: AbortSignal): void {
  const form = root.querySelector<HTMLFormElement>("[data-add-show-form]");
  const input = form?.querySelector<HTMLInputElement>("[data-add-show-input]");
  const error = form?.querySelector<HTMLElement>("[data-add-show-error]");
  const go = form?.querySelector<HTMLButtonElement>("[data-add-show-go]");
  const status = root.querySelector<HTMLElement>("[data-add-show-status]");
  const matches = root.querySelector<HTMLElement>("[data-add-show-matches]");
  const list = root.querySelector<HTMLUListElement>("[data-add-show-list]");
  if (!form || !input || !error || !go || !status || !matches || !list) return;
  const params = new URLSearchParams(location.search);
  const fromFirstRun = params.get("from") === "welcome";
  installImportPicker(root);

  const clear = (): void => {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  };
  const fail = (message: string): void => {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  };
  input.addEventListener("input", clear);

  const words = go.querySelector<HTMLElement>("[data-add-show-go-text]");
  const rest = words?.textContent ?? "";
  // Working: the button keeps its fill and focus, says so and spins (CreateForm's busy button).
  let working = false;
  const busy = (on: boolean): void => {
    working = on;
    for (const name of ["aria-disabled", "aria-busy", "data-busy"]) {
      if (on) go.setAttribute(name, "true");
      else go.removeAttribute(name);
    }
    if (words) words.textContent = on ? "Looking" : rest;
  };

  const settle = (result: AddShowResult): void => {
    if (result.kind === "error") {
      fail(result.message);
      return;
    }
    if (result.kind === "imported") {
      reportImport(root, result.outcome);
      return;
    }
    if (result.kind === "matches") {
      drawRows(
        list,
        result.shows.map(showRow).filter((row): row is PodcastRow => row !== null),
      );
      matches.hidden = false;
      status.textContent =
        result.shows.length === 1 ? "Found one show" : `${result.shows.length} possible shows`;
      return;
    }
    // From first run, back to its last step, which says so; else the show's page, whose heart
    // shows it is a favorite now.
    if (fromFirstRun) {
      try {
        sessionStorage.setItem(FIRST_RUN_ADDED_KEY, result.title);
      } catch {
        // Best effort: the step still lists the show on Home.
      }
      location.assign("/welcome/import");
      return;
    }
    location.assign(result.url);
  };

  const run = async (confirm = false): Promise<void> => {
    if (working) return;
    clear();
    matches.hidden = true;
    busy(true);
    status.textContent = "Looking for the show";
    try {
      const result = await addShowFrom(input.value, confirm);
      status.textContent = "";
      settle(result);
    } finally {
      busy(false);
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run();
  });

  // A match tapped is added as a certain find is: favorited, then its page (or first run's step).
  list.addEventListener("click", async (event) => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    const id = Number(new URL(link?.href ?? location.href).searchParams.get("id"));
    if (!link || !Number.isInteger(id) || id <= 0) return;
    event.preventDefault();
    if (working) return;
    busy(true);
    try {
      settle(await addPicked(id));
    } finally {
      busy(false);
    }
  });

  // A file dropped anywhere on the page is imported; the page itself never opens it.
  const on = { signal: life };
  document.addEventListener(
    "dragover",
    (event) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    },
    on,
  );
  document.addEventListener(
    "drop",
    async (event) => {
      const file = event.dataTransfer?.files[0];
      if (!file) return;
      event.preventDefault();
      try {
        reportImport(root, await (await transfer()).importFile(file));
      } catch {
        sendToast({ message: "Couldn't read that file. Try again.", kind: "error" });
      }
    },
    on,
  );

  const link = params.get("link");
  if (link) {
    input.value = link;
    void run(true);
  }
}
