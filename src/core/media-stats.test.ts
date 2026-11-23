import { describe, expect, it } from 'vitest'
import { summarizeMediaStats } from './media-stats'

function report(video: Record<string, unknown>, audio: Record<string, unknown> = {}) {
  return new Map([
    ['video', { type: 'outbound-rtp', kind: 'video', ...video }],
    ['audio', { type: 'outbound-rtp', kind: 'audio', ...audio }],
  ]) as unknown as RTCStatsReport
}

const context = {
  videoEnabled: true,
  audioEnabled: true,
  gain: 1.5,
  noiseSuppression: false,
  autoGainControl: false,
  fallbackWidth: 1280,
  fallbackHeight: 720,
}

describe('media stats', () => {
  it('reports actual video dimensions, fps and audio level', () => {
    const result = summarizeMediaStats(
      report(
        {
          framesPerSecond: 14.6,
          frameWidth: 640,
          frameHeight: 360,
          bytesSent: 1000,
          timestamp: 1000,
        },
        { audioLevel: 0.25 }
      ),
      {},
      context
    )
    expect(result.status).toEqual({
      fps: 15,
      width: 640,
      height: 360,
      bitrate: 0,
      audioLevel: 0.25,
      gain: 1.5,
      videoEnabled: true,
      audioEnabled: true,
      noiseSuppression: false,
      autoGainControl: false,
    })
    expect(result.snapshot).toEqual({ videoBytes: 1000, videoTimestamp: 1000 })
  })

  it('calculates bitrate from two samples', () => {
    const first = summarizeMediaStats(report({ bytesSent: 1000, timestamp: 1000 }), {}, context)
    const second = summarizeMediaStats(
      report({ bytesSent: 6000, timestamp: 2000 }),
      first.snapshot,
      context
    )
    expect(second.status.bitrate).toBe(40_000)
  })

  it('uses fallback dimensions when stats have no frame size', () => {
    const result = summarizeMediaStats(report({}), {}, context)
    expect(result.status.width).toBe(1280)
    expect(result.status.height).toBe(720)
    expect(result.status.fps).toBe(0)
  })

  it('drops the previous sample when video stats disappear', () => {
    const result = summarizeMediaStats(
      new Map() as unknown as RTCStatsReport,
      { videoBytes: 1000, videoTimestamp: 1000 },
      { ...context, videoEnabled: false }
    )
    expect(result.snapshot).toEqual({})
    expect(result.status.videoEnabled).toBe(false)
  })
})
