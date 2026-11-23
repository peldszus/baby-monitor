export interface MediaStatus {
  fps: number
  width: number
  height: number
  bitrate: number
  audioLevel: number
  gain: number
  videoEnabled: boolean
  audioEnabled: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export interface StatsSnapshot {
  videoBytes?: number
  videoTimestamp?: number
}

export interface StatsContext {
  videoEnabled: boolean
  audioEnabled: boolean
  gain: number
  noiseSuppression: boolean
  autoGainControl: boolean
  fallbackWidth?: number
  fallbackHeight?: number
}

interface OutboundStat extends RTCStats {
  kind?: string
  framesPerSecond?: number
  frameWidth?: number
  frameHeight?: number
  bytesSent?: number
  audioLevel?: number
}

/**
 * Turns one getStats() report into the values shown in the UI. The bitrate needs
 * two samples, so callers keep the returned snapshot and pass it back next time.
 */
export function summarizeMediaStats(
  report: RTCStatsReport,
  previous: StatsSnapshot,
  context: StatsContext
): { status: MediaStatus; snapshot: StatsSnapshot } {
  let video: OutboundStat | undefined
  let audio: OutboundStat | undefined

  report.forEach((stat) => {
    const candidate = stat as OutboundStat
    if (candidate.type !== 'outbound-rtp') return
    if (candidate.kind === 'video') video = candidate
    else if (candidate.kind === 'audio') audio = candidate
  })

  const timestamp = video?.timestamp
  const bytes = video?.bytesSent
  const previousTimestamp = previous.videoTimestamp
  const previousBytes = previous.videoBytes
  const bitrate =
    timestamp !== undefined &&
    bytes !== undefined &&
    previousTimestamp !== undefined &&
    previousBytes !== undefined &&
    timestamp > previousTimestamp
      ? Math.max(
          0,
          Math.round(((bytes - previousBytes) * 8 * 1000) / (timestamp - previousTimestamp))
        )
      : 0

  return {
    status: {
      fps: Math.round(video?.framesPerSecond ?? 0),
      width: Math.round(video?.frameWidth ?? context.fallbackWidth ?? 0),
      height: Math.round(video?.frameHeight ?? context.fallbackHeight ?? 0),
      bitrate,
      audioLevel: Math.min(1, Math.max(0, audio?.audioLevel ?? 0)),
      gain: context.gain,
      videoEnabled: context.videoEnabled,
      audioEnabled: context.audioEnabled,
      noiseSuppression: context.noiseSuppression,
      autoGainControl: context.autoGainControl,
    },
    snapshot:
      timestamp !== undefined && bytes !== undefined
        ? { videoBytes: bytes, videoTimestamp: timestamp }
        : {},
  }
}
