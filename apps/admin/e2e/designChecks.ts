import type { Page } from "@playwright/test";

/**
 * The 8pt system as the browser draws it, for the admin's pages: the reader's checks in
 * apps/web/e2e/designSystem.spec.ts, copied with their exemptions when the admin's sweep left the
 * reader's suite (D382 step 4).
 * shortcut: two copies drift; move these checks into the design system package (page checks that
 * take each app's exemptions) and have both suites import them.
 */

/** The 1px border compensations: a box that sits inside a hairline keeps the grid outside it. */
const HAIRLINE = [
  ".chip",
  ".filter-chip",
  ".select-tonal",
  ".search-field",
  ".tab",
  ".tabs",
  ".app-nav-create",
  ".create-fab",
  ".field-input",
];

/**
 * Boxes centred on a neighbour by half the difference of two sizes (a 44px target on a 24px glyph,
 * a control in its row, a 4px track on its line): the offset follows those sizes, not the scale.
 * Drawn glyphs (the playing bars) and the visually hidden text are not spacing at all.
 */
const EXEMPT = [
  ".sr-only",
  // A phone sheet's Close is visually hidden (D144), as the utility above.
  ".sheet-head > .icon-btn",
  ".chip-bars",
  ".story-menu",
  ".hero-more",
  ".scrubber-track",
  ".player-dock",
  // A 44px target around an 18px box, reaching past it so the box meets a card's edge (topics.css).
  ".topic-panel .source-check",
  // An optical nudge sized by the glyph's own side bearing (--ink-end, D187), so its ink meets the
  // row's end: a row's chevron, a select's or a multi-select's in a row, Create's More options and
  // an icon button that ends a row.
  ".row-action .icon-glyph",
  ".settings-row .value-select > select.field-input",
  ".settings-row .multiselect-trigger",
  ".create-more-chevron",
  ".icon-btn-end",
  // An optical pad sized by the font's metrics, so the emoji's ink sits in its cell's centre.
  ".emoji-cell",
  // Centred on the title's first line by the label's leading (banner.css); kept for any page that
  // shows a banner (the catalogue that always showed one is gone).
  ".banner-notice > .icon-glyph",
];

/** Every visible element's spacing that is off the 4px grid, as `selector property value`. */
export async function offGrid(page: Page): Promise<string[]> {
  // An opening surface settles first; a looping or scroll-driven animation never ends.
  await page.waitForFunction(() =>
    document
      .getAnimations()
      .every(
        (animation) =>
          animation.playState !== "running" ||
          animation.timeline !== document.timeline ||
          !Number.isFinite(Number(animation.effect?.getComputedTiming().endTime)),
      ),
  );
  return page.evaluate(
    ([hairline, exempt]) => {
      const properties = [
        "margin-top",
        "margin-right",
        "margin-bottom",
        "margin-left",
        "padding-top",
        "padding-right",
        "padding-bottom",
        "padding-left",
        "row-gap",
        "column-gap",
      ];
      const found: string[] = [];
      for (const element of document.querySelectorAll<HTMLElement>("body *")) {
        if (!element.checkVisibility?.({ visibilityProperty: true })) continue;
        const style = element.computedStyleMap();
        for (const property of properties) {
          // The computed value: `auto` and `normal` stay keywords, a length resolves to px.
          const value = style.get(property);
          if (!(value instanceof CSSUnitValue) || value.unit !== "px") continue;
          const px = Math.abs(value.value);
          const rest = px % 4;
          if (rest < 0.01 || 4 - rest < 0.01) continue;
          const nearHairline = Math.abs(rest - 1) < 0.01 || Math.abs(rest - 3) < 0.01;
          if (nearHairline && hairline.some((selector) => element.closest(selector))) continue;
          if (exempt.some((selector) => element.matches(selector))) continue;
          const name = `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join("")}`;
          found.push(`${name} ${property} ${value.value}px`);
        }
      }
      return [...new Set(found)];
    },
    [HAIRLINE, EXEMPT] as const,
  );
}

/**
 * A card's rows that start off the edge its other content starts on, as `row starts +16px`. A
 * topic's source rows once sat 16px inside the Sources heading, the search field and the count line
 * above them, so the list looked squeezed (owner, 2026-11-05). A card is any rounded, filled box of
 * the page; its section headings, hint lines, fields and rows are compared with each other, never
 * with a pinned value. A row's edge is its first glyph, word or picture; a field's is its box.
 */
export async function offCardEdge(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const shown = (element: Element) =>
      element.checkVisibility?.({ visibilityProperty: true }) &&
      element.getBoundingClientRect().width > 0;
    const filled = (element: Element) =>
      getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)";
    const name = (element: Element) =>
      `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join("")}`;
    const cards = [...document.querySelectorAll("main *")].filter((element) => {
      const box = element.getBoundingClientRect();
      return (
        shown(element) &&
        filled(element) &&
        parseFloat(getComputedStyle(element).borderTopLeftRadius) >= 16 &&
        box.width >= 240 &&
        box.height >= 100 &&
        !element.matches("a, button, input, select, textarea, label, img, .search-field")
      );
    });
    const FIELD = ".search-wrap, .field-input, select, textarea";
    const found: string[] = [];
    for (const card of cards) {
      const all = [
        ...card.querySelectorAll(
          `h2, h3, li, .settings-row, .row-action, .settings-hint, ${FIELD}`,
        ),
      ].filter(
        (item) =>
          shown(item) &&
          !cards.some((inner) => inner !== card && card.contains(inner) && inner.contains(item)),
      );
      const items = all.filter(
        (item) => !all.some((outer) => outer !== item && outer.contains(item)),
      );
      // Where each piece of the card's content starts: a text's first letter, a glyph's slot (a
      // glyph sits centred in its box, so a narrower mark is not off the edge), a field's or a
      // filled tile's own box.
      const marks: { left: number; top: number; bottom: number; node: Node }[] = [];
      const walker = document.createTreeWalker(
        card,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const element = node instanceof Element ? node : node.parentElement;
        if (!element || !shown(element) || element.closest(".sr-only, option")) continue;
        let box: DOMRect | undefined;
        if (node instanceof Text && node.textContent?.trim()) {
          const range = document.createRange();
          range.selectNodeContents(node);
          box = range.getBoundingClientRect();
        } else if (
          node instanceof Element &&
          node.matches(`${FIELD}, img, svg, .suggest-box, .source-initial`)
        ) {
          let slot: Element = node;
          while (
            slot.parentElement &&
            slot.parentElement !== card &&
            slot.parentElement.childElementCount === 1 &&
            !slot.parentElement.textContent?.trim()
          )
            slot = slot.parentElement;
          box = slot.getBoundingClientRect();
        } else if (node instanceof Element && node !== card && filled(node)) {
          box = node.getBoundingClientRect();
        }
        if (box?.width) marks.push({ left: box.left, top: box.top, bottom: box.bottom, node });
      }
      const starts = items.flatMap((item) => {
        const own = marks.filter((mark) => item.contains(mark.node));
        return own.length ? [{ item, left: Math.min(...own.map((mark) => mark.left)) }] : [];
      });
      // A line's edge is its first piece's: tiles in a grid, or chips beside a total, sit further in.
      const lineStarts = starts.filter(({ item, left }) => {
        const box = item.getBoundingClientRect();
        return !marks.some(
          (mark) =>
            !item.contains(mark.node) &&
            mark.left < left - 1 &&
            mark.top < box.bottom &&
            mark.bottom > box.top,
        );
      });
      if (lineStarts.length < 2) continue;
      const tally = new Map<number, number>();
      for (const { left } of lineStarts)
        tally.set(Math.round(left), (tally.get(Math.round(left)) ?? 0) + 1);
      const edge = [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
      for (const { item, left } of lineStarts) {
        if (Math.abs(left - edge) > 1)
          found.push(`${name(card)} > ${name(item)} starts ${Math.round(left - edge)}px`);
      }
    }
    return [...new Set(found)];
  });
}

/**
 * Sideways scrollers whose cut ends have no fade, by name. The Library's kind chips once stopped
 * hard at the view switch, so a chip cut in half read as broken (owner, 2026-11-05). A scroller is a
 * box that scrolls sideways and lays its content out in one line, whether or not this window is
 * narrow enough to cut it; its fade is .scroll-fade-inline (primitives.css), drawn as a mask.
 */
export async function unfadedScrollers(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("body *")]
      .filter((element) => {
        if (!element.checkVisibility?.({ visibilityProperty: true })) return false;
        const style = getComputedStyle(element);
        if (!/auto|scroll/.test(style.overflowX)) return false;
        const oneLine =
          style.display.includes("flex") &&
          style.flexDirection.startsWith("row") &&
          style.flexWrap === "nowrap";
        return (
          (oneLine || element.scrollWidth > element.clientWidth + 1) && style.maskImage === "none"
        );
      })
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}${[...element.classList].map((c) => `.${c}`).join("")}`,
      ),
  );
}
