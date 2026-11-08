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
import type { PartKind, System } from "@singularity/design-system/scripts/system/types";

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

export interface BespokeControl {
  class: string;
  reason: string;
}

/**
 * The class names a source file writes as classes: class and className attributes (or object
 * properties, as in `iconBtnHtml({ className })`), class:list entries and classList calls. A word that only looks like a class ("switch" in role="switch" or in
 * prose) is not a use, which is how a dead class once passed for a live part.
 */
function classTokens(text: string): Set<string> {
  const found = new Set<string>();
  const add = (value: string): void => {
    for (const name of value.split(/\s+/)) if (/^[a-z][\w-]*$/i.test(name)) found.add(name);
  };
  for (const [, a = "", b = "", c = ""] of text.matchAll(
    /\bclass(?:Name)?\s*[=:]\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\})/g,
  ))
    add(a || b || c);
  for (const [, list = ""] of text.matchAll(/\bclass:list\s*=\s*\{([^}]*)\}/g))
    for (const [, quoted = ""] of list.matchAll(/["'`]([^"'`]*)["'`]/g)) add(quoted);
  for (const [, args = ""] of text.matchAll(
    /classList\.(?:add|toggle|remove|contains)\(([^)]*)\)/g,
  ))
    for (const [, quoted = ""] of args.matchAll(/["'`]([^"'`]*)["'`]/g)) add(quoted);
  // The command center's scripts draw nodes with element(tag, className).
  for (const [, className = ""] of text.matchAll(
    /\belement\(\s*["'][^"']*["']\s*,\s*["']([^"']*)["']/g,
  ))
    add(className);
  // The Button draws its classes from its props, so the markup never writes them (D237).
  for (const [, props = ""] of text.matchAll(/<Button\b([^>]*)>/g)) {
    const variant = /\bvariant="(\w+)"/.exec(props)?.[1];
    const tone = /\btone="(\w+)"/.exec(props)?.[1];
    const size = /\bsize="(\w+)"/.exec(props)?.[1];
    if (variant) found.add(`button-${variant}`);
    if (tone) found.add(`button-${tone}`);
    if (size) found.add(`button-${size}`);
  }
  for (const [, variant = "", tone] of text.matchAll(
    /\bbuttonClass\(\s*["'](\w+)["'](?:\s*,\s*["'](\w+)["'])?/g,
  )) {
    found.add(`button-${variant}`);
    if (tone) found.add(`button-${tone}`);
  }
  const code = text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // The Icon is drawn by the tag, the island's tag or the class helper; the large size by its prop.
  if (/<(?:Lazy)?Icon\b|\biconClass\(|\biconHtml\(/.test(code)) found.add("icon-glyph");
  if (/<(?:Lazy)?Icon\b[^>]*\bsize="lg"|\bicon(?:Class|Html)\([^)]*["']lg["']/.test(code)) {
    found.add("icon-glyph-lg");
  }
  if (/<PlayPauseIcons\b[^>]*\bsize="lg"/.test(code)) found.add("icon-glyph-lg");
  // The Badge is a single-class component, drawn by the tag or by the class helper.
  if (/<Badge\b|\bbadgeClass\(/.test(code)) found.add("badge-label");
  // The Switch and the Slider are single-class components, drawn by the tag or by the class helper.
  if (/<Switch\b|\bswitchClass\(/.test(code)) found.add("switch-input");
  if (/<Slider\b|\bsliderClass\(/.test(code)) found.add("slider-input");
  // The Field is drawn by the tag (not Base UI's Field.Root) or by the class helper, for a select.
  if (/<Field(?![\w.])|\bfieldClass\(/.test(code)) found.add("field-input");
  // The Select is drawn by the tag or by the class helper, in the variant it names (outlined by default).
  if (/<Select\b/.test(code)) {
    const tonal = [...code.matchAll(/<Select\b[^>]*\bvariant="tonal"/g)].length;
    const all = [...code.matchAll(/<Select\b/g)].length;
    if (tonal > 0) found.add("select-tonal");
    if (all > tonal) found.add("select-outlined");
  }
  // The Menu: its list by the tag or the class helper, its rows likewise (the danger tone by its name).
  if (/<Menu\b|\bmenuListClass\(|\bmenuSheetClass\(/.test(code)) {
    found.add("menu-list");
    found.add("menu-sheet");
  }
  if (/<MenuItem\b|\bmenuItemClass\(/.test(code)) found.add("menu-item");
  if (
    /<MenuItem\b[^>]*\btone="danger"|\bmenuItemClass\(\s*["']danger["']|tone:\s*["']danger["']/.test(
      code,
    )
  ) {
    found.add("menu-item-danger");
  }
  // The tiles and the value come by their class helpers.
  if (/\bmenuTilesClass\(/.test(code)) found.add("menu-tiles");
  if (/\bmenuTileClass\(/.test(code)) found.add("menu-tile");
  if (/\bmenuItemValueClass\(/.test(code)) found.add("menu-item-value");
  // The Dialog: the tag, its actions row (stacked by its prop), its heading, or the class helpers.
  if (/<Dialog\b|\bdialogClass\(/.test(code)) {
    found.add("dialog-panel");
    found.add("dialog-body");
  }
  // The Sheet: the tag (its header and body come with it) or the helpers a script builds with.
  if (/<Sheet\b|\bsheetClass\(/.test(code)) {
    found.add("sheet-side");
    found.add("sheet-head");
    found.add("sheet-body");
    found.add("sheet-title");
  }
  if (/\bsheetHeadClass\(|\bsheetHeadHtml\(|<SheetHeader\b/.test(code)) {
    found.add("sheet-head");
    found.add("sheet-title");
  }
  if (/\bsheetBodyClass\(/.test(code)) found.add("sheet-body");
  if (/\bsheetTitleClass\(/.test(code)) found.add("sheet-title");
  // The Drawer: SheetFrame draws it from the helpers.
  for (const [helper, name] of [
    ["drawerScrimClass", "drawer-scrim"],
    ["drawerViewportClass", "drawer-viewport"],
    ["drawerPopupClass", "drawer-popup"],
    ["drawerPanelClass", "drawer-panel"],
  ] as const) {
    if (code.includes(`${helper}(`)) found.add(name);
  }
  if (/<DialogActions\b|\bdialogActionsClass\(/.test(code)) found.add("dialog-actions");
  if (/<DialogActions\b[^>]*\bstacked\b|\bdialogActionsClass\(\s*true/.test(code)) {
    found.add("dialog-actions-stacked");
  }
  // The Banner is drawn by the tag or by the class helper; its parts come with it.
  if (/<Banner\b|\bbannerClass\(/.test(code)) {
    for (const name of ["banner-notice", "banner-text", "banner-title", "banner-body"])
      found.add(name);
  }
  for (const [, variant = "outlined"] of code.matchAll(/\bselectClass\(\s*(?:["'](\w+)["'])?/g)) {
    found.add(`select-${variant}`);
  }
  return found;
}

/** The bespoke controls and their reasons, read from the list the style test enforces. */
function readBespoke(text: string): BespokeControl[] {
  const start = text.indexOf("const BESPOKE_CONTROLS");
  if (start < 0) return [];
  const end = text.indexOf("\n];", start);
  return [
    ...text.slice(start, end).matchAll(/\[\s*"([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\]/g),
  ].map(([, name = "", reason = ""]) => ({ class: name, reason }));
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

export function countCoverage(
  system: System,
  sources: Source[] = appSources(),
  bespoke: BespokeControl[] = bespokeControls(),
): Coverage {
  // A module more than one part names (Button.astro draws four) says nothing about which: those
  // parts are told apart by the classes the reader finds (a Button's variant is one).
  const owners = new Map<string, number>();
  for (const part of system.parts)
    for (const file of part.files ?? []) owners.set(stem(file), (owners.get(stem(file)) ?? 0) + 1);
  const parts = system.parts.map((part): PartUse => {
    const own = part.files ?? [];
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
