# Design system

Loaded every session with AGENTS.md. Rules for UI work and the design system.

## Rules

- UI keeps the 8pt grid (4px for named cases only; SVG scene-motion offsets are exempt) and the design system, in three layers: `pnpm run design-check` (a hook on each UI edit), e2e/designSystem.spec.ts (CI), the `design-audit` agent before the PR.
- The design system is a product (D237, D253). A control is a component in the pinned `@singularityfm/design-system` package (repo somesh-ks/singularityfm-design-system) named for what it is (Button); a page draws it, never types its class. A UI fix starts at the component, in that repo. If the system cannot express the request, stop, propose a small deviation and wait for the owner's OK; never deviate silently. A page patch needs a PR reason and a `PAGE_OVERRIDES` entry. The app takes a release by a bump PR; a PR that grows an allowlist or the owners file needs the `design-system` label and his merge (`scripts/designSystemGate.mjs`). No flag emoji: Flag (D367).
- Design fixes are load-bearing: markup or rules with a rationale comment are never removed or rewritten for another task; extend or ask. Before changing shared CSS (`player.css`, `primitives.css`, `buttons.css`, tokens) check `git log -L '/<selector>/,+20:<file>'` and the ledger. `pnpm run design-check` checks CSS rules; browser suites verify rendered CSS.
- UI parts: before you write a class, token or value, run `pnpm run ds find "<need>"`. Features: `.claude/skills/feature/`.
