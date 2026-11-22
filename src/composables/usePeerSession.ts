import { onBeforeUnmount, ref, shallowRef } from 'vue'
import {
  createHello,
  createPing,
  createPong,
  decodeControlMessage,
  encodeControlMessage,
} from '@/core/control'
import { openChildMedia, stopStream } from '@/core/media-child'
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

  let peer: PeerSession | null = null
  let channel: RTCDataChannel | null = null
  let offerSdp = ''
  let answerSdp = ''
  let closedByUs = false

  const offerCollector = new SignalChunkCollector()
  const answerCollector = new SignalChunkCollector()

  function send(event: SessionEvent): void {
    const next = transition(state.value, event)
    if (next) state.value = next
  }

  function cleanupPeer(): void {
    closedByUs = true
    if (peer) {
      peer.close()
      peer = null
    }
    channel = null
    channelOpen.value = false
    stopStream(localStream.value)
    localStream.value = null
    remoteStream.value = null
    peerState.value = 'new'
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

  function handleControl(raw: unknown): void {
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
    }
  }

  function attachChannel(nextChannel: RTCDataChannel): void {
    channel = nextChannel
    channelOpen.value = nextChannel.readyState === 'open'

    const announce = () => {
      if (nextChannel.readyState !== 'open') return
      channelOpen.value = true
      nextChannel.send(encodeControlMessage(createHello(role, detectCapabilities())))
    }

    nextChannel.onopen = announce
    nextChannel.onclose = () => {
      channelOpen.value = false
    }
    nextChannel.onmessage = (event) => handleControl(event.data)

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
    return new PeerSession(role, {
      onTrack: (stream) => {
        remoteStream.value = stream
      },
      onStateChange: (nextState) => {
        if (closedByUs) return
        peerState.value = nextState
        if (nextState === 'connected') {
          send('connected')
          void refreshShortCode()
        } else if (nextState === 'disconnected') {
          send('degraded')
        } else if (nextState === 'failed' || nextState === 'closed') {
          error.value = 'The connection was lost. Pair again.'
          send('lost')
          cleanupPeer()
        }
      },
      onChannel: attachChannel,
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
      const stream = await openChildMedia()
      localStream.value = stream
      peer = createPeer()
      offerSdp = await peer.createOffer(stream)
      const encoded = await encodeSignal('offer', offerSdp)
      offerChunks.value = encoded.chunks
      offerExpiresAt.value = encoded.expiresAt
      return true
    } catch (cause) {
      fail(cause, 'Could not start the camera and microphone.')
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
      answerSdp = await peer.acceptOffer(offerSdp)
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
      error.value = 'Start the camera before scanning the answer.'
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
      await peer.acceptAnswer(answerSdp)
      send('connect')
      pairingProgress.value = null
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
    startChild,
    acceptOffer,
    acceptAnswer,
    sendPing,
    reset,
  }
}
