import { useEffect, useRef, useState } from "react";
import type { PlayerTurn } from "../types/contracts";
import ScriptView from "./ScriptView";

/**
 * A public show's transcript in its own tab: the publisher's timed lines as turns (podcasts/extras.ts),
 * drawn by the same script view a Catchup's transcript uses, whole, in the list's scrolling column.
 */
export default function ShowTranscript({ turns }: { turns: readonly PlayerTurn[] }) {
  const rootRef = useRef<HTMLElement>(null);
  // "Back to now" sits over the whole column, as it does over a Catchup's stories.
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(rootRef.current), []);
  if (turns.length === 0) return null;
  return (
    <section className="story-list" ref={rootRef} aria-label="Transcript">
      <div className="list-scroll">
        <ScriptView turns={turns} range={{ from: 0, to: turns.length }} backHost={host} />
      </div>
    </section>
  );
}
