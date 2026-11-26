import { sendToast } from "@singularityfm/design-system/toastEvent";
import { importProgress, importSummary } from "../podcasts/importCopy";
import { exportBackup, exportOpml, type ImportOutcome, importFile } from "../podcasts/transfer";

/**
 * Wires a file picker row to the import (Settings > Import and export, first run step 3): the row
 * opens the picker, the file goes in, and the status line says how far it is and what it did,
 * with the shows the index did not know listed by name. One import at a time.
 */
export function installImportPicker(
  root: HTMLElement,
  done: (outcome: ImportOutcome) => void = () => {},
): void {
  const pick = root.querySelector<HTMLButtonElement>("[data-import-pick]");
  const input = root.querySelector<HTMLInputElement>("[data-import-file]");
  const status = root.querySelector<HTMLElement>("[data-import-status]");
  const missing = root.querySelector<HTMLUListElement>("[data-import-missing]");
  if (!pick || !input || !status || !missing) return;
  const say = (text: string): void => {
    status.textContent = text;
    status.hidden = text === "";
  };
  pick.addEventListener("click", () => {
    input.value = "";
    input.click();
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    pick.disabled = true;
    missing.hidden = true;
    missing.replaceChildren();
    say("Reading the file");
    try {
      const outcome = await importFile(file, (count, total) => say(importProgress(count, total)));
      say(importSummary(outcome));
      if (outcome.kind === "opml" && outcome.missing.length > 0) {
        for (const show of outcome.missing) {
          const item = document.createElement("li");
          item.textContent = show.title || show.feed_url;
          missing.append(item);
        }
        missing.hidden = false;
      }
      done(outcome);
    } catch {
      say("Couldn't read that file. Try again.");
    } finally {
      pick.disabled = false;
    }
  });
}

export function installImportPage(): void {
  const root = document.querySelector<HTMLElement>("[data-import-page]");
  if (!root) return;
  installImportPicker(root);
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-export]")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.export === "opml") {
          const count = await exportOpml();
          sendToast({
            message: count === 0 ? "No favorite shows to export yet" : "Shows exported",
          });
        } else {
          await exportBackup();
          sendToast({ message: "Backup saved" });
        }
      } catch {
        sendToast({ message: "Couldn't save the file", kind: "error" });
      } finally {
        button.disabled = false;
      }
    });
  }
}
