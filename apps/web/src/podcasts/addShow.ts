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
  | { kind: "added"; url: string; title: string; added: boolean; id: number }
  | { kind: "matches"; shows: ShowRow[]; name: string }
  | { kind: "imported"; outcome: ImportOutcome }
  | { kind: "error"; message: string };

const OFFLINE = "Couldn't reach the podcast index. Try again in a moment.";

/**
 * A show found for certain: favorited and opened, or, when the person has not asked yet (a link
 * handed over from Search, ?link=), offered as the one match to tap, so no address can follow a show
 * for them.
 */
async function added(
  answer: ShowAnswer | ShowFailure,
  confirm: boolean,
): Promise<AddShowResult | null> {
  if (answer === "not_found") return null;
  if (answer === "failed" || answer.show.id === null) return { kind: "error", message: OFFLINE };
  if (confirm) return { kind: "matches", shows: [answer.show], name: answer.show.title };
  const fresh = await follow(answer);
  return {
    kind: "added",
    url: showUrl(answer.show.id),
    title: answer.show.title,
    added: fresh,
    id: answer.show.id,
  };
}

/** Favorites a show picked from the matches; the same answer a certain find gives. */
export async function addPicked(id: number): Promise<AddShowResult> {
  return (await added(await fetchShow(id), false)) ?? { kind: "error", message: OFFLINE };
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

async function byLink(text: string, confirm: boolean): Promise<AddShowResult> {
  const link = parseShowLink(text);
  if (link.kind === "apple") {
    return (
      (await added(await findShow({ apple: link.id }), confirm)) ?? {
        kind: "error",
        message: "The podcast index doesn't know that show yet. Try its name.",
      }
    );
  }
  if (link.kind !== "link") return byName(text);
  const answer = await resolveLink(link.url);
  if (answer === "failed") return { kind: "error", message: OFFLINE };
  if (answer !== "not_found" && answer.show?.id) {
    return (
      (await added(await fetchShow(answer.show.id), confirm)) ?? {
        kind: "error",
        message: OFFLINE,
      }
    );
  }
  if (answer !== "not_found" && answer.matches.length > 0) {
    return { kind: "matches", shows: answer.matches, name: answer.name ?? "" };
  }
  // A name with a dot in it ("Node.js", "Serial.") reads as a bare address: typed without a scheme
  // and naming no page, it is the name it looks like.
  if (!/^[a-z][\w+.-]*:/i.test(text.trim())) return byName(text.trim());
  return { kind: "error", message: "Couldn't find a show at that link. Try typing its name." };
}

/**
 * `confirm`: nothing is followed until the person taps the show (a link handed over from Search),
 * and a pasted list or OPML, which would follow many, is not read at all.
 */
export async function addShowFrom(text: string, confirm = false): Promise<AddShowResult> {
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "error", message: "Type a show's name or paste a link." };
  const links = linksIn(trimmed);
  if (confirm && (links.length > 1 || /<opml[\s>]/i.test(trimmed))) {
    return { kind: "error", message: "Paste one show at a time here, or import a file below." };
  }
  if (/<opml[\s>]/i.test(trimmed)) {
    return { kind: "imported", outcome: await importFile(new Blob([trimmed])) };
  }
  if (links.length > 1) {
    const outcome = await followAll(
      links.map((url) => {
        const link = parseShowLink(url);
        return { title: url, feed_url: link.kind === "link" ? link.url : url };
      }),
    );
    return { kind: "imported", outcome: { kind: "opml", ...outcome } };
  }
  return links.length === 1 ? byLink(links[0] as string, confirm) : byName(trimmed);
}
