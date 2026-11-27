/**
 * Sponsor breaks in a public show's episode, found in the publisher's own timed transcript with
 * plain rules and no model (Nov 12 plan, "Sponsor skip and chapters"). Pure, so the rules are
 * measured against hand-marked transcripts without a browser (sponsors.test.ts).
 *
 * A break starts at a line that says a sponsor is speaking ("brought to you by", "my sponsor,
 * WorkOS") and ends where the ad first gives the sponsor's own address ("go to workos.com"). One ad
 * read straight after another joins the same break. A sponsor line with no such address within a
 * couple of minutes is not marked: missing a break is acceptable, cutting the show is not. That is
 * why the address must name the sponsor and why the first one ends the break: a show that mentions
 * a sponsor in passing, or a host who names a website after the ad, never stretches a break over
 * the talk.
 */

export interface TimedLine {
  start_s: number;
  end_s: number;
  text: string;
}

export interface SponsorBreak {
  start_s: number;
  end_s: number;
}

/** The words that open an ad read. */
const OPENS =
  /\b(?:(?:is|are|was)\s+(?:also\s+)?(?:brought to you|sponsored|supported|presented|made possible)\s+by|brought to you by|sponsored by|(?:today'?s|our|my|this (?:week|season|episode)'?s?|presenting|supporting|first|next|final|last) sponsors?\b|support for (?:this|the|today'?s) (?:show|podcast|episode) comes from|(?:a|quick) (?:word|message|break) from (?:our|my|this|today'?s) sponsors?|thanks? (?:to )?our sponsors?)/i;

/**
 * A spoken or written address: "workos.com", "workos .com", "get dx dot com". Endings that are also
 * words ("so", "me", "us", "co") are left out: ". So" ends a sentence far more often than it ends an
 * address.
 */
const ADDRESS =
  /\b([a-z0-9][a-z0-9-]*)\s*(?:\.|\s+dot\s+)\s*(?:com|io|ai|org|net|app|dev|fm|xyz)\b/gi;
/** What may follow an address and still be it: "slash lenny", "/authkit". */
const ADDRESS_TAIL = /^\s*(?:slash|\/)\s*[a-z0-9]+/i;

/** Capitalised words that name nothing: a sentence's first word, the ad's own vocabulary. */
const NOT_NAMES = new Set(
  (
    "a an the this that these those is are was be by to of for from in on at and or but so with " +
    "your you our my we it its episode episodes show podcast season sponsor sponsors sponsored " +
    "brought today todays presenting supporting first next final last support comes also made " +
    "possible presented word message quick break thanks thank okay ok yeah well now if here there"
  ).split(" "),
);

/** How long after its first line an ad may go on before its address; past this it is not marked. */
export const MAX_BREAK_S = 150;
/** Shorter than this is a mention, not a break worth a button. */
export const MIN_BREAK_S = 10;
/** Two breaks this close are one: the second ad read follows the first. */
const JOIN_GAP_S = 2;

/** Where the sentence that holds character `at` of `text` starts. */
function sentenceStart(text: string, at: number): number {
  return Math.max(
    0,
    ...[". ", "! ", "? "].map((stop) => {
      const found = text.lastIndexOf(stop, at);
      return found < 0 ? 0 : found + stop.length;
    }),
  );
}

/** What may follow an opener that ends its line with the sponsor still to come: "sponsor," "is". */
const CONTINUES = /^[\s,:\u2013-]*(?:is|are)?[\s,:\u2013-]*$/i;

export function opensAd(text: string): boolean {
  return OPENS.test(text);
}

/** The sponsor's names as an ad's first lines say them: "WorkOS", "Jane", "Street", "DX". */
export function sponsorNames(text: string): Set<string> {
  const names = new Set<string>();
  for (const [word] of text.replace(/'s\b/g, "").matchAll(/\b[A-Z][A-Za-z0-9]+/g)) {
    const name = word.toLowerCase();
    if (!NOT_NAMES.has(name)) names.add(name);
  }
  return names;
}

/**
 * Where in `text` an address that names the sponsor ends, as a share of the line's characters, or
 * null when no address in it does. "workos.com" names WorkOS, "getdx.com" names DX and
 * "janestreet.com" names Jane Street; an address the host mentions in the conversation names
 * someone else, so the ad cannot be stretched over the talk to reach it.
 */
export function sponsorAddressEnd(text: string, names: ReadonlySet<string>): number | null {
  // The first that names the sponsor: "Visit acme.com. Back to our guest: why leave acme.com?"
  // ends at the first, so the question stays out of the break.
  for (const match of text.matchAll(ADDRESS)) {
    const domain = (match[1] ?? "").toLowerCase().replace(/-/g, "");
    const named = [...names].some(
      (name) =>
        name === domain || domain.includes(name) || (domain.length >= 3 && name.includes(domain)),
    );
    if (!named) continue;
    const after = match.index + match[0].length;
    const tail = ADDRESS_TAIL.exec(text.slice(after));
    return (after + (tail ? tail[0].length : 0)) / Math.max(1, text.length);
  }
  return null;
}

/** A line that ends with its address: the next line starts where the ad ends. */
const WHOLE_LINE = 0.85;

/**
 * The breaks in a transcript, in time order. Lines must be in time order, as the route sends them.
 * Measured on 19 episodes of four shows on 27 Nov 2026 (docs/history/2026-11-27-sponsor-skip.md):
 * 17 breaks marked, none running into the show, 2 missed.
 */
export function findSponsorBreaks(lines: readonly TimedLine[]): SponsorBreak[] {
  const found: SponsorBreak[] = [];
  let index = 0;
  while (index < lines.length) {
    const first = lines[index];
    if (!first || !opensAd(first.text)) {
      index += 1;
      continue;
    }
    // "My sponsor," and "Antithesis," can be two lines: the next line names the sponsor only when
    // the opener ends its line mid-phrase. A company the talk names next ("Thanks to our sponsors."
    // then "GitHub has changed...") is not taken as the sponsor.
    const opening = OPENS.exec(first.text);
    const runsOn = opening
      ? CONTINUES.test(first.text.slice(opening.index + opening[0].length))
      : false;
    // Names from the opener's own sentence: "...brought to you by Acme. GitHub has changed code
    // review." names Acme alone.
    const from = opening ? sentenceStart(first.text, opening.index) : 0;
    const stop = opening ? /[.!?](?:\s|$)/.exec(first.text.slice(opening.index)) : null;
    const to = opening && stop ? opening.index + stop.index + 1 : first.text.length;
    const named = sponsorNames(first.text.slice(from, to));
    const names = named.size > 0 || !runsOn ? named : sponsorNames(lines[index + 1]?.text ?? "");
    const limit = first.start_s + MAX_BREAK_S;
    let last = -1;
    for (let at = index; at < lines.length && (lines[at]?.start_s ?? limit) < limit; at += 1) {
      if (sponsorAddressEnd(lines[at]?.text ?? "", names) !== null) {
        last = at;
        break;
      }
    }
    if (last < 0) {
      index += 1;
      continue;
    }
    // The address said twice: "Visit getdx.com slash lenny." then "That's getdx.com slash lenny."
    while (sponsorAddressEnd(lines[last + 1]?.text ?? "", names) !== null) last += 1;
    const line = lines[last] as TimedLine;
    const share = sponsorAddressEnd(line.text, names) ?? 1;
    const next = lines[last + 1]?.start_s ?? line.end_s;
    // A line that runs on past its address ("...slash lenny I want to kind of go") ends the break
    // where the address is said, a little early rather than a word late.
    const end =
      share >= WHOLE_LINE
        ? next
        : Math.min(next, line.start_s + share * (line.end_s - line.start_s) - 0.3);
    // A line that opens with the show and turns to the ad ("...why it matters. Today's sponsor is
    // Acme.") starts the break at the sentence that says it, a little late rather than a word early.
    // The sentence that holds the opener, so "This episode is brought to you" starts at "This".
    const opener = from;
    const start =
      first.start_s + (opener / Math.max(1, first.text.length)) * (first.end_s - first.start_s);
    const before = found[found.length - 1];
    if (before && start - before.end_s <= JOIN_GAP_S) before.end_s = end;
    else found.push({ start_s: start, end_s: end });
    index = last + 1;
  }
  return found.filter((span) => span.end_s - span.start_s >= MIN_BREAK_S);
}

/**
 * How far the audio may run past the transcript's last line: outro music, a sign-off sting. Measured
 * tails on 19 episodes: 0 to 17 seconds. With no length in the feed to compare, the tail is the only
 * check, so it is held tighter.
 */
export const TAIL_ALLOWANCE_S = 30;
export const TAIL_ALONE_S = 15;
/** How far two measures of one file may differ and still be the same file. */
export const LENGTH_TOLERANCE_S = 5;

/**
 * Whether the transcript's times can be trusted on the audio this device received. A publisher
 * writes its transcript against the file without inserted ads; a copy with ads inserted for this
 * listener is longer, and every time after the first insert is late, so a skip would cut the show.
 * The file must be about the length the feed declares, and the transcript must end inside it, not
 * long before its end. Unsure (no measured length yet) is untrusted.
 */
export function transcriptFitsAudio({
  audioS,
  feedS,
  transcriptEndS,
}: {
  /** The length of the file as the audio element measured it; 0 or NaN before it knows. */
  audioS: number;
  /** The length the feed declares, or null when it declares none. */
  feedS: number | null;
  transcriptEndS: number;
}): boolean {
  if (!(audioS > 0) || !(transcriptEndS > 0)) return false;
  if (transcriptEndS > audioS + LENGTH_TOLERANCE_S) return false;
  const declared = feedS !== null && feedS > 0;
  if (declared && Math.abs(audioS - feedS) > LENGTH_TOLERANCE_S) return false;
  return audioS - transcriptEndS <= (declared ? TAIL_ALLOWANCE_S : TAIL_ALONE_S);
}

/** The break the playhead is inside, if any. */
export function breakAt(breaks: readonly SponsorBreak[], seconds: number): SponsorBreak | null {
  return breaks.find((span) => seconds >= span.start_s && seconds < span.end_s - 0.5) ?? null;
}

/** "2 found in this episode · 3 min": the episode page's line under the switch. */
export function breaksSummary(breaks: readonly SponsorBreak[]): string {
  const seconds = breaks.reduce((sum, span) => sum + (span.end_s - span.start_s), 0);
  const minutes = Math.max(1, Math.round(seconds / 60));
  const count = breaks.length === 1 ? "1 found" : `${breaks.length} found`;
  return `${count} in this episode · ${minutes} min`;
}
