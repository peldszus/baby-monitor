import { encodeControlMessage, type ControlMessage } from './control'
import { summarizeMediaStats, type MediaStatus, type StatsSnapshot } from './media-stats'
import type { VideoSettings } from './media-settings'
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
  private videoSender: RTCRtpSender | null = null
  private audioSender: RTCRtpSender | null = null
  private statsSnapshot: StatsSnapshot = {}

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

  restartIce(): void {
    if (this.connection.connectionState === 'closed') return
    if (typeof this.connection.restartIce !== 'function') return
    this.connection.restartIce()
  }

  startMedia(stream: MediaStream): void {
    for (const track of stream.getTracks()) {
      const sender = this.connection.addTrack(track, stream)
      if (track.kind === 'video') this.videoSender = sender
      else if (track.kind === 'audio') this.audioSender = sender
    }
    this.limitCodecs()
    this.negotiator.enable()
  }

  async replaceVideoTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrack('video', track)
  }

  async replaceAudioTrack(track: MediaStreamTrack | null): Promise<void> {
    await this.replaceTrack('audio', track)
  }

  async applyVideoParameters(settings: VideoSettings): Promise<void> {
    const sender = this.videoSender
    if (!sender) return
    const parameters = sender.getParameters()
    if (!parameters.encodings || parameters.encodings.length === 0) {
      parameters.encodings = [{}]
    }
    parameters.encodings[0].maxFramerate = settings.fps
    parameters.encodings[0].scaleResolutionDownBy = settings.scaleDownBy
    parameters.encodings[0].maxBitrate = settings.maxBitrate
    parameters.degradationPreference = 'balanced'
    try {
      await sender.setParameters(parameters)
    } catch {
      // Older browsers may reject individual parameters. The track constraints
      // still apply the frame rate, and status reports what actually took effect.
    }
  }

  async getMediaStats(context: {
    videoEnabled: boolean
    audioEnabled: boolean
    gain: number
    noiseSuppression: boolean
    autoGainControl: boolean
    fallbackWidth?: number
    fallbackHeight?: number
  }): Promise<MediaStatus> {
    const report = await this.connection.getStats()
    const result = summarizeMediaStats(report, this.statsSnapshot, context)
    this.statsSnapshot = result.snapshot
    return result.status
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
    this.videoSender = null
    this.audioSender = null
    this.statsSnapshot = {}
    this.connection.onnegotiationneeded = null
    this.connection.close()
  }

  private async replaceTrack(
    kind: 'video' | 'audio',
    track: MediaStreamTrack | null
  ): Promise<void> {
    let sender = kind === 'video' ? this.videoSender : this.audioSender
    if (!sender) {
      if (!track) return
      sender = this.connection.addTrack(track, new MediaStream([track]))
      if (kind === 'video') this.videoSender = sender
      else this.audioSender = sender
      return
    }
    await sender.replaceTrack(track)
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
