import { sendToast } from "@singularityfm/design-system/toastEvent";
import { addShowFrom } from "../podcasts/addShow";
import { FIRST_RUN_ADDED_KEY } from "../podcasts/firstRun";
import { importSummary } from "../podcasts/importCopy";
import { importFile } from "../podcasts/transfer";
import { installImportPicker } from "./importPage";
import { drawRows, type PodcastRow, showRow } from "./podcastRows";

/**
 * The Add a show page: one field for a name, a link or a pasted list (podcasts/addShow.ts). A show
 * found for certain is a favorite at once and its page opens; else the closest are listed to pick
 * from. Search hands a pasted link here as ?link=, which runs at once. A file dropped anywhere on the
 * page is imported, as the Choose file row does.
 */
export function installAddShowPage(): void {
  const root = document.querySelector<HTMLElement>("[data-add-show]");
  const form = root?.querySelector<HTMLFormElement>("[data-add-show-form]");
  const input = form?.querySelector<HTMLInputElement>("[data-add-show-input]");
  const error = form?.querySelector<HTMLElement>("[data-add-show-error]");
  const go = form?.querySelector<HTMLButtonElement>("[data-add-show-go]");
  const status = root?.querySelector<HTMLElement>("[data-add-show-status]");
  const matches = root?.querySelector<HTMLElement>("[data-add-show-matches]");
  const list = root?.querySelector<HTMLUListElement>("[data-add-show-list]");
  if (!root || !form || !input || !error || !go || !status || !matches || !list) return;
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

  const run = async (): Promise<void> => {
    clear();
    matches.hidden = true;
    go.disabled = true;
    status.textContent = "Looking for the show";
    try {
      const result = await addShowFrom(input.value);
      status.textContent = "";
      if (result.kind === "error") return fail(result.message);
      if (result.kind === "imported") {
        sendToast({
          message: importSummary(result.outcome),
          kind: result.outcome.kind === "problem" ? "error" : undefined,
        });
        return;
      }
      if (result.kind === "matches") {
        drawRows(
          list,
          result.shows.map(showRow).filter((row): row is PodcastRow => row !== null),
        );
        matches.hidden = false;
        status.textContent = `${result.shows.length} possible shows`;
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
    } finally {
      go.disabled = false;
    }
  };
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    void run();
  });

  // A file dropped anywhere on the page is imported; the page itself never opens it.
  document.addEventListener("dragover", (event) => {
    if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
  });
  document.addEventListener("drop", async (event) => {
    const file = event.dataTransfer?.files[0];
    if (!file) return;
    event.preventDefault();
    try {
      const outcome = await importFile(file);
      sendToast({
        message: importSummary(outcome),
        kind: outcome.kind === "problem" ? "error" : undefined,
      });
    } catch {
      sendToast({ message: "Couldn't read that file. Try again.", kind: "error" });
    }
  });

  const link = params.get("link");
  if (link) {
    input.value = link;
    void run();
  }
}
