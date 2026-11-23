export interface WakeLockSentinelLike {
  released: boolean
  release(): Promise<void>
  addEventListener(type: 'release', listener: () => void): void
}

interface WakeLockTarget {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>
  }
}

interface VisibilityTarget {
  visibilityState: DocumentVisibilityState
  addEventListener(type: 'visibilitychange', listener: () => void): void
  removeEventListener(type: 'visibilitychange', listener: () => void): void
}

export class ScreenWakeLock {
  private sentinel: WakeLockSentinelLike | null = null
  private wanted = false
  private listening = false
  private lastActive = false

  constructor(
    private readonly target: WakeLockTarget = globalThis.navigator as unknown as WakeLockTarget,
    private readonly visibility: VisibilityTarget = document,
    private readonly onChange: (active: boolean) => void = () => undefined
  ) {}

  get supported(): boolean {
    return typeof this.target.wakeLock?.request === 'function'
  }

  get active(): boolean {
    return this.sentinel !== null
  }

  async acquire(): Promise<boolean> {
    this.wanted = true
    this.listen()
    return this.request()
  }

  async dispose(): Promise<void> {
    await this.release()
    if (this.listening) {
      this.visibility.removeEventListener('visibilitychange', this.onVisibilityChange)
      this.listening = false
    }
  }

  async release(): Promise<void> {
    this.wanted = false
    const sentinel = this.sentinel
    this.sentinel = null
    this.notify(false)
    if (sentinel && !sentinel.released) {
      try {
        await sentinel.release()
      } catch {
        // The browser may already have released it when the page was hidden.
      }
    }
  }

  private async request(): Promise<boolean> {
    if (!this.supported || this.visibility.visibilityState !== 'visible') return false
    if (this.sentinel) return true
    try {
      const sentinel = await this.target.wakeLock!.request('screen')
      this.sentinel = sentinel
      sentinel.addEventListener('release', () => {
        if (this.sentinel === sentinel) this.sentinel = null
        this.notify(false)
      })
      this.notify(true)
      return true
    } catch {
      this.notify(false)
      return false
    }
  }

  private listen(): void {
    if (this.listening) return
    this.listening = true
    this.visibility.addEventListener('visibilitychange', this.onVisibilityChange)
  }

  private readonly onVisibilityChange = (): void => {
    if (!this.wanted) return
    if (this.visibility.visibilityState === 'visible') {
      void this.request()
    } else {
      this.sentinel = null
      this.notify(false)
    }
  }

  private notify(active: boolean): void {
    if (this.lastActive === active) return
    this.lastActive = active
    this.onChange(active)
  }
}

export async function enterAppFullscreen(): Promise<boolean> {
  if (document.fullscreenElement) return true
  try {
    await document.documentElement.requestFullscreen()
    return true
  } catch {
    return false
  }
}

export async function exitAppFullscreen(): Promise<void> {
  if (!document.fullscreenElement) return
  try {
    await document.exitFullscreen()
  } catch {
    // Fullscreen may already have been left by the system.
  }
}
