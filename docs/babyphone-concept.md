# Baby Monitor PWA – Concept and Feasibility Study

Nov 22, 2026 · @Pete

A browser-only baby monitor PWA is feasible: WebRTC covers capture, encoding and encryption, and a QR code replaces the signaling server. The hard part is running for hours on locked or backgrounded phones, not the streaming itself. This document is the decision basis and an implementation blueprint, including for an implementing agent.

## 1. Summary

The app is a pure frontend PWA. Media transport runs entirely over WebRTC, which is built into Chrome (Android) and Safari (iOS): camera and microphone access, encoding, decoding and encryption (DTLS-SRTP) all come from the browser. There is no media server and no signaling server. Pairing works through a QR code exchange that carries the connection data in an authenticated way.

The main risk is **long-running operation**: operating systems throttle camera, microphone and network access when the screen is locked or the app is in the background, especially on iOS. Networks with client isolation (typical for hotel Wi-Fi) can also block the direct connection.

Assessment: **Android/Chrome is well feasible. iOS/Safari is feasible in principle but more fragile.** The plan works if it is tested early on real devices.

## 2. Requirements

### 2.1 Functional

- **FR-1** PWA, frontend only, runs in the browser and is installable, no native app.
- **FR-2** Two roles: **child device** (camera/microphone, sends) and **parent device** (receives, shows video, plays audio).
- **FR-3** Live video and audio from the child device to the parent device on the same network.
- **FR-4** Pairing via QR code, simple and secure.
- **FR-5** Video settings controlled from the parent device: frame rate (slider), resolution/quality, bitrate.
- **FR-6** Audio and video can be switched on and off separately from the parent device. When off, nothing is sent and the hardware is not running.
- **FR-7** Child-device microphone sensitivity adjustable from the parent device; output volume adjustable on the parent device.
- **FR-8** Child-device display can be set to “dark” from the parent device (as a black fullscreen surface, see 7.2).
- **FR-9** Parent device: rotate the picture, pan and zoom to a region of interest.
- **FR-10** Parent device: floating overlay video with audio (Picture-in-Picture) while using other apps, with a way back to the app.
- **FR-11** Long-running operation over several hours on both devices.
- **FR-12** Connection monitoring with a clear warning on the parent device when it fails.
- **FR-13** Parent device: switch the video to fullscreen and back, with a visible exit control.
- **FR-14** Child device: choose among the cameras the browser exposes, without re-pairing.

### 2.2 Security

- **SR-1** Media and control data are always encrypted, including on untrusted networks (hotel Wi-Fi).
- **SR-2** Pairing is tamper-proof (no man-in-the-middle by anyone on the network).
- **SR-3** Automatic discovery only if it were equally secure. First version: none.
- **SR-4** As few dependencies as possible. Security-critical functions come from the browser, not from libraries.

### 2.3 Quality

- **QR-1** Testability: browser APIs sit behind thin adapters so unit, integration and end-to-end tests are possible (see section 11).

### 2.4 Non-goals (first version)

- Connections over the internet (TURN/STUN, remote access).
- Recording, cloud, accounts, push notifications while the app is closed.
- Multiple parent devices at once (possible later).
- Certified monitoring: the app does not replace supervision and is not a medical device. The UI should say so.

## 3. Architecture Overview

```
Child device (PWA)                        Parent device (PWA)
 getUserMedia -> MediaStream             <video> / AudioContext
 RTCPeerConnection  <== WebRTC (DTLS-SRTP, local) ==>  RTCPeerConnection
 RTCDataChannel  <== control/status (encrypted) ==>  RTCDataChannel

Static delivery of the PWA: HTTPS host (files only, no media path)
Pairing: QR code (offer) -> QR code (answer), no server
```

Building blocks:

1. **Transport:** a single `RTCPeerConnection` with an audio track, a video track and one data channel.
2. **Signaling:** QR-based, serverless; the QR codes carry only a compact data-channel handshake (section 4).
3. **Control channel and media negotiation:** JSON messages over the data channel (section 6); audio and video are negotiated over it after connecting (section 4.6).
4. **UI/logic:** Vue 3, role mode per device, state machine for connection and operation.
5. **PWA shell:** manifest, service worker (offline app shell), installability.

## 4. Pairing via QR Code

### 4.1 Flow

1. Child device: choose the “child” role, create the `RTCPeerConnection` and a data channel (**no audio/video tracks yet**), create the **offer** and wait until ICE gathering is complete (`iceGatheringState === 'complete'`, no trickle ICE). Extract the essentials (see 4.3) and show them as a small QR code.
2. Parent device: choose the “parent” role, scan the QR code, rebuild the data-channel-only offer from the template and set it, create the **answer**, wait for complete ICE gathering, extract the essentials and show them as a QR code.
3. Child device: scan the answer, rebuild it from the template and set it. The data channel opens; it is already encrypted and authenticated.
4. Over the data channel the devices negotiate audio and video (4.6). Only then are camera and microphone started on the child device.

That is still two scans, because a browser cannot listen on a port or accept incoming connections: the QR codes must carry the handshake data in both directions. They are small, so the app should switch to scan mode automatically after the first scan. A relay server would need only one scan but contradicts the serverless goal.

### 4.2 Why this is secure

- The QR payload contains the **DTLS certificate fingerprint** and the ICE credentials (`ice-ufrag`, `ice-pwd`). Because both travel by line of sight through the QR code, an attacker on the Wi-Fi can neither swap the fingerprint nor take over the connection.
- Only these two instances can connect. The QR codes are **one-time secrets**: short validity (for example two minutes), then discard; never store or log them.
- Optional: a **short code to compare** (short authentication string) derived from both fingerprints (for example SHA-256 over the sorted concatenation, shown as 4 words or 6 digits) on both devices. This adds protection if a QR code was photographed.

### 4.3 Compact QR Payload

Each QR code carries only what the other side cannot know. Everything else (media lines, attributes, SCTP settings) comes from a fixed SDP template that both sides share, because both run the same app. A data-channel-only SDP is small and stable across Chrome and Safari. Codecs are negotiated later over the data channel (4.6), so no codec details ever enter a QR code.

Payload per direction (roughly 100–150 bytes):

1. Format version (1 byte), so the fallback format below can be told apart.
2. `ice-ufrag` and `ice-pwd`.
3. DTLS fingerprint (32 bytes, SHA-256) and the `setup` role.
4. One or two host candidates (IP and port, or the mDNS host name). Leave out TCP, relay and srflx candidates.

Encode as a fixed-layout binary record, then Base64url. Rebuild the SDP by filling the template and call `setRemoteDescription`. Validate every field (length, charset) before it enters the SDP, and never copy unknown fields into it.

Fallback format (version 2): the full SDP compressed with `CompressionStream('deflate-raw')` and Base64url, used if the template path fails on some browser combination. If one code is still too large, split it into a short sequence of QR codes (chunks with index/total and checksum).

The QR code itself needs a small library (there is no browser API for generating it). Use a small, dependency-free, pinned library. For scanning, prefer `BarcodeDetector` (Chrome/Android) and use a small scanner library as a fallback for Safari. Alternative: scan with the system camera and open a link that carries the code in the fragment (`#…`, which is not sent to the server).

### 4.4 Network (ICE)

- Do not configure STUN/TURN servers (`iceServers: []`). This keeps everything local and free of external contacts.
- Browsers hide local IPs behind mDNS host names (`*.local`). This works on many networks but fails with **client isolation** and sometimes with blocked mDNS (typical for hotel and guest Wi-Fi). Then no direct connection is possible. Workaround: a hotspot on one of the phones. This is a practical risk and must be tested.
- This limitation is accepted as long as there is no server.

### 4.5 Reconnection (honest limitation)

Short interruptions often heal on their own in WebRTC (`disconnected` goes back to `connected`). An **ICE restart**, however, needs a signaling path: over the data channel it works only while the channel still works. After a longer outage or a new network address a **new pairing via QR** is required. The UI must communicate this clearly, and the parent device must raise the failure loudly (see 7.1).

### 4.6 Media Negotiation over the Data Channel

Once the data channel is open, the child device adds its audio and video tracks (creating the transceivers) and sends an offer as a `negotiate` message; the parent device answers over the same channel. Each browser generates its own media SDP, so no SDP is edited by hand and Chrome/Safari differences stay inside the browser.

- Use the “perfect negotiation” pattern (polite/impolite peer) to avoid offer collisions; the parent device is the polite peer.
- Keep the transceivers for the lifetime of the connection. Switching video or audio on and off later uses `replaceTrack` (section 5) and needs no renegotiation; adding a track or changing codec preferences does.
- Start camera and microphone only after the negotiation has succeeded, and show “connecting media” in the UI during the short delay (typically a few hundred milliseconds).
- Validate negotiation messages like every other control message (section 6).

## 5. Media

- **Capture:** `getUserMedia({audio, video})` on the child device. Default: rear/main camera at 1280×720, 16:9 and 15 fps ideal, with `crop-and-scale` allowed so a square-only browser capture can be fitted to 16:9; lower values remain available for bandwidth and power control. The child starts on a normal rear lens where labels allow and can switch among the cameras the browser exposes. The camera list is label-sorted; generic Android labels fall back to the first label in string order. The QR scanner also prefers a normal rear lens over an ultra-wide one.
- **Codecs:** browser defaults (VP8/H.264, Opus). Intervene with `RTCRtpTransceiver.setCodecPreferences` only where needed (for example test H.264 for hardware encoding on some devices).
- **Video hint:** set `videoTrack.contentHint = 'motion'` or `'detail'` and test.
- **Audio processing:** `echoCancellation: false` (no echo scenario); `noiseSuppression` and `autoGainControl` adjustable, default rather **off**, because they can suppress quiet sounds.
- **Microphone sensitivity:** route the capture stream through a `GainNode` (Web Audio) and a peak limiter (`DynamicsCompressorNode`), then send the output of a `MediaStreamAudioDestinationNode`. Set the gain via the control channel.
- **Dynamic quality:**
  - Frame rate: `videoTrack.applyConstraints({frameRate})` and/or `sender.setParameters()` with `maxFramerate`.
  - Resolution: `scaleResolutionDownBy` in `setParameters()` (no camera restart, preferred), alternatively `applyConstraints({width, height})`.
  - Bitrate: `maxBitrate`. `degradationPreference` decides whether resolution or frame rate suffers first.
  - Browsers differ in `setParameters`. Always report the values actually applied via `getStats()` and show them in the UI, not only the requested value.
- **Really off instead of just muted:** on switch-off use `track.stop()` and `RTCRtpSender.replaceTrack(null)`; on switch-on get a new track and insert it with `replaceTrack`. `track.enabled = false` alone keeps sending (silence/black) and saves less. With video off the camera and its LED go off.
- **Sound level:** measure the level on the parent device with an `AnalyserNode` (display, optional noise alarm).

## 6. Control Channel (Data Channel)

One `RTCDataChannel` (`ordered: true`, label `control`), encrypted like the media. Versioned JSON messages with a `type`:

| Direction      | Type            | Content                                                                              |
| -------------- | --------------- | ------------------------------------------------------------------------------------ |
| both           | `hello`         | `{v:1, role, caps}` with capabilities (for example supported constraints)            |
| both           | `ping` / `pong` | `{t}` heartbeat, every 2 s                                                           |
| both           | `negotiate`     | `{description: {type, sdp}}` media offer/answer over the data channel (4.6)          |
| parent → child | `set-video`     | `{enabled, fps, scaleDownBy, maxBitrate}`                                            |
| parent → child | `set-audio`     | `{enabled, gain, noiseSuppression, autoGainControl}`                                 |
| parent → child | `set-screen`    | `{dark}`                                                                             |
| parent → child | `end`           | no payload; stop the child stream and return to pairing                              |
| child → parent | `status`        | `{battery, charging, fps, width, height, bitrate, audioLevel, screenDark, zoomCaps}` |
| child → parent | `ack` / `error` | acknowledgement or error for a command (`id`)                                        |

Rules:

- Every message has `id` and `v`. Ignore unknown types and fields.
- **Validate all input:** types, value ranges (for example fps 1–30, gain 0–10), message size limit, rate limit.
- Commands are accepted only over the authenticated channel. The child device executes commands only from this one connection.
- The child device answers with the state **actually** applied (`status`) and the parent device shows that state.

## 7. Long-Running Operation and Background Behavior

### 7.1 Reliability

- **Heartbeat:** `ping` every 2 s. If `pong` is missing (for example for 6 s) or `connectionState` changes to `disconnected`/`failed`, the parent device raises a **loud alarm** (warning tone via Web Audio, clear fullscreen warning). A baby monitor that fails silently is more dangerous than none.
- **Clean stop:** either device can send an `end` message. The other side stops its tracks, returns to the home screen, and shows a timestamped notice. An abrupt loss stays on the alarm path.
- The alarm sound must be “unlocked” beforehand by a user action (autoplay rules): play a short tone when monitoring starts.
- Automatic reconnection attempts (see 4.5), then a clear prompt for a new pairing.

### 7.2 Display and Power

- **Wake Lock** (`navigator.wakeLock.request('screen')`) on both devices, re-request after `visibilitychange`.
- **Child device “display off”:** truly switching off the screen is **not** possible from the browser. Workaround: on command show a purely **black fullscreen surface** (`requestFullscreen`, UI hidden). On OLED this saves a lot of power and nothing lights up the room; on LCD it saves little. Wake it with a long press or double tap to avoid accidental input. The system must not lock the display meanwhile, otherwise the camera stops.
- Run the child device **on a charger**. Report the battery level via the Battery Status API where available (Chrome/Android, not Safari).
- Power levers: low frame rate/resolution; video off (audio-only mode) is the biggest lever.
- **Background on the parent device:** a locked screen or background use is unreliable (iOS especially). Recommended operation: Wake Lock and a dimmed or dark surface, or PiP (see 8). `<audio>` plus the Media Session API improves behavior but is not guaranteed.

### 7.3 Mandatory Test

A **night test** (6–8 hours, both devices, default settings, real Wi-Fi) on all target devices before building additional features.

## 8. Parent Device: Presentation

- **Rotate:** CSS `transform: rotate()` in 90° steps on the `<video>`.
- **Pan and zoom:** Pointer Events (pinch, drag), CSS transforms. Store the selection locally (rotation, zoom, position).
- **Digital zoom** only enlarges existing pixels. For strong zoom, request a higher resolution via `set-video`.
- **Real camera zoom** (`zoom` constraint) exists only on some Android devices. Optional bonus, not a core feature. Pan/tilt is practically unavailable, and Safari supports neither.
- **Picture-in-Picture (FR-10):** `video.requestPictureInPicture()` (triggered by a user action). The operating system manages the window: movable, return button included, audio keeps playing. There are no custom controls in the window (at most Media Session actions). On Android/Chrome possibly automatic when leaving the app (Media Session handler, version dependent). iOS: PiP for video exists but is less reliable in installed PWAs; test on a real device. Document PiP exists only on desktop.
- **Zoom/pan in PiP:** CSS transforms do not apply there. Solution: render the region with `canvas.drawImage()`, pass `canvas.captureStream()` into a second `<video>` and send that one to PiP. A warning icon for a lost connection can be drawn into the picture (visible only).
- **Volume on the parent device:** use a `GainNode` (`video.volume` is often ineffective on iOS). Note: in Chrome a remote audio stream sometimes has to be attached to an additional (muted) media element to reach Web Audio. Verify the behavior on the target versions.

## 9. Security Concept

- **Transport:** WebRTC enforces DTLS-SRTP. Media and data channel are always encrypted. Do not write your own cryptography.
- **Authentication:** through the QR exchange (4.2), optionally the short-code comparison.
- **No external contacts:** no STUN/TURN, no analytics, no CDN scripts at runtime.
- **Delivery:** HTTPS only (also a prerequisite for `getUserMedia` and PWA). Strict headers: Content-Security-Policy (`default-src 'self'`, no `unsafe-inline`/`unsafe-eval`), `Referrer-Policy: no-referrer`, `Permissions-Policy` for camera/microphone only, HSTS.
- **Supply chain:** as few pinned dependencies as possible (Vue, build tooling, QR library, possibly a scanner fallback). Lockfile, regular audits. Everything bundled by yourself, nothing loaded from third-party servers.
- **Data:** never store or log offer/answer. Never record or persist media.
- **Input:** validate control messages strictly (6).
- **Privacy:** the app transmits images of a child. Hence no cloud and no telemetry.

## 10. Technical Recommendations for Implementation

- **Stack:** Vue 3 (Composition API), TypeScript, Vite, `vite-plugin-pwa` (service worker, manifest). Pinia only if needed.
- **Module structure:**
  - `core/peer.ts`: wraps `RTCPeerConnection`, offer/answer, ICE gathering, state reporting.
  - `core/signaling-qr.ts`: compact payload codec (SDP template, binary encode/decode), full-SDP fallback, chunking, validity period.
  - `core/control.ts`: data channel protocol (types, validation, heartbeat).
  - `core/negotiation.ts`: media offer/answer over the data channel (perfect negotiation, parent is the polite peer).
  - `core/camera.ts`: video input listing and normal-rear-camera preference.
  - `core/media-child.ts`: `getUserMedia`, gain graph, constraints, `replaceTrack`.
  - `core/media-parent.ts`: playback, gain, level measurement, canvas pipeline for PiP.
  - `core/power.ts`: Wake Lock, battery, visibility, black fullscreen surface.
  - `core/alarm.ts`: heartbeat evaluation, alarm sound.
  - `ui/`: role selection, pairing view, parent view, child view, settings.
- **State machine** per device: `idle → pairing → connecting → connected → degraded → lost`. All transitions explicit; UI and alarm depend only on the state.
- **Capability detection** instead of user-agent switches: check features before use (`'wakeLock' in navigator`, `typeof BarcodeDetector`, `document.pictureInPictureEnabled`, `RTCRtpSender.prototype.setParameters`) and honestly show degraded functions to the user.
- **Telemetry in the UI:** actual fps, resolution, bitrate, connection state, latency (RTT from `getStats()`).
- **Adapters for testability:** access `MediaDevices`, the QR scanner, Wake Lock, the clock and the battery only through small interfaces that tests can replace (see 11).

## 11. Test Strategy

The two-device setup is testable: Playwright can start two isolated browser contexts (child and parent) in one process and build a real WebRTC connection between them. Tests run in layers.

### 11.1 Layers

1. **Unit tests (Vitest):** everything without browser APIs.
   - Control protocol: validation, value ranges, unknown fields.
   - QR payload: compact encode/decode round trip, SDP template rebuilt from real Chrome and Safari SDPs, full-SDP fallback, chunking, checksum, expiry.
   - State machine and heartbeat with fake timers (alarm after 6 s without pong).
   - Short code derived from fingerprints.
2. **Integration tests:** two real `RTCPeerConnection`s in the same Chromium page (Vitest Browser Mode or Playwright). Cover the compact handshake, data channel, media renegotiation over the data channel, commands and status messages, without UI.
3. **End-to-end tests (Playwright):** two contexts, the real flow: role selection, pairing, video arrives, controls take effect, alarm on connection loss, and a clean stop from either side that returns both devices home.
4. **Manual device tests:** everything automation cannot cover (see 11.3).

### 11.2 What Playwright Can Do in Chromium

- **Fake media:** Chromium flags `--use-fake-device-for-media-stream`, `--use-fake-ui-for-media-stream` and optionally `--use-file-for-fake-video-capture=…`. `getUserMedia` then delivers a test picture and tone without a permission dialog.
- **Verify the picture really arrives:** on the parent side read frames from the `<video>` (canvas) or evaluate `getStats()` (`framesDecoded` and bytes keep rising) instead of only checking the connection state.
- **mDNS:** in tests, set `--disable-features=WebRtcHideLocalIpsWithMdns` if loopback ICE has trouble.
- **QR scan:** faking the camera as a scanner is laborious. Better: wrap the scanner component behind an interface and feed the decoded string directly in the E2E test (test hook). The QR round trip itself (generate code, decode image) gets its own test.
- **Failure scenarios:** simulate a connection loss by closing one side or freezing the page. DevTools network emulation barely affects WebRTC UDP; for packet loss use `tc/netem` in a container.

### 11.3 Limits (honest)

- **WebKit/iOS:** Playwright’s WebKit has hardly usable fake media and is not Mobile Safari. It is good for UI rendering, not for WebRTC behavior.
- **Not automatable:** Wake Lock, PiP, background and lock-screen behavior, battery, heat, real hotel Wi-Fi. These stay the **manual device matrix** plus the night test. They are exactly the riskiest points, so schedule fixed time for them.
- Firefox has its own fake-media settings but is not a target platform. Chromium is enough as the automated baseline.

### 11.4 Making It Testable (Architecture)

- Browser APIs behind thin adapters (`MediaDevices`, `Scanner`, `WakeLock`, `Clock`) that can be replaced. The `core/*` structure in section 10 already follows this.
- Test hooks only in the test build, never in production (for example `window.__test`), and never log a secret.
- A fixed set of states and events that the tests also assert.

### 11.5 Recommendation

Start in M0/M1 with Vitest (protocol, QR) plus one Playwright two-context test for the pairing flow. It is the safety net for all later refactoring. Run Vitest and the Playwright suite in CI on every change; the device matrix and the night test run before each release.

## 12. Risks and Countermeasures

| Risk                                              | Impact                       | Countermeasure                                                                                          |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------- |
| Client isolation / mDNS blocked on Wi-Fi          | no connection                | hotspot as workaround, clear error message, test on hotel Wi-Fi                                         |
| iOS stops camera/audio in the background          | failure during operation     | Wake Lock, dark fullscreen mode, night test, clear usage notes                                          |
| QR code too large                                 | pairing fails                | compact payload (4.3), chunking as fallback                                                             |
| SDP template not accepted by some browser version | pairing fails on that device | data-channel-only template, round-trip tests with real Chrome and Safari SDPs, full-SDP fallback format |
| Differences in `setParameters`                    | slider has no effect         | measure via `getStats()`, fallbacks, show the actual value                                              |
| Silent failure                                    | danger during operation      | heartbeat, loud alarm, status display                                                                   |
| Overheating/battery on the child device           | abort                        | charger, low load, audio-only mode                                                                      |
| New pairing after a longer outage                 | loss of convenience          | explain in the UI, make pairing as fast as possible                                                     |
| Dependencies (QR library)                         | security vulnerabilities     | few, pinned, reviewed packages                                                                          |
| Automation misses device-specific behavior        | regressions unnoticed        | manual device matrix and night test as release gate                                                     |

## 13. Milestones

1. **M0 Prototype:** two phones, SDP via copy-paste, video/audio on home Wi-Fi, data channel with ping. Vitest set up for protocol code.
2. **M1 Pairing:** compact QR payload (data-channel-only SDP template) with full-SDP fallback, scanner, validity period, optional short code. First Playwright two-context pairing test.
3. **M2 Control:** media negotiation over the data channel, audio/video on/off, frame rate, resolution, bitrate, mic gain, volume, status display. Integration tests for all commands and for renegotiation.
4. **M3 Operation:** Wake Lock, black fullscreen surface, heartbeat and alarm, reconnection. E2E test for alarm on connection loss.
5. **M4 Presentation:** rotation, pan/zoom, PiP (standard first, then the canvas variant) and fullscreen video.
6. **M5 PWA/hardening:** installability, offline shell, CSP and headers, dependency audit. CI with unit, integration and E2E tests.
7. **M6 Acceptance:** night test (6–8 h), device matrix, test on hotel Wi-Fi and with client isolation.

**Acceptance criteria (excerpt):** pairing in under one minute. A connection failure triggers an audible alarm within about 6 s. Night test without interruption on the Android target configuration. No contact with servers except loading the app files. All control commands are validated and demonstrably take effect (actual values from `getStats()`). The automated suite is green in CI.

## 14. Open Points and Decisions

- Define target devices and browser versions (Android model, iOS version).
- QR decision: two scans without a server (a browser cannot accept incoming connections), kept small by the compact payload. Later optionally a small relay as a convenience that does not weaken the security assumptions.
- Freeze the compact payload layout (field order, lengths, version byte) after testing real Chrome and Safari SDPs.
- Which additional features follow after the first version (noise alarm, night light, multiple parent devices)?
- Hosting of the static PWA (HTTPS host, header configuration).
