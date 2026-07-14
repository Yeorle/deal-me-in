# Contributing to Deal me in

Thanks for your interest! Contributions of all kinds are welcome — bug reports,
feature ideas, translations, and code.

## Getting started

```bash
npm install    # also rebuilds the better-sqlite3 native module for Electron
npm run dev    # Vite dev server + Electron with hot-module reload
```

`npm run dev` is the only command needed for day-to-day development.

## Before opening a pull request

All three checks must pass (CI runs them on every PR):

```bash
npm run lint       # ESLint, zero-warning policy
npx tsc --noEmit   # type-check both the renderer and main process
npm run test       # Vitest unit tests for the tournament engine
```

If you change the tournament engine (`electron/tournament.ts`), please add or
extend a test in `tests/` — that file decides real tournaments' results and
money, so regressions there are the expensive kind.

## Finding your way around

- [README](./README.md) — feature overview and build instructions.
- [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) — how the system fits together
  (process model, IPC bridge, persistence, seating algorithms).
- [CLAUDE.md](./CLAUDE.md) — a dense contributor's map of conventions and
  gotchas (dual type declarations, structure duration units, prize-place gaps,
  …). Written for AI coding assistants but just as useful for humans.

Two rules worth knowing before your first change:

- **Tournament state lives in the main process.** The renderer never holds the
  source of truth — it calls IPC methods and re-renders from `timer-update`
  broadcasts.
- **Shared shapes are declared twice** — in `electron/tournament.ts` and
  `src/types.d.ts`. If you change `Player`, `Table`, `TournamentState`, etc.,
  update both sides.

## Reporting bugs

Please include your OS, the app version (bottom of the sidebar), and steps to
reproduce. If the bug involves a live tournament, describe the table/player
situation (number of tables, seats per table, who busted) — most engine bugs
depend on it.

## License

By contributing you agree that your contributions are licensed under the
[MIT License](./LICENSE).
