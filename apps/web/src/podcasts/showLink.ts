/**
 * What a pasted link names (the Add a show screen, first run step 3): a feed address, or an Apple
 * Podcasts id, which Overcast's links carry too. Spotify and YouTube keep their feeds to
 * themselves, so those get a plain reason and a way to search instead. Pure.
 */

export type ShowLink =
  | { kind: "feed"; url: string }
  | { kind: "apple"; id: number }
  | { kind: "closed"; app: "Spotify" | "YouTube" }
  | { kind: "invalid" };

export function parseShowLink(text: string): ShowLink {
  const trimmed = text.trim();
  let url: URL;
  try {
    // A feed address pasted without its scheme ("feeds.example.com/show.xml") is still one.
    url = new URL(/^[a-z][\w+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { kind: "invalid" };
  }
  if (url.protocol === "feed:" || url.protocol === "podcast:" || url.protocol === "pcast:") {
    // feed://host/path and its cousins: the same address over https.
    return parseShowLink(`https:${url.href.slice(url.protocol.length).replace(/^\/*/, "//")}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return { kind: "invalid" };
  if (!url.hostname.includes(".") || trimmed.length > 2048) return { kind: "invalid" };
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  if (host === "podcasts.apple.com" || host === "itunes.apple.com") {
    const id = /\/id(\d{1,12})(?:$|[/?])/.exec(url.pathname + url.search)?.[1];
    return id ? { kind: "apple", id: Number(id) } : { kind: "invalid" };
  }
  if (host === "overcast.fm") {
    const id = /^\/itunes(\d{1,12})(?:$|\/)/.exec(url.pathname)?.[1];
    return id ? { kind: "apple", id: Number(id) } : { kind: "invalid" };
  }
  if (host.endsWith("spotify.com") || host === "spoti.fi")
    return { kind: "closed", app: "Spotify" };
  if (host.endsWith("youtube.com") || host === "youtu.be")
    return { kind: "closed", app: "YouTube" };
  url.hash = "";
  return { kind: "feed", url: url.toString() };
}
