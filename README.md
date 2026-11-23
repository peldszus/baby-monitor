# Baby Monitor

A serverless, browser-only baby monitor PWA. Two devices pair by exchanging a QR code, then send
and receive video and audio over a direct, encrypted WebRTC connection on the local network.

The current build covers Milestones 0, 1, 2, 3 and 4 from the
[concept](docs/babyphone-concept.md): a compact data-channel handshake by QR code or copy/paste,
media negotiated over that encrypted channel, parent controls for video, audio, frame rate,
resolution, bitrate, microphone gain, noise suppression, automatic gain and volume, operation
features for long-running use, and parent presentation controls. The child reports the values that
actually took effect. Both devices exchange an automatic RTT ping every two seconds.

M3 adds a screen Wake Lock, a black fullscreen child display that the parent can switch on, a loud
parent alarm after six seconds without a heartbeat, and automatic ICE restart attempts while the
data channel still works. M4 adds 90° rotation, 1–4× digital zoom, drag/pinch panning and
Picture-in-Picture, including a canvas pipeline that keeps the transformed view in the PiP window.

## Pairing

1. Open the app on the child device and choose **Child device**, then tap **Generate pairing
   code**. The child shows a QR code. The camera does not start yet.
2. Open the app on the parent device and choose **Parent device**, then tap **Scan child's code**.
   The parent shows an answer QR code.
3. On the child, tap **Scan parent's answer** and scan that code. Opening the answer step hides
   the child code, because the child cannot detect when the parent has scanned it; **Show child
   code again** restores it if needed. Both devices show a connecting spinner while the data
   channel opens. The child then starts its rear/main camera and negotiates audio and video; both
   sides show the live stream.

A three-node indicator marks the child code, parent code and connection steps. Text codes are
available under a collapsible fallback in each step, and the pairing screens are sized to avoid
vertical scrolling on phone viewports.

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
effective control. Each device pings the other every two seconds and shows the latest round-trip
time next to the connection state.

### Parent presentation

The parent video has rotate-left and rotate-right buttons, a 1–4× zoom slider, drag or pinch
panning, and a reset button. Rotation and zoom use a canvas renderer so the displayed region and
the PiP stream stay identical. Digital zoom only enlarges existing pixels; for a strong zoom,
raise the child resolution in the camera controls first.

The Picture-in-Picture button uses the browser's native video PiP when the view is unmodified. When
the view is rotated, zoomed or panned, the canvas is captured with `captureStream()`, the remote
audio track is attached, and that stream is shown in PiP. Transform changes while native PiP is
active close PiP so the new view can be started again. PiP support and behavior vary by browser;
the button is disabled with a short explanation when the API is unavailable.

No STUN or TURN server is used, so both devices must be on the same local network without client
isolation.

## Long-running operation

- Both devices request a screen Wake Lock while monitoring and re-request it when the page becomes
  visible again. If the browser does not support it, the status row says so. The parent keeps the
  lock while the connection-lost alarm is visible, so the warning stays on screen.
- The parent can switch the child display to a black fullscreen surface. On OLED screens this
  saves power and keeps the room dark. Double-tap the child screen, or press and hold it, to wake
  it locally.
- The parent unlocks a Web Audio warning tone with the first tap. If six seconds pass without a
  heartbeat response, or WebRTC reports a failure, a fullscreen warning appears and the tone
  sounds. You can silence the tone while the warning stays visible, or stop monitoring.
- On a short network interruption, both sides try an ICE restart over the existing data channel.
  This cannot repair a changed network or a closed data channel; when it fails, the app says so and
  asks for a new pairing.

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
