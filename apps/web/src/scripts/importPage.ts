import { sendToast } from "@singularityfm/design-system/toastEvent";
import { importProgress, importSummary } from "../podcasts/importCopy";
import type { ImportOutcome } from "../podcasts/transfer";
import { mountEachVisit } from "./pageMount";

// Loaded on the action: the file formats stay off each page's first load (D361).
export const transfer = () => import("../podcasts/transfer");

/**
 * Wires a file picker row to the import (Settings > Import and export, first run step 3): the row
 * opens the picker, the file goes in, the row's line says how far it is and a toast what it did,
 * with the shows the index did not know listed by name. One import at a time; `busy` hears when one
 * starts and ends, so a page can hold what would leave it mid-import.
 */
export function installImportPicker(
  root: HTMLElement,
  busy: (importing: boolean) => void = () => {},
): void {
  const pick = root.querySelector<HTMLButtonElement>("[data-import-pick]");
  const input = root.querySelector<HTMLInputElement>("[data-import-file]");
  const hint = root.querySelector<HTMLElement>("[data-import-hint]");
  const status = root.querySelector<HTMLElement>("[data-import-status]");
  const missing = root.querySelector<HTMLElement>("[data-import-missing]");
  const missingList = root.querySelector<HTMLUListElement>("[data-import-missing-list]");
  if (!pick || !input || !hint || !status || !missing || !missingList) return;
  const resting = hint.textContent ?? "";
  // The row's own line says how far it is; the screen reader hears the same.
  const say = (text: string): void => {
    hint.textContent = text || resting;
    status.textContent = text;
  };
  pick.addEventListener("click", () => {
    input.value = "";
    input.click();
  });
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    pick.disabled = true;
    busy(true);
    missing.hidden = true;
    missingList.replaceChildren();
    say("Reading the file");
    try {
      const outcome = await (await transfer()).importFile(file, (count, total) =>
        say(importProgress(count, total)),
      );
      say("");
      reportImport(root, outcome);
    } catch {
      say("");
      sendToast({ message: "Couldn't read that file. Try again.", kind: "error" });
    } finally {
      pick.disabled = false;
      busy(false);
    }
  });
}

/**
 * Says what an import did: a toast, and the shows the index did not know listed by name under the
 * picker ([data-import-missing]), so they can be searched for. Shared by a chosen, dropped or
 * pasted import.
 */
export function reportImport(root: HTMLElement, outcome: ImportOutcome): void {
  sendToast({
    message: importSummary(outcome),
    kind: outcome.kind === "problem" ? "error" : undefined,
  });
  const missing = root.querySelector<HTMLElement>("[data-import-missing]");
  const list = root.querySelector<HTMLUListElement>("[data-import-missing-list]");
  if (!missing || !list) return;
  list.replaceChildren();
  missing.hidden = true;
  if (outcome.kind !== "opml" || outcome.missing.length === 0) return;
  for (const show of outcome.missing) {
    const item = document.createElement("li");
    item.textContent = show.title || show.feed_url;
    list.append(item);
  }
  missing.hidden = false;
}

export function installImportPage(): void {
  mountEachVisit("[data-import-settings]", mountImportPage);
}

function mountImportPage(root: HTMLElement): void {
  installImportPicker(root);
  for (const button of root.querySelectorAll<HTMLButtonElement>("[data-export]")) {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        if (button.dataset.export === "opml") {
          const count = await (await transfer()).exportOpml();
          sendToast({
            message: count === 0 ? "No favorite shows to export yet" : "Shows exported",
          });
        } else {
          const saved = await (await transfer()).exportBackup();
          sendToast(
            saved === "saved"
              ? { message: "Backup saved" }
              : { message: "Too much for one backup. Export your shows instead.", kind: "error" },
          );
        }
      } catch {
        sendToast({ message: "Couldn't save the file", kind: "error" });
      } finally {
        button.disabled = false;
      }
    });
  }
}
