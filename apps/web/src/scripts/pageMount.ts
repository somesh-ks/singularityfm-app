/**
 * Mounts a page's script on every visit to the page. A bundled module script runs once per session,
 * and the page can arrive by a client-side navigation (ClientRouter) as well as by a load, so this
 * follows the router: each page root is mounted once, on load and on astro:page-load. The signal
 * ends when the page is swapped away, for listeners on the document or window, which outlive it.
 * Name the page's own root in `selector`: a part another page shares mounts there too (learnings,
 * 2026-11-01).
 */
export function mountEachVisit(
  selector: string,
  mount: (root: HTMLElement, life: AbortSignal) => void,
): void {
  const run = (): void => {
    const root = document.querySelector<HTMLElement>(selector);
    if (!root || root.dataset.mounted !== undefined) return;
    root.dataset.mounted = "";
    const life = new AbortController();
    document.addEventListener("astro:before-swap", () => life.abort(), { once: true });
    mount(root, life.signal);
  };
  document.addEventListener("astro:page-load", run);
  run();
}
