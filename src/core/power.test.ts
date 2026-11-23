import { describe, expect, it } from 'vitest'
import { ScreenWakeLock, type WakeLockSentinelLike } from './power'

class FakeSentinel implements WakeLockSentinelLike {
  released = false
  private listener: (() => void) | null = null

  async release(): Promise<void> {
    this.released = true
    this.listener?.()
  }

  addEventListener(_type: 'release', listener: () => void): void {
    this.listener = listener
  }
}

class FakeVisibility {
  visibilityState: DocumentVisibilityState = 'visible'
  private listeners: Array<() => void> = []

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.push(listener)
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners = this.listeners.filter((entry) => entry !== listener)
  }

  set(state: DocumentVisibilityState): void {
    this.visibilityState = state
    for (const listener of this.listeners) listener()
  }
}

function createTarget() {
  const sentinels: FakeSentinel[] = []
  const target = {
    wakeLock: {
      request: async (): Promise<FakeSentinel> => {
        const sentinel = new FakeSentinel()
        sentinels.push(sentinel)
        return sentinel
      },
    },
  }
  return { target, sentinels }
}

describe('screen wake lock', () => {
  it('requests a lock when visible and releases it', async () => {
    const { target, sentinels } = createTarget()
    const changes: boolean[] = []
    const wakeLock = new ScreenWakeLock(
      target,
      {
        visibilityState: 'visible',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
      (active) => changes.push(active)
    )

    expect(await wakeLock.acquire()).toBe(true)
    expect(sentinels).toHaveLength(1)
    expect(wakeLock.active).toBe(true)
    await wakeLock.release()
    expect(sentinels[0].released).toBe(true)
    expect(changes).toEqual([true, false])
  })

  it('re-requests the lock after the page becomes visible again', async () => {
    const { target, sentinels } = createTarget()
    const visibility = new FakeVisibility()
    const wakeLock = new ScreenWakeLock(target, visibility)
    await wakeLock.acquire()
    expect(sentinels).toHaveLength(1)

    visibility.set('hidden')
    expect(wakeLock.active).toBe(false)
    visibility.set('visible')
    await Promise.resolve()
    expect(sentinels).toHaveLength(2)
  })

  it('does nothing when the API is unavailable or the page is hidden', async () => {
    const hidden = new ScreenWakeLock(
      {},
      {
        visibilityState: 'hidden',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }
    )
    expect(await hidden.acquire()).toBe(false)

    const unsupported = new ScreenWakeLock(
      {},
      {
        visibilityState: 'visible',
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      }
    )
    expect(unsupported.supported).toBe(false)
    expect(await unsupported.acquire()).toBe(false)
  })
})
