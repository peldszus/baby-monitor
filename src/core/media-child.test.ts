import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  audioConstraints,
  ChildMediaController,
  strictVideoConstraints,
  videoConstraints,
} from './media-child'

describe('child media constraints', () => {
  it('asks for the rear camera at 1280x720 and 15 fps', () => {
    const constraints = videoConstraints()
    expect(constraints.facingMode).toEqual({ ideal: 'environment' })
    expect(constraints.width).toEqual({ ideal: 1280 })
    expect(constraints.height).toEqual({ ideal: 720 })
    expect(constraints.aspectRatio).toEqual({ ideal: 16 / 9 })
    expect((constraints as MediaTrackConstraints & { resizeMode?: unknown }).resizeMode).toEqual({
      ideal: 'crop-and-scale',
    })
    expect(constraints.frameRate).toEqual({ ideal: 15, max: 30 })
  })

  it('keeps browser audio processing off unless the parent enables it', () => {
    const constraints = audioConstraints()
    expect(constraints.echoCancellation).toBe(false)
    expect(constraints.noiseSuppression).toBe(false)
    expect(constraints.autoGainControl).toBe(false)
  })

  it('can require an exact 1280x720 16:9 capture', () => {
    const constraints = strictVideoConstraints()
    expect(constraints.width).toEqual({ exact: 1280 })
    expect(constraints.height).toEqual({ exact: 720 })
    expect(constraints.aspectRatio).toEqual({ exact: 16 / 9 })
  })

  it('passes exact device ids when selected', () => {
    const video = videoConstraints({ videoDeviceId: 'camera-1' })
    const audio = audioConstraints({ audioDeviceId: 'mic-1' })
    expect(video.deviceId).toEqual({ exact: 'camera-1' })
    expect(audio.deviceId).toEqual({ exact: 'mic-1' })
  })
})

class FakeTrack {
  readyState = 'live'
  stop = vi.fn(() => {
    this.readyState = 'ended'
  })
  applyConstraints = vi.fn(async () => undefined)

  constructor(
    readonly deviceId: string,
    readonly kind: 'video' | 'audio' = 'video'
  ) {}

  getSettings(): MediaTrackSettings {
    return { deviceId: this.deviceId, width: 1280, height: 720 }
  }
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[] = []) {}
  getTracks(): FakeTrack[] {
    return this.tracks
  }
  getVideoTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'video')
  }
  getAudioTracks(): FakeTrack[] {
    return this.tracks.filter((track) => track.kind === 'audio')
  }
}

describe('child camera switching', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')
  const getUserMedia = vi.fn()

  beforeEach(() => {
    vi.stubGlobal('MediaStream', FakeMediaStream)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    })
    getUserMedia.mockReset()
    getUserMedia.mockImplementation(
      async (constraints: MediaStreamConstraints): Promise<MediaStream> => {
        const video = constraints.video as MediaTrackConstraints
        const exact = video.deviceId as { exact?: string } | undefined
        return new FakeMediaStream([
          new FakeTrack(exact?.exact ?? 'default', 'video'),
          new FakeTrack('mic', 'audio'),
        ]) as unknown as MediaStream
      }
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })

  it('replaces the live video track and asks for 16:9', async () => {
    const controller = new ChildMediaController()
    await controller.start()
    const first = controller.videoTrack as unknown as FakeTrack

    const next = await controller.setVideoDevice('main')

    expect(first.stop).toHaveBeenCalled()
    expect((next as unknown as FakeTrack).deviceId).toBe('main')
    expect(controller.videoTrack).toBe(next)
    expect(controller.stream.getVideoTracks()[0]).toBe(next)
    expect(getUserMedia).toHaveBeenLastCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({
          deviceId: { exact: 'main' },
          aspectRatio: { exact: 16 / 9 },
        }),
        audio: false,
      })
    )
  })

  it('releases the old camera and retries when the phone cannot open both at once', async () => {
    const controller = new ChildMediaController()
    await controller.start()
    const first = controller.videoTrack as unknown as FakeTrack
    getUserMedia
      .mockRejectedValueOnce(new Error('camera busy'))
      .mockResolvedValueOnce(
        new FakeMediaStream([new FakeTrack('main', 'video')]) as unknown as MediaStream
      )

    const next = await controller.setVideoDevice('main')

    expect(first.stop).toHaveBeenCalled()
    expect((next as unknown as FakeTrack).deviceId).toBe('main')
    expect(controller.videoTrack).toBe(next)
  })
})
