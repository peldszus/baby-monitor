# Baby Monitor

A serverless, browser-only baby monitor PWA. Two devices pair by exchanging a QR code, then send
and receive video and audio over a direct, encrypted WebRTC connection on the local network.

The current build covers Milestones 0, 1 and 2 from the
[concept](docs/babyphone-concept.md): a compact data-channel handshake by QR code or copy/paste,
media negotiated over that encrypted channel, and parent controls for video, audio, frame rate,
resolution, bitrate, microphone gain, noise suppression, automatic gain and volume. The child
reports the values that actually took effect. Wake locks, heartbeat alarms and presentation
features are still to come.

## Pairing

1. Open the app on the child device and choose **Child device**. Create the pairing code and show
   it to the parent. The camera does not start yet.
2. Open the app on the parent device and choose **Parent device**. Scan the child code, or paste
   the text code. The parent shows an answer QR code.
3. Scan or paste the answer on the child device. The data channel opens, then the child starts its
   rear/main camera and negotiates audio and video over that channel. Both sides show the live
   stream.

The QR code carries only the ICE credentials, DTLS fingerprint and host candidates; the rest of the
data-channel SDP comes from a shared template. It is one small code per direction and expires after
two minutes. A compressed full-SDP fallback still supports chunking if a browser combination needs
it. The scanner reads continuously while the dialog is open; there is no shutter button. Both
devices derive the same six-digit short code from the DTLS fingerprints so you can compare them out
of band.

Once connected, the parent device can turn video or audio off and on, change the frame rate,
resolution and bitrate, adjust microphone gain, and enable noise suppression or automatic gain.
The child stops the camera or microphone track when it is switched off, so the camera light goes
out. The parent also has a playback volume slider; on iOS the hardware volume may still be the
effective control.

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
