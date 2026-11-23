import { describe, expect, it } from 'vitest'
import { HeartbeatMonitor, HEARTBEAT_TIMEOUT_MS } from './heartbeat'

describe('heartbeat monitor', () => {
  it('stays healthy while pongs keep arriving', () => {
    let now = 0
    const heartbeat = new HeartbeatMonitor(() => now)
    heartbeat.start()

    now = 5000
    heartbeat.markSeen()
    now += HEARTBEAT_TIMEOUT_MS - 1
    expect(heartbeat.isStale()).toBe(false)
  })

  it('turns stale after six seconds without a pong', () => {
    let now = 0
    const heartbeat = new HeartbeatMonitor(() => now)
    heartbeat.start()

    now = HEARTBEAT_TIMEOUT_MS
    expect(heartbeat.isStale()).toBe(true)
  })

  it('does not alarm before monitoring starts or after it stops', () => {
    let now = 0
    const heartbeat = new HeartbeatMonitor(() => now)

    now = HEARTBEAT_TIMEOUT_MS * 2
    expect(heartbeat.isStale()).toBe(false)

    heartbeat.start()
    now += HEARTBEAT_TIMEOUT_MS
    expect(heartbeat.isStale()).toBe(true)

    heartbeat.stop()
    expect(heartbeat.isStale()).toBe(false)
  })
})
