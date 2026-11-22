# Baby Monitor

A Vue 3 PWA starter for a baby monitor. The app shell, PWA manifest and the GitHub Pages
staging/production pipeline are in place; monitoring features live in `src/`.

## Tech Stack

- **Vue 3** with Composition API + `<script setup>`
- **TypeScript** — strict mode
- **Vuetify 4** — Material Design 3 components (auto-imported via `vite-plugin-vuetify`)
- **@mdi/js** — Material Design icons as tree-shaken SVG paths (never the icon font)
- **Vite** — build tool and dev server
- **Vue Router** — hash history (required for GitHub Pages)
- **vite-plugin-pwa** — service worker + web app manifest
- **Vitest** — unit tests with V8 coverage
- **ESLint 9** (flat config) + **Prettier** — linting and formatting
- **Husky** — pre-commit hooks

Vuetify is pinned to `4.1.1`. Later 4.x releases ship a circular ESM import that breaks Vitest.

## Commands

| Command                 | Description                               |
| ----------------------- | ----------------------------------------- |
| `npm run dev`           | Start dev server at http://localhost:5173 |
| `npm run build`         | Type-check then build for production      |
| `npm run preview`       | Preview production build                  |
| `npm run format`        | Rewrite all files with Prettier           |
| `npm run format:check`  | Check formatting without rewriting        |
| `npm run lint`          | Run ESLint on all files                   |
| `npm run type-check`    | Run vue-tsc on all source files           |
| `npm run test`          | Run all tests                             |
| `npm run test:coverage` | Run all tests with V8 coverage            |

## Project Structure

```
src/
  main.ts              # App entry point — Vuetify and router wiring
  App.vue              # Root component (v-app > app bar + RouterView)
  router/index.ts      # Route definitions (hash history)
  views/
    HomeView.vue       # Placeholder home screen
  theme.ts             # M3 light/dark themes and global component defaults
  styles/
    fonts.css          # Self-hosted Roboto
    shared.css         # Global reset and surface background
```

Tests are colocated next to their source as `*.test.ts`.

## Design System

- **`src/theme.ts` is the single source of truth** for colours and component defaults. Do not
  hard-code colours in component styles — use theme tokens.
- **Vuetify's `surface-variant` is M3's `inverse-surface`**, not M3's neutral surface variant, so it
  holds a dark value in the light theme. M3's neutral surfaces are exposed as
  `surface-container-*`.
- Icons come from `@mdi/js` as individual path imports. Never switch to `@mdi/font` — the SVG paths
  are tree-shaken and the font is not.
- The brand colour lives in three places that must stay in sync: `src/theme.ts`, the `theme-color`
  meta in `index.html`, and the PWA manifest in `vite.config.ts`.

## Quality Gates

Every commit runs via the Husky pre-commit hook:

1. `npm run format:check` — Prettier on all files
2. `npm run lint` — ESLint on all files
3. `npm run type-check` — vue-tsc on all source files
4. `npm run test:coverage` — all Vitest tests with coverage

CI runs the same steps on every push, plus a final `npm run build`.

## Deployment

Two environments are deployed to the same `gh-pages` branch:

- **Production** — pushes to `main` deploy via the `deploy` workflow to the branch root.
  URL: https://peldszus.github.io/baby-monitor/
- **Staging** — pushes to any branch _except_ `main` deploy via the `deploy-staging`
  workflow to the `staging/` subdirectory.
  URL: https://peldszus.github.io/baby-monitor/staging/

Staging is a single shared slot (last push to any non-`main` branch wins). The staging deploy uses
`destination_dir: staging`, which scopes its cleanup to the `staging/` folder and leaves production
untouched. The production deploy uses `keep_files: true` so it preserves the `staging/` folder
rather than wiping the branch root. Both deploy workflows share a `github-pages` concurrency group
so they never push to `gh-pages` at the same time.

GitHub Pages must be configured once in repo Settings → Pages → Source → `gh-pages` branch.

Hash-based routing (`#/`) is used for full GitHub Pages compatibility.

## Environment Variables

| Variable        | Default | Description                                                                             |
| --------------- | ------- | --------------------------------------------------------------------------------------- |
| `VITE_BASE_URL` | `/`     | Asset base path — `/baby-monitor/` for production, `/baby-monitor/staging/` for staging |

## Development Guidelines

- **Do not commit plans**: plans created in `.agents_tmp/` should never be committed. They are
  temporary working documents for the AI agent and should remain local-only.
- `public/icon.svg` is the source for every app icon; regenerate the PNGs beside it when the
  artwork changes. The maskable variant scales the artwork to 90% so it survives Android's
  adaptive-icon crop.
