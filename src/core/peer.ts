import { encodeControlMessage, type ControlMessage } from './control'
import { PerfectNegotiator, waitForIceGathering, type NegotiationDescription } from './negotiation'

export { waitForIceGathering }

export type PeerRole = 'child' | 'parent'

export interface PeerCallbacks {
  onTrack?: (stream: MediaStream) => void
  onStateChange?: (state: RTCPeerConnectionState) => void
  onChannel?: (channel: RTCDataChannel) => void
  onNegotiation?: (description: NegotiationDescription) => void
  onNegotiationError?: (cause: unknown) => void
}

export type PeerFactory = (configuration: RTCConfiguration) => RTCPeerConnection

const defaultFactory: PeerFactory = (configuration) => new RTCPeerConnection(configuration)

/**
 * Thin wrapper around one RTCPeerConnection. Pairing creates only a data channel;
 * audio and video are added after that channel is open and negotiated over it.
 * Media and control are both DTLS-SRTP encrypted by the browser. No STUN or TURN
 * servers are configured.
 */
export class PeerSession {
  private readonly connection: RTCPeerConnection
  private readonly callbacks: PeerCallbacks
  private readonly negotiator: PerfectNegotiator
  private channel: RTCDataChannel | null = null

  constructor(
    readonly role: PeerRole,
    callbacks: PeerCallbacks = {},
    factory: PeerFactory = defaultFactory
  ) {
    this.callbacks = callbacks
    this.connection = factory({ iceServers: [] })
    this.negotiator = new PerfectNegotiator(
      this.connection,
      role === 'parent',
      (description) => this.callbacks.onNegotiation?.(description),
      (cause) => this.callbacks.onNegotiationError?.(cause)
    )

    this.connection.ontrack = (event) => {
      const stream = event.streams[0] ?? new MediaStream([event.track])
      this.callbacks.onTrack?.(stream)
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

  async createDataOffer(): Promise<string> {
    this.bindChannel(this.connection.createDataChannel('control', { ordered: true }))
    const offer = await this.connection.createOffer()
    await this.connection.setLocalDescription(offer)
    await waitForIceGathering(this.connection)
    const sdp = this.connection.localDescription?.sdp
    if (!sdp) throw new Error('The browser did not produce a local offer.')
    return sdp
  }

  async acceptDataOffer(offerSdp: string): Promise<string> {
    await this.connection.setRemoteDescription({ type: 'offer', sdp: offerSdp })
    const answer = await this.connection.createAnswer()
    await this.connection.setLocalDescription(answer)
    await waitForIceGathering(this.connection)
    const sdp = this.connection.localDescription?.sdp
    if (!sdp) throw new Error('The browser did not produce a local answer.')
    return sdp
  }

  async acceptDataAnswer(answerSdp: string): Promise<void> {
    await this.connection.setRemoteDescription({ type: 'answer', sdp: answerSdp })
  }

  startMedia(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      this.connection.addTrack(track, stream)
    }
    this.limitCodecs()
    this.negotiator.enable()
  }

  async handleNegotiation(description: NegotiationDescription): Promise<void> {
    await this.negotiator.handle(description)
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
    this.connection.onnegotiationneeded = null
    this.connection.close()
  }

  private bindChannel(channel: RTCDataChannel): void {
    this.channel = channel
    this.callbacks.onChannel?.(channel)
  }

  /**
   * Offer every codec Chrome knows by default and the SDP grows large. Opus and
   * VP8 are enough for a monitor and keep the media offer inside one control message.
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
