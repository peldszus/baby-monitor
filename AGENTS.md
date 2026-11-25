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
- **uqr** — dependency-free QR code generation
- **jsQR** — QR scanner fallback when `BarcodeDetector` is unavailable
- **Vitest** — unit tests with V8 coverage
- **Playwright** — two-context end-to-end pairing test
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
| `npm run test`          | Run Vitest unit tests                     |
| `npm run test:coverage` | Run unit tests with V8 coverage           |
| `npm run test:e2e`      | Run the Playwright pairing test           |

## Project Structure

```
src/
  main.ts                    # App entry point — Vuetify and router wiring
  App.vue                    # Root component (v-app > app bar + RouterView)
  router/index.ts            # Route definitions (hash history)
  core/
    state.ts                 # Explicit idle → pairing → connecting → connected → degraded → lost
    control.ts               # Versioned data-channel protocol with strict validation
    heartbeat.ts             # Six-second heartbeat timeout evaluator
    alarm.ts                 # Web Audio warning tone with user-gesture unlock
    power.ts                 # Screen Wake Lock and fullscreen helpers
    presentation.ts          # Parent rotation, zoom and pan math
    signaling-qr.ts          # Compact handshake codec, full-SDP fallback, CRC-32 and expiry
    short-code.ts            # Six-digit code derived from both DTLS fingerprints
    negotiation.ts           # Perfect negotiation for media over the data channel
    peer.ts                  # RTCPeerConnection wrapper, data handshake, media negotiation
    camera.ts                # Video input listing and normal-rear-camera preference
    media-child.ts           # Capture tracks, gain graph, constraints and replaceTrack helpers
    media-settings.ts        # Shared defaults, ranges and UI presets for M2 controls
    media-stats.ts           # getStats() summary for actual fps, size, bitrate and audio level
    scanner.ts               # BarcodeDetector scanner with jsQR fallback
  composables/
    usePeerSession.ts        # Role session orchestration used by both views
  components/
    SignalQr.vue             # QR carousel with expiry countdown
    QrScanner.vue            # Camera dialog
    VideoStream.vue          # Attaches a MediaStream to a <video>
    CameraSelect.vue         # Shared camera picker for the child and QR scanner
    PresentationVideo.vue    # Parent canvas presentation, gestures and PiP
    ConnectionStatus.vue     # State, peer state, RTT, reconnect and wake-lock status
    AlarmOverlay.vue         # Fullscreen parent warning when the connection fails
    PairingSteps.vue         # Three-node pairing progress indicator
    TextCodePanel.vue        # Collapsible text-code fallback
  views/
    HomeView.vue             # Role selection
    ChildView.vue            # Camera, offer QR, answer scan, local preview
    ParentView.vue           # Offer scan, answer QR, remote video
  theme.ts                   # M3 light/dark themes and global component defaults
  styles/
    fonts.css                # Self-hosted Roboto
    shared.css               # Global reset and surface background
e2e/
  pairing.spec.ts            # Two Chromium contexts, fake media, real WebRTC
```

Tests are colocated next to their source as `*.test.ts`. Vitest excludes `e2e/`; Playwright owns
that directory.

## Monitoring Architecture

- `usePeerSession` is the single orchestrator. It owns the `PeerSession`, local and remote streams,
  the pairing collectors, the short code and the RTT, and it is the only place that advances the
  state machine.
- Pairing codes are `BM1|<index>|<total>|<crc32>|<data>` chunks. The compact payload is a
  fixed-layout binary record (version, kind, expiry, ICE ufrag/pwd, 32-byte SHA-256 fingerprint,
  DTLS setup role and one or two host candidates), Base64url encoded. The receiver rebuilds a
  data-channel-only SDP from a shared template and validates every field before it reaches
  `setRemoteDescription`. Version 2 is a compressed full-SDP fallback. `decodeSignal` rejects bad
  checksums, missing chunks, expired codes and unsafe payloads; `SignalChunkCollector` accepts
  chunks in any scan order.
- The control channel is one ordered `RTCDataChannel` labelled `control`. Messages are versioned
  JSON with an `id`, and `decodeControlMessage` rejects unknown types, bad shapes, oversized
  messages and out-of-range values. M2 adds `set-video`, `set-audio` and `status`; every value has
  an explicit range. `end` is a payload-free parent-to-child teardown message.
- `PeerSession` always uses `iceServers: []`, waits for complete ICE gathering before returning an
  SDP, and keeps media and control on the same encrypted peer connection. Pairing creates only the
  data channel; `startMedia` adds the child's tracks after the channel is open and triggers a media
  offer over `negotiate`. `PerfectNegotiator` keeps the parent polite.
- The media offer is limited to Opus and VP8 so its SDP fits in one control message. The QR code
  contains no codec details.
- The parent controls `set-video` and `set-audio`. The child applies them to its real tracks:
  video/audio off stops the track and calls `replaceTrack(null)`, on captures a fresh track and
  replaces it. Frame rate uses `applyConstraints` plus `maxFramerate`; resolution and bitrate use
  `scaleResolutionDownBy` and `maxBitrate`; microphone gain runs through a `GainNode` (0–10×)
  followed by a `DynamicsCompressorNode` peak limiter, so high gain boosts quiet sounds without
  hard clipping.
- The child sends `status` every second with actual `getStats()` values (fps, frame size, bitrate,
  audio level), the selected gain and processing flags, and battery when available. The parent
  shows those values rather than only the requested ones.
- Parent playback volume uses the video element's `volume`. iOS may ignore it and use hardware
  volume instead; the UI still reflects the chosen value.
- Child media requests the rear camera (`facingMode: environment`) at 1280×720, 16:9 and 15 fps
  ideal. `camera.ts` lists video inputs sorted by label and `preferNormalCamera` prefers a normal
  rear lens over labels containing `wide`, `ultra`, `fisheye`, `tele` or `macro`. With generic
  Android labels it uses the first label in string order. The child first requests exact
  1280×720 16:9, falls back to ideal constraints on `OverconstrainedError`, asks for
  `crop-and-scale`, auto-switches once on start, then exposes a `CameraSelect`;
  `ChildMediaController.setVideoDevice` opens the new track before stopping the old one, and
  `usePeerSession` replaces the sender track without re-pairing. The QR scanner applies the same
  preference on first open, keeps a manual selection, and also exposes a camera picker.
- Pairing uses one shared three-step indicator on both devices: child code, parent code and
  connect. The child shows the offer then scans the answer; the parent scans the offer then shows
  the answer. The QR exchange is one-way, so the child cannot know when the parent scanned its
  offer. Opening the answer scanner or manual answer panel hides the consumed child code, with a
  **Show child code again** link. Text codes live in collapsed expansion panels so the QR flow
  stays above the fold. Pairing views use compact spacing and a viewport-height QR size; E2E checks
  320×568, 360×640 and 390×844 without page scrolling.
- M3 operation: `HeartbeatMonitor` starts only when media is connected, so pairing delay cannot
  raise a false alarm. The parent raises `alarmActive` after six seconds without a pong or on a
  WebRTC failure while connected/degraded. `WebAudioAlarm` unlocks on the first parent pointer
  event and again when monitoring starts; unlocking resumes the audio context silently and
  never plays a test tone. The visual warning stays until recovery or stop.
- `ScreenWakeLock` requests `screen` while visible and re-requests it after `visibilitychange`.
  The status row reports whether the lock is active or unavailable. Session cleanup preserves the
  parent lock while `alarmActive` is true; stopping monitoring or leaving the view releases it.
- The parent sends `set-screen {dark}`; the child shows a black fixed overlay, tries
  `requestFullscreen`, and reports `screenDark` in every status. Double-tap or long-press wakes the
  child locally. `exitAppFullscreen` and the overlay are best effort where fullscreen is blocked.
- On `disconnected`, both sides call `RTCPeerConnection.restartIce()` up to three times, four
  seconds apart, while the data channel can still carry the negotiation. If the channel closes or
  the restart fails, the session moves to `lost`, the parent alarm stays visible, and the UI asks
  for a new pairing.
- M4 presentation: the parent keeps rotation, zoom and normalized pan in `presentation.ts`.
  When transformed, the raw `<video>` is hidden behind the canvas. This also prevents a rotated
  fullscreen view from showing the unrotated video around the canvas after an orientation change.
  Rotation is limited to 90° steps, zoom to 1–4×, and pan to ±1 of the maximum range. The native
  video is shown when the view is unmodified. Once transformed, `PresentationVideo` redraws the
  video into a canvas with rotation, zoom and pan; the canvas is the visible parent surface.
- Native PiP is requested on the main video at identity. For a transformed view,
  `PresentationVideo` captures the canvas at 30 fps, adds the remote audio track, and requests PiP
  on a hidden video. Switching between identity and transformed views closes PiP; the user starts
  it again. Canvas PiP draws a connection warning into the frame while degraded.
- Hidden-page canvas PiP must not rely on `requestAnimationFrame`: browsers pause it. While the
  page is hidden and canvas PiP is active, `PresentationVideo` reads remote video frames through
  `MediaStreamTrackProcessor` and draws them, with a 15 fps timer and `requestVideoFrameCallback`
  fallback. The source video also stays full-size behind the canvas so the browser does not treat
  it as a tiny hidden element. This prevents the Android PiP window from freezing when the app
  goes to the home screen.
- Fullscreen requests the presentation stage with `requestFullscreen`, falls back to
  `webkitEnterFullscreen` on the video for iOS, and finally keeps a fixed in-app overlay. The
  `fullscreenchange` and WebKit fullscreen events keep `fullscreen`/`fullscreenMode` in sync, the
  exit button lives inside the stage, and body scrolling is locked while active. Entering
  fullscreen exits PiP first.
- Digital zoom only enlarges existing pixels. Strong zoom should be paired with a higher child
  resolution via `set-video`; real camera zoom is optional and not implemented.
  The monitoring feed doubles as the answer scanner, so it must be sharp enough to read a QR code.
- Secondary text uses `on-surface-muted`. Vuetify's `on-surface-variant` is M3's inverse-surface
  pair and is near-white in the light theme, which is unreadable on the neutral panels.
- The short code is the first four bytes of SHA-256 over the sorted, deduplicated DTLS fingerprints
  from both SDPs, reduced to six digits. It is computed locally on both devices.
- No SDP or pairing secret is logged or persisted. There is no analytics and no runtime CDN.

Current milestone status:

- **M0 (prototype):** complete — copy/paste SDP, child/parent media, data-channel ping.
- **M1 (pairing):** complete — compact single-code QR offer and answer, full-SDP fallback, scanner,
  expiry, short code, media negotiation over the data channel, Playwright two-context test.
- **M2 (control):** complete — media negotiation, audio/video on/off, frame rate, resolution,
  bitrate, gain, noise suppression, automatic gain, volume, actual status display and a two-second
  bidirectional RTT heartbeat.
- **M3 (operation):** complete — screen Wake Lock with visibility reacquisition, parent-controlled
  black fullscreen child display, six-second heartbeat alarm with Web Audio warning, automatic ICE
  restart attempts and a clear pairing prompt when recovery fails.
- **M4 (presentation):** complete — 90° rotation, 1–4× digital zoom, drag/pinch panning, reset,
  native Picture-in-Picture at identity and canvas PiP for transformed views.
- **M5 (PWA/hardening):** complete — install prompt and iOS hint, precached offline shell,
  CSP/referrer meta tags, recommended headers for header-capable hosts, dependency audit and a
  production PWA E2E job.

## End-to-End Tests

`e2e/pairing.spec.ts` starts Vite on `127.0.0.1:4173` and opens two isolated Chromium contexts. The
launch flags supply fake camera/microphone input and disable mDNS host-candidate hiding, so the two
contexts build a real WebRTC connection. The test opens the collapsible text fallback to drive the
full offer/answer flow, asserts both codes are a single compact chunk, then checks that media is
negotiated over the data channel, the parent receives video, both short codes match, and both
devices show an automatic RTT. It also toggles video and audio, changes frame rate, resolution and
bitrate, enables noise suppression and automatic gain, sets gain and volume, rotates, zooms,
pans, resets the presentation, enters and leaves fullscreen, opens native and canvas PiP, toggles
the child's dark screen, and verifies the child's tracks and reported status. A separate case
closes the child context and checks that the parent alarm appears, can be silenced and can be
stopped. Another dispatches
`pagehide` on the parent and checks that the child returns to pairing without an error. Three
additional cases check that the pairing screens do not scroll at phone viewport sizes.
`e2e/scanner.spec.ts` feeds a generated QR video through a fake camera and verifies the automatic
scanner, including the jsQR fallback when `BarcodeDetector` throws. `e2e/pwa.spec.ts` runs against
`vite preview` with service workers enabled, checks PWA metadata and the install prompt, then goes
offline and reloads the cached app shell. Install the browser once with
`npx playwright install chromium`.

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

CI runs the same steps on every push, plus `npm run build` and `npm run audit`. A separate
`e2e` job installs Chromium and runs the Playwright pairing test, uploading `test-results/` when it
fails. A `pwa` job builds the production bundle, serves it with `vite preview`, and checks the
manifest, CSP meta tag, install prompt and offline app shell against a real service worker.

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

## PWA and Security Headers

- `src/composables/useInstallPrompt.ts` captures `beforeinstallprompt`, exposes the install action
  and remembers a dismissal in localStorage. `HomeView` shows the install card, or an iOS
  Share → Add to Home Screen hint when the browser has no install prompt.
- VitePWA precaches JS, CSS, HTML, fonts, icons and the web manifest. The production PWA test
  reloads with the browser offline and asserts the home screen still renders.
- `index.html` sets a CSP meta tag. GitHub Pages cannot send response headers, so HSTS and
  Permissions-Policy are not enforceable there. `public/_headers` documents the stricter set for
  Cloudflare Pages, Netlify or another header-capable host; it is inert on GitHub Pages.
- The CSP allows `'unsafe-inline'` styles because Vuetify injects theme CSS at runtime. Scripts and
  connections stay same-origin, with `ws:`/`wss:` only for Vite HMR in development. Do not add
  remote script, font or analytics origins.
- `npm run audit` fails CI only on critical production advisories. Known moderate and high
  Vite/esbuild development-server advisories remain until a breaking Vite major upgrade is
  scheduled.

## Environment Variables

| Variable        | Default | Description                                                                             |
| --------------- | ------- | --------------------------------------------------------------------------------------- |
| `VITE_BASE_URL` | `/`     | Asset base path — `/baby-monitor/` for production, `/baby-monitor/staging/` for staging |

## Development Guidelines

- **Do not commit plans**: plans created in `.agents_tmp/` should never be committed. They are
  temporary working documents for the AI agent and should remain local-only.
- `public/icon.svg` is the source for every app icon and for the home-screen hero. `HomeView`
  loads that same file through `import.meta.env.BASE_URL`, so the installed app icon and the home
  logo cannot drift. Regenerate the PNGs beside it when the artwork changes. The maskable variant
  uses the same artwork; the glyph sits inside the central 50%, well within Android's safe zone.
- The home role cards are single-action surfaces: icon plus `Use as child device` or
  `Use as parent device`. Keep them keyboard-operable and avoid adding extra copy.
- `Stop monitoring` resets the peer session and calls `router.replace('/')` on both role views.
  On the parent, it first sends `end` and waits for the data channel to flush, so the child stops
  its tracks and returns to pairing step 1 without an error. The parent also sends `end` from
  `pagehide` and `onBeforeUnmount`; those paths are best effort because the browser may tear the
  connection down immediately. `Start over` and `Cancel` stay inside the pairing flow because they
  restart pairing rather than close a live stream.
- `PairingSteps` has a small bottom margin so the step graph is not glued to the next panel. The
  pairing views trim their outer padding to keep the 320×568 no-scroll test passing.
