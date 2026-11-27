import { describe, expect, it } from "vitest";
import {
  finishedTailSeconds,
  type Heard,
  isNewEpisode,
  isShowEpisodeId,
  newCount,
  nextInShow,
  pickPlay,
  showIdOf,
  skipSeconds,
} from "./rules";

const id = (n: number): string => `pe:7:${n.toString(16).padStart(16, "0")}`;

function episode(n: number, day: number, kind: "full" | "trailer" | "bonus" = "full") {
  return { id: id(n), kind, published_at: `2026-11-${String(day).padStart(2, "0")}T08:00:00.000Z` };
}

const unheard: Heard = { seconds: 0, played: false };
const heardOf = (map: Record<string, Heard>) => (key: string) => map[key] ?? unheard;

// Newest first, as the routes answer.
const feed = [episode(4, 24), episode(3, 20, "trailer"), episode(2, 10), episode(1, 3)];
const following = { favorite_at: "2026-11-15T00:00:00.000Z", newest_id: id(2) };

describe("show episode ids", () => {
  // A Catchup's date id read as a show episode would take the show rules for its skips and its end.
  it("tells a show episode from a Catchup by its id", () => {
    expect(isShowEpisodeId(id(1))).toBe(true);
    expect(showIdOf(id(1))).toBe(7);
    for (const other of ["2026-11-23", "ep-20261123-1930", "2026-11-22-weekly", "pe:7:xyz"]) {
      expect(isShowEpisodeId(other)).toBe(false);
      expect(showIdOf(other)).toBeNull();
    }
  });
});

describe("played", () => {
  // The 3 second tail left every finished show episode half heard: credits and ads end them.
  it("a show episode left in its credits is played, a Catchup only at its end", () => {
    const hour = 3600;
    const catchup = finishedTailSeconds("2026-11-23", 20 * 60);
    // Wider than a Catchup's, growing with the episode, and never past its cap.
    expect(finishedTailSeconds(id(1), 20 * 60)).toBeGreaterThan(catchup);
    expect(finishedTailSeconds(id(1), hour)).toBeGreaterThan(finishedTailSeconds(id(1), 20 * 60));
    expect(finishedTailSeconds(id(1), 10 * hour)).toBe(finishedTailSeconds(id(1), 5 * hour));
    // A length that is not known yet never widens the tail.
    expect(finishedTailSeconds(id(1), 0)).toBe(catchup);
  });

  // A show's episode took a Catchup's short skips: an ad break needs more than one story's step.
  it("a show's episode skips further on than a Catchup, and nothing playing skips as a Catchup", () => {
    const catchup = skipSeconds("2026-11-23");
    expect(skipSeconds(id(1)).forward).toBeGreaterThan(catchup.forward);
    expect(skipSeconds(id(1)).back).toBeGreaterThan(catchup.back);
    expect(skipSeconds(null)).toEqual(catchup);
  });
});

describe("new", () => {
  // Without the rule a newly favorited show counts its whole back catalog on its tile.
  it("counts what came after the favorite, and the newest one at that moment", () => {
    expect(newCount(feed, following, heardOf({}))).toBe(2);
    expect(isNewEpisode(episode(1, 3), following, unheard)).toBe(false);
  });

  it("never counts a trailer, a played or dismissed episode, or a show that is not a favorite", () => {
    expect(isNewEpisode(episode(3, 20, "trailer"), following, unheard)).toBe(false);
    expect(newCount(feed, following, heardOf({ [id(4)]: { seconds: 0, played: true } }))).toBe(1);
    expect(newCount(feed, following, heardOf({}), new Set([id(4)]))).toBe(1);
    expect(newCount(feed, null, heardOf({}))).toBe(0);
  });
});

describe("a show's Play", () => {
  const show = { order: "episodic" as const };

  // Play that restarts a finished episode, or starts a trailer, is the bug this guards.
  it("resumes the half heard episode before anything new", () => {
    const pick = pickPlay(
      show,
      feed,
      following,
      heardOf({ [id(1)]: { seconds: 300, played: false } }),
    );
    expect(pick).toMatchObject({ reason: "resume", episode: { id: id(1) } });
  });

  it("with two half heard, resumes the one played last", () => {
    const heard = heardOf({
      [id(1)]: { seconds: 300, played: false },
      [id(4)]: { seconds: 90, played: false },
    });
    expect(pickPlay(show, feed, following, heard, id(1))?.episode.id).toBe(id(1));
    expect(pickPlay(show, feed, following, heard)?.episode.id).toBe(id(4));
  });

  it("then the oldest new episode, never the trailer", () => {
    expect(pickPlay(show, feed, following, heardOf({}))).toMatchObject({
      reason: "new",
      episode: { id: id(2) },
    });
  });

  it("a serial with nothing new starts at its first unplayed episode", () => {
    const pick = pickPlay(
      { order: "serial" },
      feed,
      null,
      heardOf({ [id(1)]: { seconds: 0, played: true } }),
    );
    expect(pick).toMatchObject({ reason: "first", episode: { id: id(2) } });
  });

  it("otherwise the newest full episode", () => {
    expect(pickPlay(show, feed, null, heardOf({}))).toMatchObject({
      reason: "latest",
      episode: { id: id(4) },
    });
    expect(pickPlay(show, [], null, heardOf({}))).toBeNull();
  });
});

describe("a show's Play, with the newest one heard", () => {
  // Play started the newest episode again though an older one had never been heard.
  it("plays the newest unplayed episode before a finished one, and a finished one when all are", () => {
    const show = { order: "episodic" as const };
    const newestHeard = heardOf({ [id(4)]: { seconds: 0, played: true } });
    expect(pickPlay(show, feed, null, newestHeard)?.episode.id).toBe(id(2));
    const all = heardOf(Object.fromEntries(feed.map((e) => [e.id, { seconds: 0, played: true }])));
    expect(pickPlay(show, feed, null, all)?.episode.id).toBe(id(4));
  });
});

describe("after an episode", () => {
  // The Catchup rule (the next older item) would start a three day old Daily after a show episode.
  it("goes to the same show's next newer unplayed full episode", () => {
    expect(nextInShow(feed, id(1), heardOf({}))?.id).toBe(id(2));
    // The trailer between them is stepped over.
    expect(nextInShow(feed, id(2), heardOf({}))?.id).toBe(id(4));
    expect(nextInShow(feed, id(1), heardOf({ [id(2)]: { seconds: 0, played: true } }))?.id).toBe(
      id(4),
    );
  });

  it("stops at the newest, and for an episode the list does not hold", () => {
    expect(nextInShow(feed, id(4), heardOf({}))).toBeNull();
    expect(nextInShow(feed, id(9), heardOf({}))).toBeNull();
  });
});
