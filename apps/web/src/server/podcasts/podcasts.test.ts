import { describe, expect, it } from "vitest";
import { coverFile, extrasFile, parseChapters, parseCues, parseJsonTranscript } from "./files";
import { BREAKER_FAILURES, createIndexClient, newBreaker } from "./podcastIndex";
import {
  canonicalNew,
  canonicalSearch,
  type PodcastDeps,
  searchShows,
  trendingShows,
} from "./routes";
import { episodeFromIndex, plainText, type ShowRow, uniqueShows } from "./shapes";
import { createSigner } from "./signing";

const sign = createSigner("test-secret");
const PUBLIC = async () => ["93.184.216.34"];
const keys = { key: "k", secret: "s" };

const appleResult = {
  collectionId: 1,
  collectionName: "Latent Space",
  artistName: "swyx",
  feedUrl: "https://api.substack.com/feed/podcast/1084089.rss",
  artworkUrl600: "https://is1.mzstatic.com/a.jpg",
};

function deps(overrides: Partial<PodcastDeps> = {}): PodcastDeps {
  return {
    index: async () => {
      throw new Error("down");
    },
    apple: async () => [appleResult],
    sign,
    limit: async () => true,
    ...overrides,
  };
}

describe("podcast routes", () => {
  it("refuses a file address our answers did not sign, so the file routes are no open proxy", async () => {
    let fetched = 0;
    const fileDeps = {
      fetch: async () => {
        fetched++;
        return new Response("x");
      },
      sign,
      resolve: PUBLIC,
    };
    const url = "https://internal.example/secret.png";
    const forged = new URLSearchParams({ u: url, s: createSigner("other")("cover", url) });
    expect((await coverFile(forged, fileDeps)).status).toBe(403);
    // A cover's signature does not open the same address as a transcript.
    const crossKind = new URLSearchParams({ k: "transcript:vtt", u: url, s: sign("cover", url) });
    expect((await extrasFile(crossKind, fileDeps)).status).toBe(403);
    expect(fetched).toBe(0);
  });

  it("stops asking a failing index for a while and searches Apple instead", async () => {
    let asked = 0;
    const index = createIndexClient({
      keys,
      breaker: newBreaker(),
      now: () => 1_000_000,
      fetch: async () => {
        asked++;
        return new Response("", { status: 503 });
      },
    });
    for (let i = 0; i < BREAKER_FAILURES; i++) await searchShows("latent space", deps({ index }));
    const answer = await searchShows("latent space", deps({ index }));
    expect(asked).toBe(BREAKER_FAILURES);
    expect(answer.status).toBe(200);
    expect(answer.body).toMatchObject({ source: "apple", shows: [{ title: "Latent Space" }] });
  });

  it("never keeps a failed answer at the edge, so a stale good copy is served instead", async () => {
    const failing = deps({
      apple: async () => {
        throw new Error("down");
      },
    });
    for (const answer of [
      await searchShows("latent space", failing),
      await trendingShows(new URLSearchParams({ lang: "en" }), failing),
    ]) {
      expect(answer.status).toBe(502);
      expect(answer.headers?.["Vercel-CDN-Cache-Control"]).toBe("no-store");
    }
  });

  it("gives one episode the same id in every answer, so resume and played marks find it", () => {
    const item = {
      feedId: 42,
      guid: "abc-123",
      title: "One",
      enclosureUrl: "http://cdn.example/one.mp3",
      datePublished: 1_790_000_000,
    };
    const fromShow = episodeFromIndex(item, sign);
    const fromNew = episodeFromIndex({ ...item, description: "<p>later</p>" }, sign);
    expect(fromShow?.id).toBe(fromNew?.id);
    expect(fromShow?.id).toMatch(/^pe:42:/);
    expect(episodeFromIndex({ ...item, feedId: 43 }, sign)?.id).not.toBe(fromShow?.id);
    // Audio named over http is tried over https, and says so.
    expect(fromShow).toMatchObject({
      audio_url: "https://cdn.example/one.mp3",
      audio_insecure: true,
    });
  });

  it("reads SRT and WebVTT cue times as seconds, so a skip lands where the transcript says", () => {
    const srt = "1\n00:01:02,500 --> 00:01:05,000\nBrought to you by Acme\n";
    const vtt = "WEBVTT\n\n01:02.500 --> 01:05.000\n<v Host>Brought to you by Acme\n";
    for (const text of [srt, vtt]) {
      expect(parseCues(text)).toEqual([
        {
          start_s: 62.5,
          end_s: 65,
          text: "Brought to you by Acme",
          speaker: text === vtt ? "Host" : null,
        },
      ]);
    }
  });

  it("never hands back markup from show notes or cues, even a split or escaped tag", () => {
    for (const notes of ["<scr<b>ipt>alert(1)</script>", "&lt;script&gt;alert(1)&lt;/script&gt;"]) {
      expect(plainText(notes)).not.toMatch(/[<>]/);
    }
    const [cue] = parseCues("00:00.000 --> 00:01.000\n<<i>script>alert(1)\n");
    expect(cue?.text).not.toMatch(/[<>]/);
  });

  it("keeps a show note's link addresses and an episode's kind, so the page can link and Play latest skips a trailer", () => {
    const notes = plainText(
      '<p>Sponsor: <a href="https://acme.example/pod?a=1&amp;b=2">Acme</a></p><a href="https://x.example">https://x.example</a>',
    );
    expect(notes).toContain("Acme (https://acme.example/pod?a=1&b=2)");
    expect(notes).toContain("https://x.example");
    expect(notes).not.toContain("(https://x.example)");
    const base = { feedId: 42, guid: "g", enclosureUrl: "https://cdn.example/one.mp3" };
    expect(episodeFromIndex({ ...base, episodeType: "Trailer" }, sign)?.kind).toBe("trailer");
    expect(episodeFromIndex(base, sign)?.kind).toBe("full");
  });

  it("asks the edge one question per search and per show list, however it was typed", () => {
    expect(canonicalSearch(new URLSearchParams({ q: "  Latent   SPACE " }))).toEqual(
      canonicalSearch(new URLSearchParams({ q: "latent space" })),
    );
    const now = 1_790_000_000_000;
    const a = canonicalNew(new URLSearchParams({ ids: "9,3,9", since: "1789999990" }), now);
    const b = canonicalNew(new URLSearchParams({ ids: "3,9", since: "1789999500" }), now);
    expect(a).toEqual(b);
  });
  it("keeps no empty search at the edge when Apple was busy or down, so a later search can find it", async () => {
    const empty = { index: async () => ({ feeds: [] }) };
    const busy = await searchShows("only on apple", deps({ ...empty, limit: async () => false }));
    const down = await searchShows(
      "only on apple",
      deps({
        ...empty,
        apple: async () => {
          throw new Error("down");
        },
      }),
    );
    for (const answer of [busy, down]) {
      expect(answer.status).toBeGreaterThanOrEqual(500);
      expect(answer.headers?.["Vercel-CDN-Cache-Control"]).toBe("no-store");
    }
  });

  it("drops a broken transcript or chapter entry and keeps the good ones beside it", () => {
    const good = { startTime: 0, endTime: 1, body: "Hello" };
    expect(parseJsonTranscript({ segments: [null, 7, [], good] })).toHaveLength(1);
    expect(parseChapters({ chapters: [null, { startTime: 0, title: "Intro" }] })).toHaveLength(1);
  });

  it("keeps two feeds whose addresses differ only in the path's case", () => {
    const row = (feed_url: string) => ({ feed_url, apple_id: null }) as unknown as ShowRow;
    const rows = [row("https://Feeds.example/Show.xml"), row("https://feeds.example/show.xml")];
    expect(uniqueShows(rows)).toHaveLength(2);
    expect(
      uniqueShows([row("https://Feeds.example/a/"), row("http://feeds.example/a")]),
    ).toHaveLength(1);
  });
});
