import { buttonClass } from "@singularityfm/design-system/button";
import { useLayoutEffect, useRef } from "react";
import { getPlayerStore } from "./core/playerRuntime";
import { playerSheet } from "./core/playerSheet";

/**
 * What the player page shows for a recording with no audio to play (isUnplayable): the site's empty
 * screen, which the layout holds in a template (BaseLayout.astro), in place of controls that cannot
 * work. Open Downloads puts the player away and goes on; Try again asks for the audio again.
 */
export default function PlayerEmpty() {
  const slot = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = slot.current;
    const template = document.querySelector<HTMLTemplateElement>("#player-empty");
    if (!box || !template) return;
    box.replaceChildren(template.content.cloneNode(true));
    // Try again goes nowhere, so it is a button; the template draws every action as a link.
    const again = box.querySelector<HTMLAnchorElement>("a[data-retry]");
    if (again) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = buttonClass("text");
      button.dataset.retry = "";
      button.append(...again.childNodes);
      again.replaceWith(button);
    }
    // The controls that held focus are gone: the screen's title takes it, so a keyboard or screen
    // reader user lands on what happened instead of the top of the page.
    if (!document.activeElement || document.activeElement === document.body) {
      const title = box.querySelector<HTMLElement>(".empty-title");
      title?.setAttribute("tabindex", "-1");
      title?.focus({ preventScroll: true });
    }
    const onClick = (event: MouseEvent): void => {
      const target = event.target instanceof Element ? event.target.closest("a, button") : null;
      if (!target) return;
      if (target.hasAttribute("data-retry")) {
        getPlayerStore().retry();
        // The screen goes with the failure; the Play disc it was standing in for takes focus.
        requestAnimationFrame(() =>
          document.querySelector<HTMLElement>("[data-player-page] [data-primary]")?.focus(),
        );
      } else void playerSheet.collapse();
    };
    box.addEventListener("click", onClick);
    return () => box.removeEventListener("click", onClick);
  }, []);
  return <div className="player-empty" ref={slot} />;
}
