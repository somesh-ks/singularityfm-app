import { describe, expect, it } from "vitest";
import { buildBackup, positionsToRestore, readBackup } from "./backup";
import type { StoredEpisode, StoredShow } from "./deviceStore";
import { mergeListens } from "./history";
import { parseOpml, writeOpml } from "./opml";
import { parseShowLink } from "./showLink";

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
    </outline></body></opml>`;
    const shows = parseOpml(file);
    expect(shows).toEqual([
      { title: "Lenny's Podcast", feed_url: "https://api.substack.com/feed/podcast/10845.rss" },
      { title: "Syntax & more", feed_url: "https://feed.syntax.fm/rss" },
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
  it("finds a show by its Apple or Overcast link and says why Spotify can't", () => {
    expect(
      parseShowLink("https://podcasts.apple.com/us/podcast/hard-fork/id1528594034?i=1"),
    ).toEqual({ kind: "apple", id: 1528594034 });
    expect(parseShowLink("https://overcast.fm/itunes1528594034/hard-fork")).toEqual({
      kind: "apple",
      id: 1528594034,
    });
    expect(parseShowLink("feeds.simplecast.com/l2i9YnTd")).toEqual({
      kind: "feed",
      url: "https://feeds.simplecast.com/l2i9YnTd",
    });
    expect(parseShowLink("feed://feeds.simplecast.com/l2i9YnTd")).toEqual({
      kind: "feed",
      url: "https://feeds.simplecast.com/l2i9YnTd",
    });
    expect(parseShowLink("https://open.spotify.com/show/2MAi0BvDc6GTFvKFPXnkCL")).toEqual({
      kind: "closed",
      app: "Spotify",
    });
    expect(parseShowLink("hard fork")).toEqual({ kind: "invalid" });
  });
});
