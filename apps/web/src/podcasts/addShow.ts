import { showUrl } from "./rules";
import { parseShowLink } from "./showLink";
import { findShow } from "./shows";
import { follow } from "./transfer";

/**
 * Adds a show by a pasted link: finds it, favorites it, and says where its page is, or why not in
 * one plain sentence. Shared by the Add a show page and first run's step 3.
 */
export type AddShowResult =
  | { ok: true; url: string; title: string; added: boolean }
  | { ok: false; message: string };

export async function addShowByLink(text: string): Promise<AddShowResult> {
  const link = parseShowLink(text);
  if (link.kind === "invalid") {
    return {
      ok: false,
      message: "That isn't a link to a show. Paste its RSS feed or Apple Podcasts link.",
    };
  }
  if (link.kind === "closed") {
    return {
      ok: false,
      message: `${link.app} doesn't share its feeds. Search for the show by name.`,
    };
  }
  const answer = await findShow(link.kind === "feed" ? { url: link.url } : { apple: link.id });
  if (answer === "not_found") {
    return {
      ok: false,
      message: "The podcast index doesn't know this show yet. Check the link, or try its RSS feed.",
    };
  }
  if (answer === "failed" || answer.show.id === null) {
    return { ok: false, message: "Couldn't reach the podcast index. Try again in a moment." };
  }
  const added = await follow(answer);
  return { ok: true, url: showUrl(answer.show.id), title: answer.show.title, added };
}
