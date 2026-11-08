import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Compiles the design system's tokens/glyphs.json into the React player's two icon registries (a
 * small one that loads with every page, and the full one for code that loads on demand). The
 * package's Icon reads the same file, so a glyph can never look different in the two places.
 * The package owns glyphs.json, its page registry and the fetch from Phosphor (D382 step 8).
 *
 *   npx tsx scripts/buildGlyphs.ts           writes the registries
 *   npx tsx scripts/buildGlyphs.ts --check   fails when a committed registry is stale
 */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const GLYPHS_PATH = createRequire(import.meta.url).resolve(
  "@singularityfm/design-system/tokens/glyphs.json",
);
export const PLAYER_REGISTRY_PATH = resolve(ROOT, "apps/web/src/player/ui/iconPaths.tsx");
/** Every player glyph. Only code that loads on demand imports it, so its size costs no page load. */
export const PLAYER_LAZY_REGISTRY_PATH = resolve(ROOT, "apps/web/src/player/ui/iconPathsLazy.tsx");

export const GENERATED_HEADER = "GENERATED FILE. Do not edit.";
const LINE_WIDTH = 100;

/** A Phosphor icon name: lower-case words joined by hyphens. */
const SYMBOL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type GlyphWeight = "regular" | "fill" | "bold";

export type GlyphTarget = "page" | "player" | "playerLazy";

export interface Glyph {
  /** Phosphor icon name, kebab-case. */
  phosphor: string;
  /** The Phosphor weight the path is taken from. */
  weight: GlyphWeight;
  targets: GlyphTarget[];
  /** The single path of the icon, in the document's view box. */
  d: string;
  /**
   * The same icon in Phosphor's bold weight, on a regular glyph. The Icon draws both and a token
   * (component.icon.bold) chooses which one shows, so a style can thicken every icon (D268).
   */
  bold?: string;
  /**
   * How the paths were cut from the Phosphor icon named above, when the set has no icon for the
   * need. The package's fetch keeps a derived glyph's paths as written.
   */
  derived?: string;
}

export interface GlyphDocument {
  $description: string;
  viewBox: string;
  source: string;
  sourceVersion: string;
  glyphs: Record<string, Glyph>;
}

export function loadGlyphs(path: string = GLYPHS_PATH): GlyphDocument {
  return JSON.parse(readFileSync(path, "utf8")) as GlyphDocument;
}

/** Problems that would produce a broken or misleading registry. Empty when the document is sound. */
export function validateGlyphs(doc: GlyphDocument): string[] {
  const problems: string[] = [];
  if (!/^-?\d+ -?\d+ \d+ \d+$/.test(doc.viewBox)) problems.push(`viewBox "${doc.viewBox}"`);
  for (const [name, glyph] of Object.entries(doc.glyphs)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) problems.push(`${name}: name is not camelCase`);
    if (!SYMBOL_NAME.test(glyph.phosphor ?? "")) problems.push(`${name}: no Phosphor name`);
    if (!["regular", "fill", "bold"].includes(glyph.weight)) problems.push(`${name}: no weight`);
    if (glyph.targets.length === 0) problems.push(`${name}: no target`);
    for (const target of glyph.targets) {
      if (target !== "page" && target !== "player" && target !== "playerLazy")
        problems.push(`${name}: target "${target}"`);
    }
    // A path is move, line and curve commands only. Anything else is not a path from the set.
    if (!/^[Mm][\dA-Za-z .,-]+$/.test(glyph.d)) {
      problems.push(`${name}: path is missing or malformed`);
    }
    if (glyph.bold !== undefined) {
      if (glyph.weight !== "regular")
        problems.push(`${name}: only a regular glyph has a bold twin`);
      else if (!/^[Mm][\dA-Za-z .,-]+$/.test(glyph.bold))
        problems.push(`${name}: bold path is malformed`);
    }
  }
  return problems;
}

function namesFor(doc: GlyphDocument, target: GlyphTarget): string[] {
  return Object.keys(doc.glyphs)
    .filter((name) => doc.glyphs[name]?.targets.includes(target))
    .sort();
}

/**
 * One object property the way the formatter prints it, so the generated file passes the lint
 * untouched: on one line when it fits, otherwise broken after the colon, except that a key shorter
 * than five characters never breaks (the overlap would be too small to help).
 */
function property(name: string, value: string, indent: string): string {
  const oneLine = `${indent}${name}: ${value},`;
  if (oneLine.length <= LINE_WIDTH || name.length < 5) return oneLine;
  return `${indent}${name}:\n${indent}  ${value},`;
}

function header(what: string): string[] {
  return [
    "/**",
    ` * ${GENERATED_HEADER} Source: tokens/glyphs.json, compiled by scripts/buildGlyphs.ts.`,
    " *",
    ` * ${what}`,
    " * One icon set: Phosphor, regular weight, with the fill weight where a glyph must read as",
    " * solid, the bold weight for the plus, and the bold dots for More",
    " * (Phosphor Icons, MIT License). Every glyph is one filled path in currentColor.",
    " * Decorative by default: the button or link that holds an icon carries the accessible name.",
    " */",
  ];
}

/** The bold twins of the listed glyphs, as the second registry every Icon reads beside the first. */
function boldRegistry(doc: GlyphDocument, names: string[]): string[] {
  const twins = names.filter((name) => doc.glyphs[name]?.bold !== undefined);
  return [
    "/** Phosphor's bold weight of a regular glyph. A token (component.icon.bold) picks which one shows. */",
    "export const ICON_BOLD_PATHS: Partial<Record<keyof typeof ICON_PATHS, string>> = {",
    ...twins.map((name) => property(name, JSON.stringify(doc.glyphs[name]?.bold ?? ""), "  ")),
    "};",
    "",
  ];
}

/** Null while no glyph targets the player, so the hand-written registry is left alone. */
export function buildPlayerRegistry(doc: GlyphDocument): string | null {
  const names = namesFor(doc, "player");
  if (names.length === 0) return null;
  const lines = [
    ...header(
      "The glyphs the React player's first load draws, offline too; lazy code uses LazyIcon.",
    ),
    `export const ICON_VIEW_BOX = "${doc.viewBox}";`,
    "",
    "export const ICON_PATHS = {",
    ...names.map((name) => property(name, JSON.stringify(doc.glyphs[name]?.d ?? ""), "  ")),
    "} as const;",
    "",
    "export type IconName = keyof typeof ICON_PATHS;",
    "",
    ...boldRegistry(doc, names),
  ];
  return lines.join("\n");
}

/** The full player registry: the first-load glyphs and the ones only on-demand code draws. */
export function buildPlayerLazyRegistry(doc: GlyphDocument): string {
  const names = [...new Set([...namesFor(doc, "player"), ...namesFor(doc, "playerLazy")])].sort();
  const lines = [
    ...header("The full icon registry for the React player, for code that loads on demand."),
    `export const ICON_VIEW_BOX = "${doc.viewBox}";`,
    "",
    "export const ICON_PATHS = {",
    ...names.map((name) => property(name, JSON.stringify(doc.glyphs[name]?.d ?? ""), "  ")),
    "} as const;",
    "",
    "export type IconName = keyof typeof ICON_PATHS;",
    "",
    ...boldRegistry(doc, names),
  ];
  return lines.join("\n");
}

/** Whether a committed registry is one this script wrote, as opposed to a hand-written one. */
export function isGenerated(source: string): boolean {
  return source.includes(GENERATED_HEADER);
}

function writeRegistries(doc: GlyphDocument, check: boolean): number {
  const problems = validateGlyphs(doc);
  if (problems.length > 0) {
    for (const problem of problems) console.error(`glyphs.json: ${problem}`);
    return 1;
  }
  const outputs: Array<[string, string | null]> = [
    [PLAYER_REGISTRY_PATH, buildPlayerRegistry(doc)],
    [PLAYER_LAZY_REGISTRY_PATH, buildPlayerLazyRegistry(doc)],
  ];
  let stale = 0;
  for (const [path, source] of outputs) {
    if (source === null) continue;
    let current = "";
    try {
      current = readFileSync(path, "utf8");
    } catch {
      current = "";
    }
    // A registry that was written by hand is replaced only on request, never by a routine build.
    if (path === PLAYER_REGISTRY_PATH && current !== "" && !isGenerated(current)) continue;
    if (current === source) continue;
    if (check) {
      console.error(`${path} is stale. Run: npm run glyphs`);
      stale += 1;
    } else {
      writeFileSync(path, source, "utf8");
      console.log(`Wrote ${path}`);
    }
  }
  return stale > 0 ? 1 : 0;
}

async function main(): Promise<number> {
  const args = new Set(process.argv.slice(2));
  return writeRegistries(loadGlyphs(), args.has("--check"));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    },
  );
}
