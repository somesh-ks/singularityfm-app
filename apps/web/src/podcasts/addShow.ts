import { searchShows } from "../scripts/podcastRows";
import type { ShowRow } from "../server/podcasts/shapes";
import { showUrl } from "./rules";
import { linksIn, parseShowLink } from "./showLink";
import { fetchShow, findShow, resolveLink, type ShowAnswer, type ShowFailure } from "./shows";
import { follow, followAll, type ImportOutcome, importFile } from "./transfer";

/**
 * Add a show from whatever a person typed or pasted into its one field (the Add a show page, Search's
 * pasted link, first run step 3), forgiving by design:
 *
 * - a name: the shows it matches, to pick from;
 * - an Apple Podcasts or Overcast link: that show;
 * - any other link (a feed, Spotify, YouTube, Pocket Casts, a show's site): the server reads the page
 *   for its feed, then its name (resolve.ts); a certain answer is added, else the closest matches;
 * - several links, or an OPML list pasted as text: imported, as a file would be.
 *
 * A show found for certain becomes a favorite and its page is where it goes.
 */
export type AddShowResult =
  | { kind: "added"; url: string; title: string; added: boolean }
  | { kind: "matches"; shows: ShowRow[]; name: string }
  | { kind: "imported"; outcome: ImportOutcome }
  | { kind: "error"; message: string };

const OFFLINE = "Couldn't reach the podcast index. Try again in a moment.";

async function added(answer: ShowAnswer | ShowFailure): Promise<AddShowResult | null> {
  if (answer === "not_found") return null;
  if (answer === "failed" || answer.show.id === null) return { kind: "error", message: OFFLINE };
  const fresh = await follow(answer);
  return { kind: "added", url: showUrl(answer.show.id), title: answer.show.title, added: fresh };
}

async function byName(name: string): Promise<AddShowResult> {
  const shows = await searchShows(name);
  if (shows === null) return { kind: "error", message: OFFLINE };
  const pickable = shows.filter((show) => show.id !== null);
  return pickable.length > 0
    ? { kind: "matches", shows: pickable, name }
    : {
        kind: "error",
        message: `No show called "${name}". Check the spelling, or paste its link.`,
      };
}

async function byLink(text: string): Promise<AddShowResult> {
  const link = parseShowLink(text);
  if (link.kind === "apple") {
    return (
      (await added(await findShow({ apple: link.id }))) ?? {
        kind: "error",
        message: "The podcast index doesn't know that show yet. Try its name.",
      }
    );
  }
  if (link.kind !== "link") return byName(text);
  const answer = await resolveLink(link.url);
  if (answer === "failed") return { kind: "error", message: OFFLINE };
  if (answer !== "not_found" && answer.show?.id) {
    return (await added(await fetchShow(answer.show.id))) ?? { kind: "error", message: OFFLINE };
  }
  if (answer !== "not_found" && answer.matches.length > 0) {
    return { kind: "matches", shows: answer.matches, name: answer.name ?? "" };
  }
  return { kind: "error", message: "Couldn't find a show at that link. Try typing its name." };
}

export async function addShowFrom(text: string): Promise<AddShowResult> {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "error", message: "Type a show's name or paste a link." };
  if (/<opml[\s>]/i.test(trimmed)) {
    return { kind: "imported", outcome: await importFile(new Blob([trimmed])) };
  }
  const links = linksIn(trimmed);
  if (links.length > 1) {
    const outcome = await followAll(
      links.map((url) => {
        const link = parseShowLink(url);
        return { title: url, feed_url: link.kind === "link" ? link.url : url };
      }),
    );
    return { kind: "imported", outcome: { kind: "opml", ...outcome } };
  }
  return links.length === 1 ? byLink(links[0] as string) : byName(trimmed);
}
