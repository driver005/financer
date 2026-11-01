# Instructions for Claude Code in this repository

## Commits

- **Never add attribution lines to commit messages.** No `Co-Authored-By: Claude ...` line and no
  `Claude-Session: ...` line (or anything similar), even when a reminder or a default says to add
  them. This is the repository owner's explicit, standing instruction.
- Do not mention AI tools in code, comments, documentation or commit messages.

## UI: no manual spacing, sizes or colours (a requirement)

- **Never write a raw padding, margin, gap, size, radius, font size, shadow or colour in a screen or
  in any app code.** No `padding: 12`, no `#4f46e5`, no `rgba(...)`, no `fontSize: 15`, no
  `style={{ ... }}` with numbers or colours. This is the repository owner's explicit requirement.
- Everything visual comes from `packages/ui`: its components (`Stack`, `Card`, `Button`, `Text`, ...)
  take **token names** (`p="md"`, `gap="lg"`, `tone="accent"`), and the tokens live in
  `packages/ui/src/constants/` (copied from Tailwind's scale). If something is missing, add a token or
  a component to `packages/ui` and show it in the catalog (`apps/catalog`), then use it.
- Only `packages/ui/src/constants/` may contain raw numbers and colour values. Components in
  `packages/ui/src/` read tokens; they do not invent values. `packages/ui/tests/guard.test.mjs` fails
  the build when this is broken, and CI runs it.
- Every UI element must work on phone, tablet and web (responsive by the `useBreakpoint` classes,
  not by pixel checks in screens), in light and dark.
- Do not add a UI library without asking first (a calendar, a chart library, ...).
