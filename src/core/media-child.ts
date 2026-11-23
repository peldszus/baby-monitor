import {
  DEFAULT_AUDIO_SETTINGS,
  DEFAULT_VIDEO_SETTINGS,
  type AudioSettings,
  type VideoSettings,
} from './media-settings'

export interface ChildMediaOptions {
  videoDeviceId?: string
  audioDeviceId?: string
  video?: boolean
  audio?: boolean
}

export function videoConstraints(options: ChildMediaOptions = {}): MediaTrackConstraints {
  return {
    facingMode: { ideal: 'environment' },
    width: { ideal: 1280 },
    height: { ideal: 720 },
    frameRate: { ideal: 15, max: 30 },
    deviceId: options.videoDeviceId ? { exact: options.videoDeviceId } : undefined,
  }
}

export function audioConstraints(options: ChildMediaOptions = {}): MediaTrackConstraints {
  return {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    deviceId: options.audioDeviceId ? { exact: options.audioDeviceId } : undefined,
  }
}

export function stopStream(stream: MediaStream | null): void {
  if (!stream) return
  for (const track of stream.getTracks()) track.stop()
}

export async function openChildMedia(options: ChildMediaOptions = {}): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera and microphone access is not available in this browser.')
  }
  const wantVideo = options.video !== false
  const wantAudio = options.audio !== false
  if (!wantVideo && !wantAudio) throw new Error('No media was requested.')

  return navigator.mediaDevices.getUserMedia({
    audio: wantAudio ? audioConstraints(options) : false,
    video: wantVideo ? videoConstraints(options) : false,
  })
}

/**
 * Owns the child's capture tracks. Turning video or audio off stops the track and
 * returns null so the caller can replace the sender track; turning it on captures a
 * fresh track. The microphone runs through a GainNode when Web Audio is available.
 */
export class ChildMediaController {
  private readonly options: ChildMediaOptions
  private rawVideo: MediaStreamTrack | null = null
  private rawAudio: MediaStreamTrack | null = null
  private processedAudio: MediaStreamTrack | null = null
  private audioContext: AudioContext | null = null
  private audioSource: MediaStreamAudioSourceNode | null = null
  private gainNode: GainNode | null = null
  private audioDestination: MediaStreamAudioDestinationNode | null = null
  private videoSettings: VideoSettings = { ...DEFAULT_VIDEO_SETTINGS }
  private audioSettings: AudioSettings = { ...DEFAULT_AUDIO_SETTINGS }
  private currentStream = new MediaStream()
  private stopped = false

  constructor(options: ChildMediaOptions = {}) {
    this.options = options
  }

  get stream(): MediaStream {
    return this.currentStream
  }

  get videoTrack(): MediaStreamTrack | null {
    return this.rawVideo
  }

  get audioTrack(): MediaStreamTrack | null {
    return this.processedAudio ?? this.rawAudio
  }

  get settings(): { video: VideoSettings; audio: AudioSettings } {
    return { video: { ...this.videoSettings }, audio: { ...this.audioSettings } }
  }

  get videoSize(): { width: number; height: number } {
    const settings = this.rawVideo?.getSettings()
    return { width: settings?.width ?? 0, height: settings?.height ?? 0 }
  }

  async start(): Promise<MediaStream> {
    this.stopped = false
    const stream = await openChildMedia(this.options)
    if (this.stopped) {
      stopStream(stream)
      return this.currentStream
    }
    this.rawVideo = stream.getVideoTracks()[0] ?? null
    this.rawAudio = stream.getAudioTracks()[0] ?? null
    this.videoSettings.enabled = this.rawVideo !== null
    this.audioSettings.enabled = this.rawAudio !== null
    await this.applyVideoConstraints()
    await this.applyAudioConstraints()
    await this.rebuildAudioGraph()
    this.syncStream()
    return this.currentStream
  }

  async setVideoEnabled(enabled: boolean): Promise<MediaStreamTrack | null> {
    if (this.stopped) return null
    if (enabled === this.videoSettings.enabled) return this.rawVideo

    if (!enabled) {
      this.rawVideo?.stop()
      this.rawVideo = null
      this.videoSettings.enabled = false
      this.syncStream()
      return null
    }

    const stream = await openChildMedia({ ...this.options, audio: false })
    const track = stream.getVideoTracks()[0]
    if (!track) throw new Error('The camera did not provide a video track.')
    if (this.stopped) {
      track.stop()
      return null
    }
    this.rawVideo = track
    this.videoSettings.enabled = true
    await this.applyVideoConstraints()
    this.syncStream()
    return track
  }

  async setAudioEnabled(enabled: boolean): Promise<MediaStreamTrack | null> {
    if (this.stopped) return null
    if (enabled === this.audioSettings.enabled) return this.audioTrack

    if (!enabled) {
      this.stopAudioGraph()
      this.rawAudio?.stop()
      this.rawAudio = null
      this.audioSettings.enabled = false
      this.syncStream()
      return null
    }

    const stream = await openChildMedia({ ...this.options, video: false })
    const track = stream.getAudioTracks()[0]
    if (!track) throw new Error('The microphone did not provide an audio track.')
    if (this.stopped) {
      track.stop()
      return null
    }
    this.rawAudio = track
    this.audioSettings.enabled = true
    await this.applyAudioConstraints()
    await this.rebuildAudioGraph()
    this.syncStream()
    return this.audioTrack
  }

  async setVideoSettings(settings: VideoSettings): Promise<void> {
    if (this.stopped) return
    this.videoSettings = { ...settings }
    await this.applyVideoConstraints()
  }

  async setAudioSettings(settings: AudioSettings): Promise<void> {
    if (this.stopped) return
    this.audioSettings = { ...settings }
    await this.applyAudioConstraints()
    if (this.gainNode) this.gainNode.gain.value = settings.gain
  }

  stop(): void {
    this.stopped = true
    this.rawVideo?.stop()
    this.rawAudio?.stop()
    this.rawVideo = null
    this.rawAudio = null
    this.stopAudioGraph()
    this.syncStream()
    if (this.audioContext) {
      void this.audioContext.close().catch(() => undefined)
      this.audioContext = null
      this.audioSource = null
      this.gainNode = null
      this.audioDestination = null
    }
  }

  private async applyVideoConstraints(): Promise<void> {
    if (!this.rawVideo) return
    try {
      await this.rawVideo.applyConstraints({
        frameRate: { ideal: this.videoSettings.fps, max: this.videoSettings.fps },
      })
    } catch {
      // Some cameras reject frame-rate changes; getStats() reports what was applied.
    }
  }

  private async applyAudioConstraints(): Promise<void> {
    if (!this.rawAudio) return
    try {
      await this.rawAudio.applyConstraints({
        noiseSuppression: this.audioSettings.noiseSuppression,
        autoGainControl: this.audioSettings.autoGainControl,
      })
    } catch {
      // Optional processing is best effort.
    }
  }

  private async rebuildAudioGraph(): Promise<void> {
    if (this.stopped) return
    this.audioSource?.disconnect()
    this.audioSource = null
    if (this.processedAudio && this.processedAudio !== this.rawAudio) {
      this.processedAudio.stop()
    }
    this.processedAudio = null
    if (!this.rawAudio) return

    if (typeof globalThis.AudioContext !== 'function') {
      this.processedAudio = this.rawAudio
      return
    }

    try {
      if (!this.audioContext) {
        this.audioContext = new AudioContext()
      }
      const liveDestination =
        this.audioDestination?.stream.getAudioTracks()[0]?.readyState === 'live'
      if (!liveDestination) {
        this.gainNode?.disconnect()
        this.audioDestination = this.audioContext.createMediaStreamDestination()
        this.gainNode = this.audioContext.createGain()
        this.gainNode.connect(this.audioDestination)
      }
      await this.audioContext.resume()
      this.audioSource = this.audioContext.createMediaStreamSource(new MediaStream([this.rawAudio]))
      this.audioSource.connect(this.gainNode!)
      this.gainNode!.gain.value = this.audioSettings.gain
      this.processedAudio = this.audioDestination?.stream.getAudioTracks()[0] ?? this.rawAudio
    } catch {
      this.processedAudio = this.rawAudio
    }
  }

  private stopAudioGraph(): void {
    this.audioSource?.disconnect()
    this.audioSource = null
    if (this.processedAudio && this.processedAudio !== this.rawAudio) {
      this.processedAudio.stop()
    }
    this.processedAudio = null
  }

  private syncStream(): void {
    const tracks: MediaStreamTrack[] = []
    if (this.rawVideo?.readyState === 'live') tracks.push(this.rawVideo)
    const audio = this.audioTrack
    if (audio?.readyState === 'live') tracks.push(audio)
    this.currentStream = new MediaStream(tracks)
  }
}
