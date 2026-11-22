# Baby Monitor

A serverless, browser-only baby monitor PWA. Two devices pair by exchanging a QR code, then send
and receive video and audio over a direct, encrypted WebRTC connection on the local network.

The current build covers Milestones 0 and 1 from the
[concept](Baby%20Monitor%20PWA%20–%20Concept%20and%20Feasibility%20Study.md): SDP exchange by
copy/paste or QR code, live media, and a data-channel ping. Media controls, wake locks, heartbeat
alarms and presentation features are still to come.

## Pairing

1. Open the app on the child device and choose **Child device**. Grant camera and microphone
   access. The device shows an offer QR code (or a text code).
2. Open the app on the parent device and choose **Parent device**. Scan the child code, or paste
   the text code. The parent shows an answer QR code.
3. Scan or paste the answer on the child device. Both sides connect and show the live stream.

Pairing codes are compressed and expire after two minutes. Large SDPs are split across several QR
codes. The scanner reads continuously while the dialog is open; there is no shutter button. The
offer is limited to Opus and VP8 so the code stays small. Both devices derive the same six-digit
short code from the DTLS fingerprints so you can compare them out of band.

No STUN or TURN server is used, so both devices must be on the same local network without client
isolation. There is no reconnection after a network change yet; pair again if the connection is
lost.

## Live environments

| Environment | URL                                              |
| ----------- | ------------------------------------------------ |
| Production  | https://peldszus.github.io/baby-monitor/         |
| Staging     | https://peldszus.github.io/baby-monitor/staging/ |

## Development

```bash
npm install
npm run dev
```

| Command                 | Description                                |
| ----------------------- | ------------------------------------------ |
| `npm run dev`           | Start dev server at http://localhost:5173  |
| `npm run build`         | Type-check then build for production       |
| `npm run preview`       | Preview production build                   |
| `npm run format`        | Rewrite all files with Prettier            |
| `npm run format:check`  | Check formatting without rewriting         |
| `npm run lint`          | Run ESLint on all files                    |
| `npm run type-check`    | Run vue-tsc on all source files            |
| `npm run test`          | Run Vitest unit tests                      |
| `npm run test:coverage` | Run unit tests with V8 coverage            |
| `npm run test:e2e`      | Run the Playwright two-device pairing test |

Install the Playwright browser once before running E2E tests:

```bash
npx playwright install chromium
```

## Deployment

Every push to `main` builds with `VITE_BASE_URL=/baby-monitor/` and publishes to the root of the
`gh-pages` branch. Every push to another branch builds with
`VITE_BASE_URL=/baby-monitor/staging/` and publishes to the `staging/` folder on the same branch.
Both workflows share a `github-pages` concurrency group.

GitHub Pages is already configured for this repository (Settings → Pages → Source →
`gh-pages` branch). A fork must enable it once.

See [AGENTS.md](AGENTS.md) for the full build and deployment notes.
