import { skipSeconds } from "../podcasts/rules";
import { isPlayingStatus, toggleLabel } from "./core/playerCopy";
import { getPlayerStore } from "./core/playerRuntime";
import { usePlayerState } from "./hooks/usePlayer";
import { useStoryStep } from "./hooks/useStoryStep";
import { openSpeed, PLAYER_MENU_ID } from "./PlayerMenu";
import { rateLabel } from "./rateLabels";
import Icon from "./ui/LazyIcon";
import PlayPauseGlyph from "./ui/PlayPauseGlyph";

/**
 * The transport, one control dominant: the previous story, back ten seconds, play and pause,
 * forward ten seconds, the next story. On a wide screen with a mouse the bar has previous, play and
 * next, so the page shows the two skips with the speed between them (owner, 2026-11-04), which opens
 * the ⋮ menu's speed screen; everywhere else the speed is in the ⋮ menu (PlayerMenu.tsx). The skip glyphs are plain circular arrows; each button
 * draws its own numeral in the arrow's open center, and the name stays on the button.
 */
export default function TransportControls() {
  const state = usePlayerState();
  const store = getPlayerStore();
  const step = useStoryStep();
  const playing = isPlayingStatus(state.status);
  // Ten seconds either way on a Catchup; 15 back and 30 on in a public show (owner, 2026-11-23).
  const skips = skipSeconds(state.digestId);

  return (
    <div className="transport">
      <button
        className="transport-btn press"
        type="button"
        aria-label="Previous story"
        aria-disabled={step.previousDisabled || undefined}
        onClick={step.previous}
      >
        <Icon name="skipBack" />
      </button>
      <button
        className="transport-btn transport-skip press"
        type="button"
        aria-label={`Back ${skips.back} seconds`}
        onClick={() => store.skip(-skips.back)}
      >
        <Icon name="replay10" />
        <span className="transport-skip-num num" aria-hidden="true">
          {skips.back}
        </span>
      </button>
      <button
        className="transport-btn transport-speed press num"
        type="button"
        popoverTarget={PLAYER_MENU_ID}
        aria-label={`Playback speed, ${rateLabel(state.rate)}`}
        disabled={!state.track}
        onClick={(event) => openSpeed(event.currentTarget)}
      >
        {rateLabel(state.rate)}
      </button>
      <button
        className="transport-btn press"
        type="button"
        data-primary
        data-playing={String(playing)}
        data-loading={String(state.buffering)}
        aria-label={toggleLabel(state)}
        aria-busy={state.buffering || undefined}
        onClick={() => store.toggle()}
      >
        <PlayPauseGlyph status={state.status} error={state.error} />
        <span className="spinner" aria-hidden="true" />
      </button>
      <button
        className="transport-btn transport-skip press"
        type="button"
        aria-label={`Forward ${skips.forward} seconds`}
        onClick={() => store.skip(skips.forward)}
      >
        <Icon name="forward10" />
        <span className="transport-skip-num num" aria-hidden="true">
          {skips.forward}
        </span>
      </button>
      <button
        className="transport-btn press"
        type="button"
        aria-label="Next story"
        aria-disabled={step.nextDisabled || undefined}
        onClick={step.next}
      >
        <Icon name="skipForward" />
      </button>
    </div>
  );
}
