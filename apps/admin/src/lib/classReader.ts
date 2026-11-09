/**
 * Coverage's class reader: the class names a source file writes, and the one-off controls the
 * reader's style test allows. It names every part's classes to count them and draws none, so
 * systemUse.test.ts reads past this file only (D382 step 7: the library no longer counts its uses).
 */

export interface BespokeControl {
  class: string;
  reason: string;
}

/**
 * The class names a source file writes as classes: class and className attributes (or object
 * properties, as in `iconBtnHtml({ className })`), class:list entries and classList calls. A word that only looks like a class ("switch" in role="switch" or in
 * prose) is not a use, which is how a dead class once passed for a live part.
 */
export function classTokens(text: string): Set<string> {
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
  // The Icon button, the Link and the FAB draw their classes from their props (D237): the tag or the
  // class helper, the tonal and row-end variants by their props, the Play face by the FAB's classes.
  // The lookaheads keep these patterns from matching their own text here, and a Link has an address,
  // so a type (`Promise<Link>`) is no use.
  if (/<IconButton(?=[\s/>])|\biconButtonClass\(/.test(code)) found.add("icon-btn");
  if (/<IconButton(?=\s)[^>]*\bvariant="tonal"|\biconButtonClass\(\s*["']tonal["']/.test(code)) {
    found.add("icon-btn-tonal");
  }
  if (/<IconButton(?=\s)[^>]*\browEnd\b|\biconButtonClass\([^)]*\btrue\b/.test(code)) {
    found.add("icon-btn-end");
  }
  for (const [, props = ""] of code.matchAll(/<Link(?=\s)([^>]*\bhref=[^>]*)>/g)) {
    found.add(/\bvariant="source"/.test(props) ? "source-link" : "text-link");
  }
  if (/<Fab(?=[\s/>])|\bimport \{[^}]*\bFAB_CLASSES\b[^}]*\} from/.test(code)) {
    found.add("create-fab");
    found.add("create-fab-label");
  }
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
export function readBespoke(text: string): BespokeControl[] {
  const start = text.indexOf("const BESPOKE_CONTROLS");
  if (start < 0) return [];
  const end = text.indexOf("\n];", start);
  return [
    ...text.slice(start, end).matchAll(/\[\s*"([a-z0-9-]+)",\s*"((?:[^"\\]|\\.)*)"\s*,?\s*\]/g),
  ].map(([, name = "", reason = ""]) => ({ class: name, reason }));
}
