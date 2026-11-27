/**
 * What a pasted link names (Add a show's one field): an Apple Podcasts id, which Overcast's links
 * carry too, or any other web address, which the server reads for its show (resolve.ts). Pure.
 */

export type ShowLink =
  | { kind: "link"; url: string }
  | { kind: "apple"; id: number }
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
  url.hash = "";
  return { kind: "link", url: url.toString() };
}

const isLink = (word: string): boolean =>
  parseShowLink(word).kind !== "invalid" && /[./:]/.test(word);

/**
 * The pasted words that are links, each once; a name has none. A comma parts links only where
 * every piece is one and, after a query (?), each next piece starts with its own scheme, so a feed
 * address with a comma in its query stays whole.
 */
export function linksIn(text: string): string[] {
  const words = text
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((word) => {
      const pieces = word.split(",").filter(Boolean);
      const parted =
        pieces.length > 1 &&
        pieces.every(isLink) &&
        (!word.includes("?") ||
          pieces.slice(1).every((piece) => /^[a-z][\w+.-]*:\/\//i.test(piece)));
      return parted ? pieces : [word.replace(/^,+|,+$/g, "")];
    })
    .filter(Boolean);
  const links = words.filter(isLink);
  return links.length === words.length ? [...new Set(links)] : [];
}
