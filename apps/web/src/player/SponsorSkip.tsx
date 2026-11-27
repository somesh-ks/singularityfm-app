import Button from "@singularityfm/design-system/Button";
import { useSyncExternalStore } from "react";
import { formatClock } from "./core/formatTime";
import { getPlayerStore } from "./core/playerRuntime";
import { getPreferences } from "./core/preferences";
import { currentBreak, skipBreak } from "./core/sponsorSkip";
import { usePlayerSecond, usePlayerState } from "./hooks/usePlayer";

const subscribePreferences = (onChange: () => void): (() => void) =>
  getPreferences().subscribe(onChange);
const sponsorChoice = () => getPreferences().get().sponsors;

/**
 * Skip sponsor, in the line under the title, only while a public show's episode is inside a sponsor
 * break the player trusts (canvas, PlayerPublic board): its words say how much of the break is
 * left, and a press jumps to its end. Nothing shows where the listener turned sponsor breaks off.
 */
export default function SponsorSkip() {
  const state = usePlayerState();
  usePlayerSecond();
  const choice = useSyncExternalStore(subscribePreferences, sponsorChoice, () => "button");
  if (choice === "off" || !state.track?.digest.show?.breaks?.length) return null;
  const store = getPlayerStore();
  const span = currentBreak(store);
  if (!span) return null;
  const left = Math.max(0, span.end_s - store.getTime());
  return (
    <Button
      variant="text"
      className="player-sponsor-skip"
      onClick={() => skipBreak(store, span, "user")}
    >
      Skip sponsor · <span className="num">{formatClock(left)}</span>
    </Button>
  );
}
