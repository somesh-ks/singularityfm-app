import { offCardEdge, offGrid, unfadedScrollers } from "./designChecks";
import {
  ADMIN_PAGES,
  costsReport,
  expect,
  expectNoViolationsInEitherScheme,
  targetSize,
  test,
} from "./fixtures";

/**
 * The sweeps the reader's suite ran over the admin's pages until the admin got its own suite (D382
 * step 4): no sideways scroll, 44px targets, the hidden attribute, the 4px grid and its cards'
 * edges, and axe on the Costs page.
 */

const WIDTHS = [320, 390, 820, 1280] as const;

test.describe("layout", () => {
  for (const width of WIDTHS) {
    // Left out of the reader's sweep until 2026-10-24, so the Costs chart's switch went unseen.
    test(`nothing scrolls sideways at ${width}px`, { tag: "@both" }, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const path of ADMIN_PAGES) {
        await page.goto(path);
        // Against the width asked for, not the page's own clientWidth: a page that outgrows the phone
        // widens the layout viewport too (Chromium's mobile zoom-out), so it always fits itself.
        const scroll = await page.evaluate(() => document.documentElement.scrollWidth);
        expect(scroll, `${path} at ${width}px`).toBeLessThanOrEqual(width);
      }
    });
  }

  test("every control answers a touch across at least 44px in both directions", {
    tag: "@both",
  }, async ({ page }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: 390, height: 900 });
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      const small: string[] = [];
      const controls = "a[href], button, summary, select, input:not([type=hidden])";
      for (const control of await page.locator(controls).all()) {
        if (!(await control.isVisible())) continue;
        // The skip link is a keyboard control and only shows on focus.
        if (await control.evaluate((node) => node.matches(".skip-link"))) continue;
        // A list row's hover Play (cover.css) is 24px under a mouse: the design system's to size, so
        // the Library's default list is probed for everything but it until that is decided.
        if (
          await control.evaluate((node) =>
            node.matches('main.library [data-library][data-view="list"] [data-cover-play]'),
          )
        ) {
          continue;
        }
        // A control that takes no touch by design, as a card's dots on a phone (D264: a hold opens
        // the menu), is for a screen reader and a keyboard, so it has no target to measure.
        if (await control.evaluate((node) => getComputedStyle(node).pointerEvents === "none")) {
          continue;
        }
        // A choice drawn as its label (a chip, a segment, a switch) is pressed on the label.
        const label = control.locator("xpath=self::input/ancestor::label[1]");
        const size = await targetSize((await label.count()) > 0 ? label : control);
        if (size.width < 44 || size.height < 44) {
          const label = await control.evaluate((node) =>
            (node.getAttribute("aria-label") ?? node.textContent ?? "").trim().slice(0, 40),
          );
          small.push(`"${label}" ${size.width}x${size.height}`);
        }
      }
      expect(small, `controls under 44px on ${path}`).toEqual([]);
    }
  });

  // A text link in small text is an inline box shorter than its line, and its hit layer was sized
  // from the line (42px, 2026-10-27). Probed at both sizes, a point 21.5px above and below the
  // centre must still reach the link.
  test("a text link answers a touch across 44px at both sizes", { tag: "@both" }, async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const short: string[] = [];
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      for (const link of await page.locator(".text-link").all()) {
        if (!(await link.isVisible())) continue;
        const reached = await link.evaluate((node) => {
          node.scrollIntoView({ block: "center", inline: "center" });
          const rects = [...node.getClientRects()];
          // The first line's box: a link that wraps is probed on its first fragment.
          const rect = rects[0] ?? node.getBoundingClientRect();
          const x = rect.left + rect.width / 2;
          const y = rect.top + rect.height / 2;
          return [-21.5, 21.5].every((dy) => {
            const found = document.elementFromPoint(x, y + dy);
            return found !== null && (found === node || node.contains(found));
          });
        });
        if (!reached) short.push(`${path} "${(await link.textContent())?.trim().slice(0, 30)}"`);
      }
    }
    expect([...new Set(short)]).toEqual([]);
  });
});

test("the hidden attribute hides everything that carries it, on every page", {
  tag: "@both",
}, async ({ page }) => {
  for (const route of ADMIN_PAGES) {
    await page.goto(route);
    await page.waitForLoadState("networkidle");
    const shown = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>("[hidden]")]
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => `${element.tagName.toLowerCase()}.${element.className}`),
    );
    expect(shown, route).toEqual([]);
  }
});

test("every page spaces on the 4px grid, lines a card's content up and fades its scrollers", {
  tag: "@both",
}, async ({ page }) => {
  for (const path of ADMIN_PAGES) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    expect.soft(await offGrid(page), path).toEqual([]);
    expect.soft(await offCardEdge(page), `${path}: a card's edge`).toEqual([]);
    expect.soft(await unfadedScrollers(page), `${path}: a scroller's cut ends`).toEqual([]);
  }
});

// The Costs page had no scan (it is not one of the routes above), and on a phone its table, wider
// than the card, scrolled sideways out of a keyboard's reach (axe scrollable-region-focusable,
// 2026-10-24). Five providers make it wider than a phone's card.
test("axe, the Costs page in chart and table view, its table scrolling sideways", async ({
  page,
}) => {
  const split = { anthropic: 2.26, speechify: 0.11, exa: 0.12, firecrawl: 0.04, gemini: 0.02 };
  const groups = Object.fromEntries(
    Object.entries(split).map(([key, usd]) => [key, { usd, runs: 1, shared_usd: 0 }]),
  );
  const base = costsReport("provider");
  await page.clock.setFixedTime(new Date("2026-10-22T10:00:00Z"));
  await page.route("**/api/costs**", (route) =>
    route.fulfill({
      json: {
        ...base,
        report: {
          ...base.report,
          buckets: [{ bucket: "2026-10-20", total: { usd: 2.55, runs: 1, shared_usd: 0 }, groups }],
          total: { usd: 2.55, runs: 1, shared_usd: 0 },
        },
      },
    }),
  );
  await page.goto("/admin/costs");
  await expect(page.locator(".costs-mark")).toHaveCount(1);
  await expectNoViolationsInEitherScheme(page);
  await page.locator("#costs-view-table").click();
  await expect(page.locator("[data-costs-table]")).toBeVisible();
  await expectNoViolationsInEitherScheme(page);
});
