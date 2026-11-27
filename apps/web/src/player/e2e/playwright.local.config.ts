// Local only, not committed: the cloud image ships another Chromium than the pinned Playwright expects.
import base from "./playwright.config";
const executablePath = "/opt/pw-browsers/chromium";
const withPath = <T extends { use?: Record<string, unknown> }>(item: T): T => ({
  ...item,
  use: {
    ...item.use,
    launchOptions: {
      ...((item.use?.launchOptions as Record<string, unknown>) ?? {}),
      executablePath,
    },
  },
});
export default { ...withPath(base), projects: (base.projects ?? []).map(withPath) };
