import { addShowByLink } from "../podcasts/addShow";
import { FIRST_RUN_ADDED_KEY } from "../podcasts/firstRun";

/** The Add a show page: one field, one button; a found show becomes a favorite and opens. */
export function installAddShowPage(): void {
  const form = document.querySelector<HTMLFormElement>("[data-add-show-form]");
  const input = form?.querySelector<HTMLInputElement>("[data-add-show-input]");
  const error = form?.querySelector<HTMLElement>("[data-add-show-error]");
  const go = form?.querySelector<HTMLButtonElement>("[data-add-show-go]");
  if (!form || !input || !error || !go) return;
  const fromFirstRun = new URLSearchParams(location.search).get("from") === "welcome";
  const fail = (message: string): void => {
    error.textContent = message;
    error.hidden = false;
    input.setAttribute("aria-invalid", "true");
    input.focus();
  };
  input.addEventListener("input", () => {
    error.hidden = true;
    input.removeAttribute("aria-invalid");
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (input.value.trim() === "") return fail("Paste a link to the show.");
    go.disabled = true;
    try {
      const result = await addShowByLink(input.value);
      if (!result.ok) return fail(result.message);
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
  });
}
