import { describe, expect, it } from "vitest";
import { continueIds, dropContinue, noteContinue, readContinue } from "./continueListening";
import { dialOrder } from "./home";

function memory() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("Continue listening", () => {
  // Owner, 26 Nov: no Dismiss X, so the shelf must clear itself or it fills with finished episodes.
  it("drops an episode heard to the end and fills its place with the next one heard", () => {
    const storage = memory();
    noteContinue(storage, "c", 1);
    noteContinue(storage, "b", 2);
    noteContinue(storage, "a", 3);
    const finished = new Set(["a"]);
    expect(continueIds(readContinue(storage), (id) => !finished.has(id), 2)).toEqual(["b", "c"]);
  });

  it("keeps a card taken off by hand off until it is listened to again", () => {
    const storage = memory();
    noteContinue(storage, "a", 1);
    noteContinue(storage, "b", 2);
    dropContinue(storage, "a");
    expect(continueIds(readContinue(storage), () => true)).toEqual(["b"]);
    noteContinue(storage, "a", 3);
    expect(continueIds(readContinue(storage), () => true)).toEqual(["a", "b"]);
  });
});

describe("the speed dial's order", () => {
  // A newer pin first would push the listener's oldest pins off the dial's first page.
  it("keeps the Daily first and earlier pins ahead of a new one", () => {
    const tiles = [
      { name: "new pin", first: false, pinnedAt: "2026-11-20", newestAt: "2026-11-25" },
      { name: "fresh", first: false, pinnedAt: null, newestAt: "2026-11-26" },
      { name: "old pin", first: false, pinnedAt: "2026-11-01", newestAt: "2026-10-01" },
      { name: "daily", first: true, pinnedAt: null, newestAt: "2026-11-24" },
    ];
    expect(dialOrder(tiles).map((tile) => tile.name)).toEqual([
      "daily",
      "old pin",
      "new pin",
      "fresh",
    ]);
  });
});
