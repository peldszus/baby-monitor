export const HEARTBEAT_INTERVAL_MS = 2000
export const HEARTBEAT_TIMEOUT_MS = 6000

export type Clock = () => number

/**
 * Tracks the last heartbeat response. The monitor only starts once monitoring
 * begins, so a slow media negotiation cannot trigger an alarm.
 */
export class HeartbeatMonitor {
  private running = false
  private lastSeen = 0

  constructor(private readonly now: Clock = () => performance.now()) {}

  start(): void {
    this.running = true
    this.lastSeen = this.now()
  }

  markSeen(): void {
    this.lastSeen = this.now()
  }

  stop(): void {
    this.running = false
    this.lastSeen = 0
  }

  isStale(): boolean {
    return this.running && this.now() - this.lastSeen >= HEARTBEAT_TIMEOUT_MS
  }
}
