export interface NegotiationDescription {
  type: 'offer' | 'answer'
  sdp: string
}

export type NegotiationSender = (description: NegotiationDescription) => void
export type NegotiationErrorHandler = (cause: unknown) => void

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
 * Perfect negotiation for media renegotiation over the data channel. The child
 * initiates the first media offer; the parent is the polite peer if offers ever
 * collide. Both peers keep their transceivers for the lifetime of the connection.
 */
export class PerfectNegotiator {
  private enabled = false
  private makingOffer = false
  private settingRemoteAnswer = false

  constructor(
    private readonly connection: RTCPeerConnection,
    private readonly polite: boolean,
    private readonly send: NegotiationSender,
    private readonly onError: NegotiationErrorHandler
  ) {
    this.connection.onnegotiationneeded = () => {
      if (this.enabled) void this.negotiate()
    }
  }

  enable(): void {
    this.enabled = true
    void this.negotiate()
  }

  async handle(description: NegotiationDescription): Promise<void> {
    const readyForOffer =
      !this.makingOffer && (this.connection.signalingState === 'stable' || this.settingRemoteAnswer)
    const offerCollision = description.type === 'offer' && !readyForOffer
    if (!this.polite && offerCollision) return

    if (offerCollision && this.connection.signalingState === 'have-local-offer') {
      await this.connection.setLocalDescription({ type: 'rollback' })
    }

    this.settingRemoteAnswer = description.type === 'answer'
    try {
      await this.connection.setRemoteDescription(description)
    } finally {
      this.settingRemoteAnswer = false
    }

    if (description.type === 'offer') {
      const answer = await this.connection.createAnswer()
      await this.connection.setLocalDescription(answer)
      await waitForIceGathering(this.connection)
      this.emitLocal()
    }
  }

  private async negotiate(): Promise<void> {
    if (!this.enabled || this.makingOffer) return
    if (this.connection.signalingState !== 'stable') return

    this.makingOffer = true
    try {
      const offer = await this.connection.createOffer()
      await this.connection.setLocalDescription(offer)
      await waitForIceGathering(this.connection)
      this.emitLocal()
    } catch (cause) {
      this.onError(cause)
    } finally {
      this.makingOffer = false
    }
  }

  private emitLocal(): void {
    const local = this.connection.localDescription
    if (!local || (local.type !== 'offer' && local.type !== 'answer')) return
    this.send({ type: local.type, sdp: local.sdp })
  }
}
