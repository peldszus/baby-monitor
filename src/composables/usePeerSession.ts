import { onBeforeUnmount, ref, shallowRef } from 'vue'
import {
  createHello,
  createNegotiate,
  createPing,
  createPong,
  createSetAudio,
  createSetVideo,
  createStatus,
  decodeControlMessage,
  encodeControlMessage,
  type ControlMessage,
  type SetAudioMessage,
  type SetVideoMessage,
  type StatusMessage,
} from '@/core/control'
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

  let peer: PeerSession | null = null
  let media: ChildMediaController | null = null
  let statusTimer: ReturnType<typeof setInterval> | null = null
  let statusInFlight = false
  let channel: RTCDataChannel | null = null
  let offerSdp = ''
  let answerSdp = ''
  let closedByUs = false
  let mediaStarted = false
  let mediaReady = false

  const offerCollector = new SignalChunkCollector()
  const answerCollector = new SignalChunkCollector()

  function send(event: SessionEvent): void {
    const next = transition(state.value, event)
    if (next) state.value = next
  }

  function stopStatusLoop(): void {
    if (statusTimer) clearInterval(statusTimer)
    statusTimer = null
  }

  function cleanupPeer(): void {
    closedByUs = true
    stopStatusLoop()
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
    error.value = cause instanceof Error ? cause.message : fallback
    send('lost')
    cleanupPeer()
  }

  function maybeConnected(): void {
    if (!mediaReady || peerState.value !== 'connected') return
    if (state.value === 'connecting') send('connected')
    else if (state.value === 'degraded') send('recovered')
    else return
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
          createStatus({ battery: battery.battery, charging: battery.charging, ...stats })
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
      void onChannelReady()
    }

    nextChannel.onopen = announce
    nextChannel.onclose = () => {
      channelOpen.value = false
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
          maybeConnected()
        } else if (nextState === 'disconnected') {
          send('degraded')
        } else if (nextState === 'failed' || nextState === 'closed') {
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
    cleanupPeer()
    send('reset')
    if (state.value !== 'idle') state.value = 'idle'
    error.value = null
    pairingProgress.value = null
    clearPairing()
  }

  onBeforeUnmount(cleanupPeer)

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
    startChild,
    acceptOffer,
    acceptAnswer,
    sendPing,
    updateVideoSettings,
    updateAudioSettings,
    setVolume,
    reset,
  }
}
