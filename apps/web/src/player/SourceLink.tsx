import { linkClass } from "@singularityfm/design-system/link";
import { sourceHost, sourceLinkLabel } from "../lib/sourceLabel";
import { usePlayerState } from "./hooks/usePlayer";
import Icon from "./ui/Icon";

/**
 * Where the story being read came from: the bare host, opening in a new tab. Nothing is rendered
 * when the story has no address that is safe to link. `player-source-link` is a hook for the
 * rundown test only; the design system's Link source draws it.
 */
export default function SourceLink() {
  const state = usePlayerState();
  const url = state.track?.timeline?.items[state.itemIndex]?.url;
  const host = sourceHost(url);
  if (!url || !host) return null;
  return (
    <a
      className={`${linkClass("source")} player-source-link`}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={sourceLinkLabel(host)}
    >
      <span>{host}</span>
      <Icon name="openInNew" />
    </a>
  );
}
