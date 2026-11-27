import { afterEach, describe, expect, it, vi } from "vitest";
import { recordingKey, resumeKey } from "../player/core/resume";
import { buildBackup, positionsToRestore, readBackup } from "./backup";
import type { StoredEpisode, StoredShow } from "./deviceStore";
import { mergeListens } from "./history";
import { parseOpml, writeOpml } from "./opml";
import { linksIn, parseShowLink } from "./showLink";
import { importFile } from "./transfer";

// The records' own merge is IndexedDB's; what a restore owes the listener here is its storage writes.
vi.mock("./deviceRecords", () => ({ mergeRecords: async () => 0, allRecords: async () => [] }));

const show: StoredShow = {
  id: 920666,
  apple_id: 1528594034,
  title: "Hard Fork",
  author: "The New York Times",
  feed_url: "https://feeds.simplecast.com/l2i9YnTd",
  cover: "/api/podcasts/cover?u=https%3A%2F%2Fexample.com%2Fa.jpg&s=abc",
  categories: ["Technology"],
  episode_count: 200,
  newest_at: "2026-11-21T10:00:00.000Z",
  source: "index",
  description: "",
  link: null,
  language: "en",
  explicit: false,
  order: "episodic",
  favorite_at: "2026-11-20T09:00:00.000Z",
  pinned_at: "2026-11-22T09:00:00.000Z",
  hidden_at: null,
  newest_id: "pe:920666:0123456789abcdef",
  speed: 1.2,
  last_episode_id: null,
  fetched_at: "2026-11-25T09:00:00.000Z",
  changed_at: "2026-11-25T09:00:00.000Z",
};

const episode: StoredEpisode = {
  id: "pe:920666:0123456789abcdef",
  show_id: 920666,
  show_title: "Hard Fork",
  guid: "g1",
  title: "The Jensen Huang Affair",
  published_at: "2026-11-21T10:00:00.000Z",
  duration_s: 3600,
  audio_url: "https://dts.podtrac.com/a.mp3",
  audio_insecure: false,
  audio_type: "audio/mpeg",
  audio_bytes: null,
  cover: null,
  description: "",
  link: null,
  season: null,
  episode: null,
  kind: "full",
  transcript: null,
  chapters: null,
  pinned: true,
  favorite_at: null,
  dismissed: false,
  listened_at: "2026-11-25T08:00:00.000Z",
  changed_at: "2026-11-25T08:00:00.000Z",
};

describe("import and export", () => {
  // Pocket Casts and Overcast write xmlUrl in different cases and escape their titles; a reader
  // that misses either drops shows from an import without a word.
  it("reads every show of another app's OPML, once each, and gives back what it writes", () => {
    const file = `<?xml version="1.0"?><opml version="1.0"><body><outline text="feeds">
      <outline type="rss" text="Lenny&apos;s Podcast" xmlUrl="https://api.substack.com/feed/podcast/10845.rss"/>
      <outline type="rss" title="Syntax &amp; more" XMLURL='https://feed.syntax.fm/rss'/>
      <outline type="rss" text="Again" xmlUrl="https://feed.syntax.fm/rss"/>
      <outline type="rss" text="No feed" xmlUrl="javascript:alert(1)"/>
      <outline type="rss" text="1 > 0" xmlUrl="https://example.com/gt.xml"/>
    </outline></body></opml>`;
    const shows = parseOpml(file);
    expect(shows).toEqual([
      { title: "Lenny's Podcast", feed_url: "https://api.substack.com/feed/podcast/10845.rss" },
      { title: "Syntax & more", feed_url: "https://feed.syntax.fm/rss" },
      // A ">" inside a quoted title once ended the tag there and dropped the show.
      { title: "1 > 0", feed_url: "https://example.com/gt.xml" },
    ]);
    expect(parseOpml(writeOpml(shows ?? [], new Date(0)))).toEqual(shows);
    expect(parseOpml('{"format":"singularity-backup"}')).toBeNull();
  });

  // Export on the phone, import on the desktop: the lists must match (Nov 12 plan, slice 6 gate).
  it("restores favorites, episodes, positions and History from its own backup", () => {
    const backup = buildBackup({
      shows: [show],
      episodes: [
        episode,
        { ...episode, id: "pe:920666:ffffffffffffffff", pinned: false, listened_at: null },
      ],
      positions: { [episode.id]: { seconds: 1200 }, "2026-11-25": { played: true } },
      history: [{ id: "2026-11-25", at: "2026-11-25T07:00:00.000Z" }],
      now: new Date("2026-11-26T09:00:00.000Z"),
    });
    const read = readBackup(JSON.stringify(backup));
    expect(read).toEqual(backup);
    // The untouched episode stays behind: the route gives it again.
    expect(typeof read !== "string" && read.episodes.map((row) => row.id)).toEqual([episode.id]);
  });

  // A backup is a file anyone could hand over: it must not point covers or audio at another site,
  // and one broken row must not cost the rest.
  it("leaves out records that are not whole or point elsewhere, and keeps the rest", () => {
    const file = JSON.stringify({
      format: "singularity-backup",
      version: 1,
      shows: [show, { ...show, id: 2, cover: "https://tracker.example/pixel.gif" }, { id: "x" }],
      episodes: [
        episode,
        { ...episode, id: "pe:1:0123456789abcdef" },
        { ...episode, audio_url: "http://a/b.mp3" },
      ],
      positions: { [episode.id]: { seconds: 90 }, "bad id with spaces": { seconds: 5 } },
      history: [],
    });
    const read = readBackup(file);
    expect(typeof read !== "string" && read.shows.map((row) => row.id)).toEqual([show.id]);
    expect(typeof read !== "string" && read.episodes.map((row) => row.id)).toEqual([episode.id]);
    expect(typeof read !== "string" && Object.keys(read.positions)).toEqual([episode.id]);
    // A shared file is someone else's text: a planted address or a wrong type never reaches the store.
    const planted = readBackup(
      JSON.stringify({
        format: "singularity-backup",
        version: 1,
        shows: [{ ...show, link: "javascript:alert(1)", categories: null, extra: "x" }],
        episodes: [{ ...episode, link: "http://a/b", published_at: 5, kind: "other" }],
      }),
    );
    expect(typeof planted !== "string" && planted.shows[0]).toEqual({
      ...show,
      link: null,
      categories: [],
    });
    expect(typeof planted !== "string" && planted.episodes[0]).toEqual({
      ...episode,
      link: null,
      published_at: null,
      kind: "full",
    });
    expect(readBackup("not json")).toBe("not_json");
    expect(readBackup(JSON.stringify({ format: "singularity-backup", version: 9 }))).toBe(
      "newer_version",
    );
  });

  // An old backup must never move a listener back from where they are on this device.
  it("keeps this device's place and History's latest listen", () => {
    const incoming = { a: { seconds: 10 }, b: { seconds: 20 } };
    expect(positionsToRestore(incoming, (id) => id === "a")).toEqual({ b: { seconds: 20 } });
    expect(
      mergeListens(
        [{ id: "a", at: "2026-11-20T00:00:00.000Z" }],
        [
          { id: "a", at: "2026-11-25T00:00:00.000Z" },
          { id: "b", at: "2026-11-22T00:00:00.000Z" },
        ],
      ),
    ).toEqual([
      { id: "a", at: "2026-11-25T00:00:00.000Z" },
      { id: "b", at: "2026-11-22T00:00:00.000Z" },
    ]);
  });

  // An Apple Podcasts link sent to the feed lookup answers "no such show" for a show the index has.
  // Prevents a pasted name being read as a link (or a list of links as a name): the one field sends
  // each down a different road, and the wrong one finds nothing.
  it("tells an Apple or Overcast id, any other link and a name apart", () => {
    expect(
      parseShowLink("https://podcasts.apple.com/us/podcast/hard-fork/id1528594034?i=1"),
    ).toEqual({ kind: "apple", id: 1528594034 });
    expect(parseShowLink("https://overcast.fm/itunes1528594034/hard-fork")).toEqual({
      kind: "apple",
      id: 1528594034,
    });
    expect(parseShowLink("feeds.simplecast.com/l2i9YnTd")).toEqual({
      kind: "link",
      url: "https://feeds.simplecast.com/l2i9YnTd",
    });
    expect(parseShowLink("feed://feeds.simplecast.com/l2i9YnTd")).toEqual({
      kind: "link",
      url: "https://feeds.simplecast.com/l2i9YnTd",
    });
    expect(parseShowLink("https://open.spotify.com/show/2MAi0BvDc6GTFvKFPXnkCL")).toEqual({
      kind: "link",
      url: "https://open.spotify.com/show/2MAi0BvDc6GTFvKFPXnkCL",
    });
    expect(parseShowLink("hard fork")).toEqual({ kind: "invalid" });
    expect(linksIn("hard fork")).toEqual([]);
    expect(linksIn("syntax.fm")).toEqual(["syntax.fm"]);
    expect(linksIn("a.com/feed\nhttps://b.com/rss, a.com/feed")).toEqual([
      "a.com/feed",
      "https://b.com/rss",
    ]);
    // A comma inside one feed's address once split it into a link and a "name".
    expect(linksIn("https://a.com/feed?tags=1,2")).toEqual(["https://a.com/feed?tags=1,2"]);
    expect(linksIn("a.com/feed,b.com/rss")).toEqual(["a.com/feed", "b.com/rss"]);
    // A query's comma before a host-like word split one feed into two.
    expect(linksIn("https://a.com/feed?hosts=x.com,y.com")).toEqual([
      "https://a.com/feed?hosts=x.com,y.com",
    ]);
    expect(linksIn("https://a.com/f?v=1,https://b.com/rss")).toEqual([
      "https://a.com/f?v=1",
      "https://b.com/rss",
    ]);
  });
});

describe("restoring a backup", () => {
  afterEach(() => vi.unstubAllGlobals());
  const file = (recording?: string) =>
    new Blob([
      JSON.stringify(
        buildBackup({
          shows: [],
          episodes: [],
          positions: { "2026-11-25": { seconds: 300, ...(recording ? { recording } : {}) } },
          history: [{ id: "2026-11-25", at: "2026-11-25T07:00:00.000Z" }],
          now: new Date("2026-11-26T09:00:00.000Z"),
        }),
      ),
    ]);
  /** This browser's storage, failing on the keys named. */
  const storage = (failing: (key: string) => boolean) => {
    const kept = new Map<string, string>();
    const store = {
      getItem: (key: string) => kept.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (failing(key)) throw new DOMException("full", "QuotaExceededError");
        kept.set(key, value);
      },
      removeItem: (key: string) => kept.delete(key),
    };
    vi.stubGlobal("localStorage", store);
    vi.stubGlobal("window", { localStorage: store });
    return kept;
  };

  // Storage full or blocked once read as "Backup restored" with the places and History lost
  // (CodeRabbit, 27 Nov); a second try must then restore what the first could not.
  it("says a restore failed when storage did not keep its places or History", async () => {
    await expect(importFile(file())).rejects.toThrow();
    storage(() => true);
    await expect(importFile(file())).rejects.toThrow();
    storage((key) => key === "singularity:history");
    await expect(importFile(file())).rejects.toThrow();
    const kept = storage((key) => key === recordingKey("2026-11-25"));
    await expect(importFile(file("rec1"))).rejects.toThrow();
    expect(kept.has(resumeKey("2026-11-25"))).toBe(false);
  });
});
