import { afterEach, describe, expect, it, vi } from 'vitest'
import { WebAudioAlarm } from './alarm'

class FakeParam {
  value = 0
}

class FakeNode {
  type: OscillatorType = 'sine'
  frequency = new FakeParam()
  gain = new FakeParam()
  onended: (() => void) | null = null
  started = false
  stopped = false
  connect = vi.fn()
  disconnect = vi.fn()
  start = vi.fn(() => {
    this.started = true
  })
  stop = vi.fn(() => {
    this.stopped = true
  })
}

class FakeContext {
  state: 'suspended' | 'running' | 'closed' = 'suspended'
  currentTime = 0
  destination = { connect: vi.fn() }
  resume = vi.fn(async () => {
    this.state = 'running'
  })
  close = vi.fn(async () => {
    this.state = 'closed'
  })
  oscillators: FakeNode[] = []
  createOscillator = vi.fn(() => {
    const node = new FakeNode()
    this.oscillators.push(node)
    return node
  })
  createGain = vi.fn(() => new FakeNode())
}

afterEach(() => {
  vi.useRealTimers()
})

describe('web audio alarm', () => {
  it('unlocks audio and plays a short tone', async () => {
    const context = new FakeContext()
    const alarm = new WebAudioAlarm(() => context)
    expect(await alarm.unlock()).toBe(true)
    expect(context.resume).toHaveBeenCalled()
    expect(context.oscillators).toHaveLength(1)
  })

  it('pulses while active and stops cleanly', () => {
    vi.useFakeTimers()
    const context = new FakeContext()
    const alarm = new WebAudioAlarm(() => context, 1000)

    alarm.start()
    expect(context.oscillators).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    expect(context.oscillators).toHaveLength(3)
    alarm.stop()
    expect(context.oscillators.every((oscillator) => oscillator.stopped)).toBe(true)
  })
})
