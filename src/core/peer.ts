import { encodeControlMessage, type ControlMessage } from './control'

export type PeerRole = 'child' | 'parent'

export interface PeerCallbacks {
  onTrack?: (stream: MediaStream) => void
  onStateChange?: (state: RTCPeerConnectionState) => void
  onChannel?: (channel: RTCDataChannel) => void
}

export type PeerFactory = (configuration: RTCConfiguration) => RTCPeerConnection

const defaultFactory: PeerFactory = (configuration) => new RTCPeerConnection(configuration)

const ICE_GATHERING_TIMEOUT_MS = 15_000

export function waitForIceGathering(
  connection: RTCPeerConnection,
  timeoutMs = ICE_GATHERING_TIMEOUT_MS
): Promise<void> {
  if (connection.iceGatheringState === 'complete') return Promise.resolve()

  return new Promise((resolve, reject) => {
    let settled = false

    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      connection.removeEventListener('icegatheringstatechange', check)
      if (error) reject(error)
      else resolve()
    }

    const check = () => {
      if (connection.iceGatheringState === 'complete') finish()
    }

    const timer = setTimeout(
      () => finish(new Error('ICE gathering did not complete in time. Try again.')),
      timeoutMs
    )
    connection.addEventListener('icegatheringstatechange', check)
    check()
  })
}

/**
 * Thin wrapper around one RTCPeerConnection. It owns the audio/video senders and
 * the single ordered control data channel; media and control are both DTLS-SRTP
 * encrypted by the browser. No STUN or TURN servers are configured.
 */
export class PeerSession {
  private readonly connection: RTCPeerConnection
  private readonly callbacks: PeerCallbacks
  private channel: RTCDataChannel | null = null

  constructor(
    readonly role: PeerRole,
    callbacks: PeerCallbacks = {},
    factory: PeerFactory = defaultFactory
  ) {
    this.callbacks = callbacks
    this.connection = factory({ iceServers: [] })

    this.connection.ontrack = (event) => {
      const stream = event.streams[0]
      if (stream) this.callbacks.onTrack?.(stream)
    }
    this.connection.onconnectionstatechange = () => {
      this.callbacks.onStateChange?.(this.connection.connectionState)
    }
    this.connection.ondatachannel = (event) => {
      this.bindChannel(event.channel)
    }
  }

  get connectionState(): RTCPeerConnectionState {
    return this.connection.connectionState
  }

  get dataChannel(): RTCDataChannel | null {
    return this.channel
  }

  async createOffer(stream: MediaStream): Promise<string> {
    for (const track of stream.getTracks()) {
      this.connection.addTrack(track, stream)
    }
    this.limitCodecs()
    this.bindChannel(this.connection.createDataChannel('control', { ordered: true }))

    const offer = await this.connection.createOffer()
    await this.connection.setLocalDescription(offer)
    await waitForIceGathering(this.connection)
    const sdp = this.connection.localDescription?.sdp
    if (!sdp) throw new Error('The browser did not produce a local offer.')
    return sdp
  }

  async acceptOffer(offerSdp: string): Promise<string> {
    await this.connection.setRemoteDescription({ type: 'offer', sdp: offerSdp })
    const answer = await this.connection.createAnswer()
    await this.connection.setLocalDescription(answer)
    await waitForIceGathering(this.connection)
    const sdp = this.connection.localDescription?.sdp
    if (!sdp) throw new Error('The browser did not produce a local answer.')
    return sdp
  }

  async acceptAnswer(answerSdp: string): Promise<void> {
    await this.connection.setRemoteDescription({ type: 'answer', sdp: answerSdp })
  }

  send(message: ControlMessage): void {
    if (this.channel?.readyState !== 'open') {
      throw new Error('The control channel is not open yet.')
    }
    this.channel.send(encodeControlMessage(message))
  }

  close(): void {
    this.channel?.close()
    this.channel = null
    this.connection.close()
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel
    this.callbacks.onChannel?.(channel)
  }

  /**
   * Offer every codec Chrome knows by default and the SDP grows past three QR
   * codes. Opus and VP8 are enough for a monitor and keep the offer to two.
   */
  private limitCodecs(): void {
    if (typeof RTCRtpSender.getCapabilities !== 'function') return

    for (const transceiver of this.connection.getTransceivers()) {
      const kind = transceiver.receiver.track.kind
      if (kind !== 'audio' && kind !== 'video') continue
      const capabilities = RTCRtpSender.getCapabilities(kind)
      if (!capabilities) continue
      const allowed = kind === 'audio' ? ['audio/opus'] : ['video/VP8', 'video/rtx']
      const codecs = capabilities.codecs.filter((codec) => allowed.includes(codec.mimeType))
      if (codecs.length > 0) transceiver.setCodecPreferences(codecs)
    }
  }
}
