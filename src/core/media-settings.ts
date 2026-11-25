export interface VideoSettings {
  enabled: boolean
  fps: number
  scaleDownBy: number
  maxBitrate: number
}

export interface AudioSettings {
  enabled: boolean
  gain: number
  noiseSuppression: boolean
  autoGainControl: boolean
}

export const VIDEO_LIMITS = {
  fpsMin: 1,
  fpsMax: 30,
  scaleDownByMin: 1,
  scaleDownByMax: 8,
  bitrateMin: 50_000,
  bitrateMax: 8_000_000,
} as const

// Linear amplitude. The child applies a peak limiter after this gain stage so
// high settings boost quiet sounds without hard clipping loud ones.
export const AUDIO_LIMITS = {
  gainMin: 0,
  gainMax: 10,
} as const

export const DEFAULT_VIDEO_SETTINGS: VideoSettings = {
  enabled: true,
  fps: 15,
  scaleDownBy: 1,
  maxBitrate: 1_000_000,
}

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: true,
  gain: 1,
  noiseSuppression: false,
  autoGainControl: false,
}

export const FPS_OPTIONS = [5, 10, 15, 20, 30] as const

export const RESOLUTION_OPTIONS = [
  { title: 'Full', value: 1 },
  { title: '1/2', value: 2 },
  { title: '1/3', value: 3 },
  { title: '1/4', value: 4 },
] as const

export const BITRATE_OPTIONS = [
  { title: '250 kbps', value: 250_000 },
  { title: '500 kbps', value: 500_000 },
  { title: '1 Mbps', value: 1_000_000 },
  { title: '2 Mbps', value: 2_000_000 },
] as const
