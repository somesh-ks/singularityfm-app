import { addShowByLink } from "../podcasts/addShow";

/** The Add a show page: one field, one button; a found show becomes a favorite and opens. */
export function installAddShowPage(): void {
  const form = document.querySelector<HTMLFormElement>("[data-add-show-form]");
  const input = form?.querySelector<HTMLInputElement>("[data-add-show-input]");
  const error = form?.querySelector<HTMLElement>("[data-add-show-error]");
  const go = form?.querySelector<HTMLButtonElement>("[data-add-show-go]");
  if (!form || !input || !error || !go) return;
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
      // Its page's heart shows it is a favorite now.
      location.assign(result.url);
    } finally {
      go.disabled = false;
    }
  });
}
