interface AlarmParam {
  value: number
}

interface AlarmConnectable {
  connect(node: AlarmNode): void
}

interface AlarmNode {
  type: OscillatorType
  frequency: AlarmParam
  gain: AlarmParam
  onended: (() => void) | null
  connect(node: AlarmConnectable): void
  disconnect(): void
  start(): void
  stop(when?: number): void
}

interface AlarmContext {
  state: 'suspended' | 'running' | 'closed'
  currentTime: number
  destination: AlarmConnectable
  resume(): Promise<void>
  close(): Promise<void>
  createOscillator(): AlarmNode
  createGain(): AlarmNode
}

type AlarmContextCtor = new () => AlarmContext

function resolveAudioContext(): (() => AlarmContext) | null {
  const global = globalThis as {
    AudioContext?: unknown
    webkitAudioContext?: unknown
  }
  const ctor = (global.AudioContext ?? global.webkitAudioContext ?? null) as AlarmContextCtor | null
  return ctor ? () => new ctor() : null
}

/**
 * Small Web Audio warning tone. Browsers require a user gesture before audio can
 * play, so callers unlock the context silently, then start the tone on failure.
 */
export class WebAudioAlarm {
  private context: AlarmContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private playing = false
  private readonly oscillators = new Set<AlarmNode>()

  constructor(
    private readonly createContext: (() => AlarmContext) | null = resolveAudioContext(),
    private readonly intervalMs = 1200
  ) {}

  async unlock(): Promise<boolean> {
    const context = this.ensureContext()
    if (!context) return false
    try {
      if (context.state === 'suspended') await context.resume()
      return true
    } catch {
      return false
    }
  }

  start(): void {
    if (this.playing) return
    const context = this.ensureContext()
    if (!context) return
    this.playing = true
    this.beep(880, 0.35, 0.22)
    this.timer = setInterval(() => this.beep(880, 0.35, 0.22), this.intervalMs)
  }

  stop(): void {
    this.playing = false
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    for (const oscillator of this.oscillators) {
      try {
        oscillator.stop()
      } catch {
        // The oscillator may already have stopped on its own.
      }
    }
    this.oscillators.clear()
  }

  async dispose(): Promise<void> {
    this.stop()
    const context = this.context
    this.context = null
    if (!context || context.state === 'closed') return
    try {
      await context.close()
    } catch {
      // Closing is best effort; the page may be unloading.
    }
  }

  private ensureContext(): AlarmContext | null {
    if (this.context) return this.context
    if (!this.createContext) return null
    try {
      this.context = this.createContext()
      return this.context
    } catch {
      return null
    }
  }

  private beep(frequency: number, duration: number, volume: number): void {
    const context = this.ensureContext()
    if (!context) return
    if (context.state === 'suspended') void context.resume().catch(() => undefined)
    try {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.type = 'square'
      oscillator.frequency.value = frequency
      gain.gain.value = volume
      oscillator.connect(gain)
      gain.connect(context.destination)
      oscillator.onended = () => {
        this.oscillators.delete(oscillator)
        gain.disconnect()
      }
      oscillator.start()
      oscillator.stop(context.currentTime + duration)
      this.oscillators.add(oscillator)
    } catch {
      // Audio is optional; the visual warning still works.
    }
  }
}
