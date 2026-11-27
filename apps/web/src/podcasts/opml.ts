/**
 * OPML, the list of shows other podcast apps import and export (Pocket Casts, Overcast, AntennaPod,
 * Apple Podcasts on a Mac). Only the feed addresses matter: the show route finds each one in the
 * index. Pure, with no DOM, so the tests run it as the page does.
 */

export interface OpmlShow {
  title: string;
  feed_url: string;
}

/** An OPML file this size holds thousands of shows; anything larger is not one. */
export const OPML_MAX_BYTES = 2 * 1024 * 1024;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === "#") {
      const code =
        name[1] === "x" || name[1] === "X"
          ? Number.parseInt(name.slice(2), 16)
          : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : whole;
    }
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

function encode(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** The attributes of one tag, names lower-cased: OPML writers disagree on xmlUrl's case. */
function attributes(tag: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const match of tag.matchAll(/([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) {
    const name = match[1]?.toLowerCase();
    if (name) found.set(name, decode(match[3] ?? match[4] ?? ""));
  }
  return found;
}

/** A feed address the show route takes: http or https, whole. */
function feedAddress(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/**
 * The shows in an OPML file, each feed once, in the file's order. Null when the text is not OPML,
 * so the page can say so rather than "no shows".
 */
export function parseOpml(text: string): OpmlShow[] | null {
  if (!/<opml[\s>]/i.test(text)) return null;
  const shows: OpmlShow[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/<outline\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi)) {
    const attrs = attributes(match[0]);
    const feed = feedAddress(attrs.get("xmlurl") ?? "");
    if (!feed || seen.has(feed)) continue;
    seen.add(feed);
    shows.push({ title: (attrs.get("text") ?? attrs.get("title") ?? "").trim(), feed_url: feed });
  }
  return shows;
}

/** The shows as an OPML 2.0 file, for another podcast app. */
export function writeOpml(shows: readonly OpmlShow[], now: Date): string {
  const lines = shows.map(
    (show) =>
      `    <outline type="rss" text="${encode(show.title)}" title="${encode(show.title)}" xmlUrl="${encode(show.feed_url)}" />`,
  );
  return [
    '<?xml version="1.0" encoding="utf-8"?>',
    '<opml version="2.0">',
    "  <head>",
    "    <title>Singularity shows</title>",
    `    <dateCreated>${now.toUTCString()}</dateCreated>`,
    "  </head>",
    "  <body>",
    ...lines,
    "  </body>",
    "</opml>",
    "",
  ].join("\n");
}
