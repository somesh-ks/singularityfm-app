import { expect, hydrated, test } from "./fixtures";

/**
 * A day's two Catch ups are one album (D219): a select before Play moves between them. The names
 * are held in lib/catchUps.test.ts.
 */

const FIRST = "ep-20261006-0900";
const SECOND = "ep-20261007-1930";

test("the select holds both Catch ups and switching it moves nothing in the row", async ({
  page,
}) => {
  await page.goto(`/e/${FIRST}`);
  await hydrated(page);
  const pick = page.getByRole("combobox", { name: "Catch up" });
  await expect(pick.locator("option")).toHaveCount(2);
  await expect(pick).toHaveValue(FIRST);

  // Across the row, not down the page: a longer title on the other page moves the row down.
  const row = async () => {
    const across = (box: { x: number; width: number; height: number } | null) =>
      box && { x: box.x, width: box.width, height: box.height };
    return {
      chip: across(await page.locator(".hero-actions > .chip").boundingBox()),
      select: across(await pick.boundingBox()),
    };
  };
  const before = await row();

  await pick.selectOption(SECOND);
  await expect(page).toHaveURL(new RegExp(`/e/${SECOND}$`));
  await expect(pick).toHaveValue(SECOND);
  // The same row, to the pixel: the other name did not push Play or the select aside.
  expect(await row()).toEqual(before);
});

test("at a narrow width the Catch up row never widens the page, and Share stays reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto(`/e/${FIRST}`);
  await hydrated(page);
  // The page never widens. Since Play is its glyph alone (D391) the row may fit at this width; if it
  // does not, it scrolls on its own.
  const pageScrolls = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(pageScrolls).toBe(false);
  // Share is reachable by scrolling to it.
  const share = page.getByRole("button", { name: "Share", exact: true });
  await share.scrollIntoViewIfNeeded();
  await expect(share).toBeInViewport({ ratio: 1 });
});
