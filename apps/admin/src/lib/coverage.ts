/**
 * Coverage's numbers, counted at build from the reader's and this app's sources: how many files draw
 * each shared part, and how many draw each one-off control. The published design system describes
 * its parts and nothing about who draws them (its DS-2), so the class reader and the one-off list
 * are this report's own (D382 step 7). A part is drawn by a file that writes one of its classes or imports
 * one of its components; its own files are its definition, not a use. The numbers are as of this
 * app's build.
 *
 * shortcut: the admin app rebuilds only when tokens or the design system change (ignore-build.sh), so a
 * page edit that touches neither shows on the next such build; widen the list if every edit must count.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { PartKind, System } from "@singularityfm/design-system/scripts/system/types";
import { type BespokeControl, classTokens, readBespoke } from "./classReader";

export interface PartUse {
  id: string;
  name: string;
  kind: PartKind;
  summary: string;
  files: number;
}

export interface OneOffUse {
  name: string;
  reason: string;
  files: number;
}

export interface Coverage {
  parts: PartUse[];
  oneOffs: OneOffUse[];
  /** Files drawing a part, summed over parts, and the same for one-offs. */
  partUses: number;
  oneOffUses: number;
}

/** The repository's root: the first folder up from the build's own that holds the pnpm workspace file. */
export function repoRoot(from: string = process.cwd()): string {
  let dir = from;
  while (!existsSync(join(dir, "pnpm-workspace.yaml"))) {
    const up = dirname(dir);
    if (up === dir) throw new Error(`No pnpm-workspace.yaml above ${from}`);
    dir = up;
  }
  return dir;
}

const stem = (path: string): string => (path.split("/").pop() ?? path).replace(/\.\w+$/, "");

/** Whether `text` imports a module named `name` (any folder, any extension). */
const importsModule = (text: string, name: string): boolean =>
  new RegExp(`from\\s+["'][^"']*/${name}(?:\\.\\w+)?["']`).test(text);

interface Source {
  path: string;
  text: string;
  tokens: Set<string>;
}

/**
 * The apps' own files, found from the repository root (this app's bundle has no path of its own). The
 * design system's files are its definition, so a part one of them draws is not counted as the apps
 * drawing it.
 */
export function appSources(root: string = repoRoot()): Source[] {
  return ["apps/web/src", "apps/admin/src"]
    .flatMap((dir) =>
      readdirSync(join(root, dir), { recursive: true, encoding: "utf8" }).map((file) =>
        join(root, dir, file).split("\\").join("/"),
      ),
    )
    .filter(
      (path) =>
        /\.(astro|tsx|ts|js)$/.test(path) &&
        !path.endsWith(".test.ts") &&
        !path.includes("/pages/design/") &&
        !path.includes("/design-system/"),
    )
    .map((path) => {
      const text = readFileSync(path, "utf8");
      return { path, text, tokens: classTokens(text) };
    });
}

/** The one-off controls the reader's style test allows, each with why it is not a shared part. */
export function bespokeControls(root: string = repoRoot()): BespokeControl[] {
  return readBespoke(readFileSync(join(root, "apps/web/src/styles/styles.test.ts"), "utf8"));
}

/**
 * The reader's files that define a part the library lists but the app draws (D382 step 7: the
 * published system.json names only the package's own files). They are a part's definition, not a
 * use, and importing one of them draws the part.
 */
export const APP_PART_FILES: Record<string, string[]> = {
  drawer: ["apps/web/src/sheets/SheetFrame.tsx"],
  "btn-action-tonal": ["apps/web/src/components/AppNav.astro"],
  "empty-state": [
    "apps/web/src/components/EmptyState.astro",
    "apps/web/src/components/EmptyArt.astro",
  ],
  multiselect: ["apps/web/src/components/MultiSelect.astro", "apps/web/src/scripts/multiSelect.ts"],
  cover: ["apps/web/src/components/Cover.astro", "apps/web/src/lib/covers.ts"],
  fab: [
    "apps/web/src/components/CreateFab.astro",
    "apps/web/src/components/AddFab.astro",
    "apps/web/src/components/PlayFab.astro",
  ],
};

/** A part's own files: the package's, then the reader's. */
const ownFiles = (part: System["parts"][number]): string[] => [
  ...(part.files ?? []),
  ...(APP_PART_FILES[part.id] ?? []),
];

export function countCoverage(
  system: System,
  sources: Source[] = appSources(),
  bespoke: BespokeControl[] = bespokeControls(),
): Coverage {
  // A module more than one part names (Button.tsx draws four) says nothing about which: those
  // parts are told apart by the classes the reader finds (a Button's variant is one).
  const owners = new Map<string, number>();
  for (const part of system.parts)
    for (const file of ownFiles(part)) owners.set(stem(file), (owners.get(stem(file)) ?? 0) + 1);
  const parts = system.parts.map((part): PartUse => {
    const own = ownFiles(part);
    const modules = own.map(stem).filter((name) => owners.get(name) === 1);
    const files = sources.filter(
      (source) =>
        !own.some((file) => source.path.endsWith(file)) &&
        (part.classes.some((name) => source.tokens.has(name)) ||
          modules.some((name) => importsModule(source.text, name))),
    ).length;
    return { id: part.id, name: part.name, kind: part.kind, summary: part.summary, files };
  });
  // A bespoke class a part lists is used through that part; the rest are built for one place.
  const oneOffs = bespoke
    .filter((control) => !system.parts.some((part) => part.classes.includes(control.class)))
    .map((control) => ({
      name: control.class,
      reason: control.reason,
      files: sources.filter((source) => source.tokens.has(control.class)).length,
    }));
  return {
    parts,
    oneOffs,
    partUses: parts.reduce((sum, part) => sum + part.files, 0),
    oneOffUses: oneOffs.reduce((sum, control) => sum + control.files, 0),
  };
}
