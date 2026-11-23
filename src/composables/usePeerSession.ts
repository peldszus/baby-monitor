import { onBeforeUnmount, ref, shallowRef } from 'vue'
import {
  createHello,
  createNegotiate,
  createPing,
  createPong,
  createSetAudio,
  createSetScreen,
  createSetVideo,
  createStatus,
  decodeControlMessage,
  encodeControlMessage,
  type ControlMessage,
  type SetAudioMessage,
  type SetScreenMessage,
  type SetVideoMessage,
  type StatusMessage,
} from '@/core/control'
import { WebAudioAlarm } from '@/core/alarm'
import { HeartbeatMonitor } from '@/core/heartbeat'
import { ChildMediaController, stopStream } from '@/core/media-child'
import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_VIDEO_SETTINGS,
  type AudioSettings,
  type VideoSettings,
} from '@/core/media-settings'
import type { MediaStatus } from '@/core/media-stats'
import type { NegotiationDescription } from '@/core/negotiation'
import { PeerSession, type PeerRole } from '@/core/peer'
import { enterAppFullscreen, exitAppFullscreen, ScreenWakeLock } from '@/core/power'
import {
  decodeSignal,
  encodeSignal,
  SignalChunkCollector,
  type SignalFailure,
} from '@/core/signaling-qr'
import { deriveShortCode } from '@/core/short-code'
import { transition, type SessionEvent, type SessionState } from '@/core/state'

function messageForFailure(reason: SignalFailure): string {
  switch (reason) {
    case 'empty':
      return 'The pairing code is empty.'
    case 'incomplete':
      return 'This pairing code is split across several QR codes. Scan all of them.'
    case 'checksum':
      return 'The pairing code is damaged. Scan it again.'
    case 'decompression':
    case 'invalid-payload':
      return 'The pairing code could not be read.'
    case 'expired':
      return 'The pairing code has expired. Create a new one.'
    default:
      return 'This pairing code is not valid.'
  }
}

interface BatteryLike {
  level: number
  charging: boolean
}

async function readBattery(): Promise<{ battery: number | null; charging: boolean | null }> {
  const getBattery = (navigator as Navigator & { getBattery?: () => Promise<BatteryLike> })
    .getBattery
  if (typeof getBattery !== 'function') return { battery: null, charging: null }
  try {
    const battery = await getBattery.call(navigator)
    return {
      battery: Math.min(100, Math.max(0, Math.round(battery.level * 100))),
      charging: battery.charging,
    }
  } catch {
    return { battery: null, charging: null }
  }
}

function detectCapabilities(): string[] {
  const caps: string[] = []
  if ('wakeLock' in navigator) caps.push('wake-lock')
  if ('BarcodeDetector' in globalThis) caps.push('barcode-detector')
  if (document.pictureInPictureEnabled) caps.push('picture-in-picture')
  if (typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype) {
    caps.push('canvas-capture-stream')
  }
  if ('MediaStreamTrackProcessor' in globalThis) caps.push('media-stream-track-processor')
  if (typeof RTCRtpSender !== 'undefined' && 'setParameters' in RTCRtpSender.prototype) {
    caps.push('rtp-parameters')
  }
  return caps
}

export function usePeerSession(role: PeerRole) {
  const state = ref<SessionState>('idle')
  const error = ref<string | null>(null)
  const pairingProgress = ref<string | null>(null)
  const localStream = shallowRef<MediaStream | null>(null)
  const remoteStream = shallowRef<MediaStream | null>(null)
  const offerChunks = ref<string[]>([])
  const answerChunks = ref<string[]>([])
  const offerExpiresAt = ref<number | null>(null)
  const answerExpiresAt = ref<number | null>(null)
  const shortCode = ref<string | null>(null)
  const rttMs = ref<number | null>(null)
  const peerState = ref<RTCPeerConnectionState>('new')
  const channelOpen = ref(false)
  const videoSettings = ref<VideoSettings>({ ...DEFAULT_VIDEO_SETTINGS })
  const audioSettings = ref<AudioSettings>({ ...DEFAULT_AUDIO_SETTINGS })
  const volume = ref(1)
  const mediaStatus = ref<MediaStatus | null>(null)
  const batteryLevel = ref<number | null>(null)
  const charging = ref<boolean | null>(null)
  const screenDark = ref(false)
  const alarmActive = ref(false)
  const alarmMuted = ref(false)
  const reconnecting = ref(false)
  const wakeLockActive = ref(false)
  const wakeLockSupported = ref(false)

  const unlockAlarm = (): void => {
    void alarm?.unlock()
  }
  if (role === 'parent') window.addEventListener('pointerdown', unlockAlarm, { once: true })

  let peer: PeerSession | null = null
  let media: ChildMediaController | null = null
  let statusTimer: ReturnType<typeof setInterval> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null
  let reconnectTimer: ReturnType<typeof setInterval> | null = null
  let reconnectAttempts = 0
  let statusInFlight = false
  let channel: RTCDataChannel | null = null
  let offerSdp = ''
  let answerSdp = ''
  let closedByUs = false
  let mediaStarted = false
  let mediaReady = false

  const offerCollector = new SignalChunkCollector()
  const answerCollector = new SignalChunkCollector()
  const heartbeat = new HeartbeatMonitor()
  const alarm = role === 'parent' ? new WebAudioAlarm() : null
  const wakeLock = new ScreenWakeLock(undefined, undefined, (active) => {
    wakeLockActive.value = active
  })
  wakeLockSupported.value = wakeLock.supported

  function send(event: SessionEvent): void {
    const next = transition(state.value, event)
    if (next) state.value = next
  }

  function stopStatusLoop(): void {
    if (statusTimer) clearInterval(statusTimer)
    statusTimer = null
  }

  function stopPingLoop(): void {
    if (pingTimer) clearInterval(pingTimer)
    pingTimer = null
  }

  function stopHeartbeat(): void {
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    heartbeatTimer = null
    heartbeat.stop()
  }

  function startHeartbeat(): void {
    stopHeartbeat()
    heartbeat.start()
    heartbeatTimer = setInterval(() => {
      if (role === 'parent' && (state.value === 'connected' || state.value === 'degraded')) {
        if (!heartbeat.isStale()) return
        if (state.value === 'connected') {
          send('degraded')
          scheduleReconnect()
        }
        triggerAlarm()
      }
    }, 1000)
  }

  function clearAlarm(): void {
    alarmActive.value = false
    alarmMuted.value = false
    alarm?.stop()
  }

  function triggerAlarm(): void {
    if (role !== 'parent' || alarmActive.value) return
    if (state.value !== 'connected' && state.value !== 'degraded') return
    alarmActive.value = true
    alarmMuted.value = false
    void wakeLock.acquire()
    alarm?.start()
  }

  function silenceAlarm(): void {
    if (!alarmActive.value) return
    alarmMuted.value = true
    alarm?.stop()
  }

  function stopReconnect(): void {
    if (reconnectTimer) clearInterval(reconnectTimer)
    reconnectTimer = null
    reconnectAttempts = 0
    reconnecting.value = false
  }

  function attemptReconnect(): void {
    if (state.value !== 'degraded' && state.value !== 'connected') {
      stopReconnect()
      return
    }
    if (reconnectAttempts >= 3) {
      stopReconnect()
      return
    }
    reconnectAttempts += 1
    try {
      peer?.restartIce()
    } catch {
      // The peer may already be closed; the state handler will finish the cleanup.
    }
  }

  function scheduleReconnect(): void {
    if (reconnectTimer) return
    reconnecting.value = true
    reconnectAttempts = 0
    attemptReconnect()
    reconnectTimer = setInterval(attemptReconnect, 4000)
  }

  function startPingLoop(): void {
    stopPingLoop()
    void sendPing()
    pingTimer = setInterval(() => {
      void sendPing()
    }, 2000)
  }

  function cleanupPeer(): void {
    closedByUs = true
    stopStatusLoop()
    stopPingLoop()
    stopHeartbeat()
    stopReconnect()
    if (!(role === 'parent' && alarmActive.value)) void wakeLock.release()
    if (screenDark.value) {
      screenDark.value = false
      void exitAppFullscreen()
    }
    media?.stop()
    media = null
    if (peer) {
      peer.close()
      peer = null
    }
    channel = null
    channelOpen.value = false
    mediaStarted = false
    mediaReady = false
    stopStream(localStream.value)
    localStream.value = null
    remoteStream.value = null
    peerState.value = 'new'
    mediaStatus.value = null
    batteryLevel.value = null
    charging.value = null
    rttMs.value = null
    videoSettings.value = { ...DEFAULT_VIDEO_SETTINGS }
    audioSettings.value = { ...DEFAULT_AUDIO_SETTINGS }
    volume.value = 1
  }

  function clearPairing(): void {
    offerChunks.value = []
    answerChunks.value = []
    offerExpiresAt.value = null
    answerExpiresAt.value = null
    shortCode.value = null
    rttMs.value = null
    offerSdp = ''
    answerSdp = ''
    offerCollector.reset()
    answerCollector.reset()
  }

  function fail(cause: unknown, fallback: string): void {
    if (role === 'parent' && (state.value === 'connected' || state.value === 'degraded')) {
      triggerAlarm()
    }
    error.value = cause instanceof Error ? cause.message : fallback
    send('lost')
    cleanupPeer()
  }

  function maybeConnected(): void {
    if (!mediaReady || peerState.value !== 'connected') return
    if (state.value === 'connecting') send('connected')
    else if (state.value === 'degraded') send('recovered')
    else return
    stopReconnect()
    clearAlarm()
    startHeartbeat()
    void wakeLock.acquire()
    void alarm?.unlock()
    pairingProgress.value = null
    void refreshShortCode()
  }

  function sendControl(message: ControlMessage): boolean {
    if (!channel || channel.readyState !== 'open') return false
    try {
      channel.send(encodeControlMessage(message))
      return true
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not send the command.'
      return false
    }
  }

  function startStatusLoop(): void {
    stopStatusLoop()
    statusTimer = setInterval(() => {
      void sendStatus()
    }, 1000)
  }

  async function sendStatus(): Promise<void> {
    if (role !== 'child' || !peer || !channel || channel.readyState !== 'open') return
    if (statusInFlight) return
    statusInFlight = true
    const settings = media?.settings ?? {
      video: videoSettings.value,
      audio: audioSettings.value,
    }
    const size = media?.videoSize ?? { width: 0, height: 0 }
    try {
      const stats = await peer.getMediaStats({
        videoEnabled: settings.video.enabled,
        audioEnabled: settings.audio.enabled,
        gain: settings.audio.gain,
        noiseSuppression: settings.audio.noiseSuppression,
        autoGainControl: settings.audio.autoGainControl,
        fallbackWidth: size.width,
        fallbackHeight: size.height,
      })
      mediaStatus.value = stats
      const battery = await readBattery()
      batteryLevel.value = battery.battery
      charging.value = battery.charging
      if (channel?.readyState !== 'open') return
      channel.send(
        encodeControlMessage(
          createStatus({
            battery: battery.battery,
            charging: battery.charging,
            screenDark: screenDark.value,
            ...stats,
          })
        )
      )
    } catch {
      // The connection can close while stats are being read; the next tick stops.
    } finally {
      statusInFlight = false
    }
  }

  async function applySetVideo(message: SetVideoMessage): Promise<void> {
    if (!media || !peer) return
    error.value = null
    try {
      const track = await media.setVideoEnabled(message.enabled)
      await peer.replaceVideoTrack(track)
      const settings: VideoSettings = {
        enabled: message.enabled,
        fps: message.fps,
        scaleDownBy: message.scaleDownBy,
        maxBitrate: message.maxBitrate,
      }
      await media.setVideoSettings(settings)
      await peer.applyVideoParameters(settings)
      videoSettings.value = settings
      localStream.value = media.stream
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not change the video.'
    } finally {
      await sendStatus()
    }
  }

  async function applySetAudio(message: SetAudioMessage): Promise<void> {
    if (!media || !peer) return
    error.value = null
    try {
      const track = await media.setAudioEnabled(message.enabled)
      await peer.replaceAudioTrack(track)
      const settings: AudioSettings = {
        enabled: message.enabled,
        gain: message.gain,
        noiseSuppression: message.noiseSuppression,
        autoGainControl: message.autoGainControl,
      }
      await media.setAudioSettings(settings)
      audioSettings.value = settings
      localStream.value = media.stream
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : 'Could not change the audio.'
    } finally {
      await sendStatus()
    }
  }

  function updateVideoSettings(partial: Partial<VideoSettings>): void {
    if (role !== 'parent') return
    videoSettings.value = { ...videoSettings.value, ...partial }
    sendControl(createSetVideo(videoSettings.value))
  }

  function updateAudioSettings(partial: Partial<AudioSettings>): void {
    if (role !== 'parent') return
    audioSettings.value = { ...audioSettings.value, ...partial }
    sendControl(createSetAudio(audioSettings.value))
  }

  function setVolume(value: number): void {
    volume.value = Math.min(1, Math.max(0, value))
  }

  function setScreenDark(enabled: boolean): void {
    if (role !== 'parent') return
    screenDark.value = enabled
    if (!sendControl(createSetScreen(enabled))) screenDark.value = !enabled
  }

  async function applySetScreen(message: SetScreenMessage): Promise<void> {
    if (role !== 'child') return
    screenDark.value = message.dark
    if (message.dark) {
      await enterAppFullscreen()
    } else {
      await exitAppFullscreen()
    }
    await sendStatus()
  }

  async function wakeScreen(): Promise<void> {
    if (role !== 'child' || !screenDark.value) return
    screenDark.value = false
    await exitAppFullscreen()
    await sendStatus()
  }

  async function handleControl(raw: unknown): Promise<void> {
    const result = decodeControlMessage(raw)
    if (!result.ok) return
    const message = result.message

    if (message.type === 'ping') {
      if (channel?.readyState === 'open') {
        channel.send(encodeControlMessage(createPong(message.t)))
      }
      return
    }
    if (message.type === 'pong') {
      heartbeat.markSeen()
      if (alarmActive.value) clearAlarm()
      if (state.value === 'degraded' && peerState.value === 'connected') maybeConnected()
      rttMs.value = Math.max(0, Math.round(performance.now() - message.t))
      return
    }
    if (message.type === 'set-video') {
      if (role === 'child') await applySetVideo(message)
      return
    }
    if (message.type === 'set-audio') {
      if (role === 'child') await applySetAudio(message)
      return
    }
    if (message.type === 'set-screen') {
      if (role === 'child') await applySetScreen(message)
      return
    }
    if (message.type === 'status') {
      if (role === 'parent') {
        const status: StatusMessage = message
        mediaStatus.value = {
          fps: status.fps,
          width: status.width,
          height: status.height,
          bitrate: status.bitrate,
          audioLevel: status.audioLevel,
          gain: status.gain,
          videoEnabled: status.videoEnabled,
          audioEnabled: status.audioEnabled,
          noiseSuppression: status.noiseSuppression,
          autoGainControl: status.autoGainControl,
        }
        batteryLevel.value = status.battery
        charging.value = status.charging
        screenDark.value = status.screenDark
      }
      return
    }
    if (message.type === 'negotiate') {
      if (!peer) return
      try {
        await peer.handleNegotiation(message.description)
        mediaReady = true
        maybeConnected()
      } catch (cause) {
        fail(cause, 'Could not negotiate audio and video.')
      }
    }
  }

  async function onChannelReady(): Promise<void> {
    if (role === 'parent') {
      pairingProgress.value = 'Connecting media…'
      return
    }
    if (mediaStarted) return
    mediaStarted = true
    pairingProgress.value = 'Starting camera and microphone…'
    try {
      media = new ChildMediaController()
      const stream = await media.start()
      if (closedByUs || !peer) {
        media.stop()
        media = null
        return
      }
      localStream.value = stream
      videoSettings.value = { ...media.settings.video }
      audioSettings.value = { ...media.settings.audio }
      pairingProgress.value = 'Connecting media…'
      peer.startMedia(stream)
      startStatusLoop()
      void sendStatus()
    } catch (cause) {
      fail(cause, 'Could not start the camera and microphone.')
    }
  }

  function attachChannel(nextChannel: RTCDataChannel): void {
    channel = nextChannel
    channelOpen.value = nextChannel.readyState === 'open'
    let announced = false

    const announce = () => {
      if (announced || nextChannel.readyState !== 'open') return
      announced = true
      channelOpen.value = true
      try {
        nextChannel.send(encodeControlMessage(createHello(role, detectCapabilities())))
      } catch (cause) {
        fail(cause, 'Could not send the control handshake.')
        return
      }
      startPingLoop()
      void onChannelReady()
    }

    nextChannel.onopen = announce
    nextChannel.onclose = () => {
      channelOpen.value = false
      stopPingLoop()
    }
    nextChannel.onmessage = (event) => {
      void handleControl(event.data)
    }

    if (nextChannel.readyState === 'open') announce()
  }

  async function refreshShortCode(): Promise<void> {
    const offer = offerSdp
    const answer = answerSdp
    if (!offer || !answer) return
    const code = await deriveShortCode(offer, answer)
    if (code && offer === offerSdp && answer === answerSdp) shortCode.value = code
  }

  function createPeer(): PeerSession {
    closedByUs = false
    mediaStarted = false
    mediaReady = false
    return new PeerSession(role, {
      onTrack: (stream) => {
        remoteStream.value = stream
      },
      onStateChange: (nextState) => {
        if (closedByUs) return
        peerState.value = nextState
        if (nextState === 'connected') {
          stopReconnect()
          maybeConnected()
        } else if (nextState === 'disconnected') {
          send('degraded')
          scheduleReconnect()
        } else if (nextState === 'failed' || nextState === 'closed') {
          triggerAlarm()
          stopReconnect()
          error.value = 'The connection was lost. Pair again.'
          send('lost')
          cleanupPeer()
        }
      },
      onChannel: attachChannel,
      onNegotiation: (description: NegotiationDescription) => {
        if (!channel || channel.readyState !== 'open') {
          fail(
            new Error('The control channel is not open for media negotiation.'),
            'Could not negotiate audio and video.'
          )
          return
        }
        try {
          channel.send(encodeControlMessage(createNegotiate(description)))
        } catch (cause) {
          fail(cause, 'Could not negotiate audio and video.')
        }
      },
      onNegotiationError: (cause) => fail(cause, 'Could not negotiate audio and video.'),
    })
  }

  async function startChild(): Promise<boolean> {
    if (state.value !== 'idle' && state.value !== 'lost') return false
    clearAlarm()
    error.value = null
    pairingProgress.value = null
    cleanupPeer()
    clearPairing()
    send('start-pairing')

    try {
      peer = createPeer()
      offerSdp = await peer.createDataOffer()
      const encoded = await encodeSignal('offer', offerSdp)
      offerChunks.value = encoded.chunks
      offerExpiresAt.value = encoded.expiresAt
      return true
    } catch (cause) {
      fail(cause, 'Could not create the pairing code.')
      return false
    }
  }

  async function acceptOffer(text: string): Promise<boolean> {
    if (state.value !== 'idle' && state.value !== 'lost') {
      error.value = 'Start over before accepting another pairing code.'
      return false
    }
    clearAlarm()
    void wakeLock.release()
    error.value = null

    const collected = offerCollector.addMany(text)
    if (collected.status === 'partial') {
      pairingProgress.value = `Scanned ${collected.received} of ${collected.total} codes`
      return false
    }
    if (collected.status === 'invalid') {
      error.value = messageForFailure(collected.reason)
      return false
    }

    const decoded = await decodeSignal(collected.text)
    if (!decoded.ok) {
      error.value = messageForFailure(decoded.reason)
      return false
    }
    if (decoded.payload.kind !== 'offer') {
      error.value = 'This is not a child pairing code.'
      return false
    }

    send('start-pairing')
    offerSdp = decoded.payload.sdp
    offerExpiresAt.value = decoded.payload.expiresAt
    answerChunks.value = []
    answerExpiresAt.value = null
    shortCode.value = null

    try {
      peer = createPeer()
      answerSdp = await peer.acceptDataOffer(offerSdp)
      const encoded = await encodeSignal('answer', answerSdp)
      answerChunks.value = encoded.chunks
      answerExpiresAt.value = encoded.expiresAt
      send('connect')
      pairingProgress.value = null
      void refreshShortCode()
      return true
    } catch (cause) {
      fail(cause, 'Could not create the answer.')
      return false
    }
  }

  async function acceptAnswer(text: string): Promise<boolean> {
    if (!peer) {
      error.value = 'Start pairing before scanning the answer.'
      return false
    }
    if (state.value !== 'pairing') {
      error.value = 'This device is not waiting for an answer.'
      return false
    }
    error.value = null

    const collected = answerCollector.addMany(text)
    if (collected.status === 'partial') {
      pairingProgress.value = `Scanned ${collected.received} of ${collected.total} codes`
      return false
    }
    if (collected.status === 'invalid') {
      error.value = messageForFailure(collected.reason)
      return false
    }

    const decoded = await decodeSignal(collected.text)
    if (!decoded.ok) {
      error.value = messageForFailure(decoded.reason)
      return false
    }
    if (decoded.payload.kind !== 'answer') {
      error.value = 'This is not a parent answer code.'
      return false
    }

    try {
      answerSdp = decoded.payload.sdp
      await peer.acceptDataAnswer(answerSdp)
      send('connect')
      pairingProgress.value = 'Connecting media…'
      void refreshShortCode()
      return true
    } catch (cause) {
      fail(cause, 'Could not complete the connection.')
      return false
    }
  }

  function sendPing(): boolean {
    if (!channel || channel.readyState !== 'open') return false
    channel.send(encodeControlMessage(createPing(performance.now())))
    return true
  }

  function reset(): void {
    clearAlarm()
    cleanupPeer()
    send('reset')
    if (state.value !== 'idle') state.value = 'idle'
    error.value = null
    pairingProgress.value = null
    clearPairing()
  }

  onBeforeUnmount(() => {
    if (role === 'parent') window.removeEventListener('pointerdown', unlockAlarm)
    cleanupPeer()
    clearAlarm()
    void wakeLock.dispose()
    void alarm?.dispose()
  })

  return {
    state,
    error,
    pairingProgress,
    localStream,
    remoteStream,
    offerChunks,
    answerChunks,
    offerExpiresAt,
    answerExpiresAt,
    shortCode,
    rttMs,
    peerState,
    channelOpen,
    videoSettings,
    audioSettings,
    volume,
    mediaStatus,
    batteryLevel,
    charging,
    screenDark,
    alarmActive,
    alarmMuted,
    reconnecting,
    wakeLockActive,
    wakeLockSupported,
    startChild,
    acceptOffer,
    acceptAnswer,
    updateVideoSettings,
    updateAudioSettings,
    setVolume,
    setScreenDark,
    wakeScreen,
    silenceAlarm,
    reset,
  }
}
