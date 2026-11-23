import { describe, expect, it } from 'vitest'
import { audioConstraints, videoConstraints } from './media-child'

describe('child media constraints', () => {
  it('asks for the rear camera at 1280x720 and 15 fps', () => {
    const constraints = videoConstraints()
    expect(constraints.facingMode).toEqual({ ideal: 'environment' })
    expect(constraints.width).toEqual({ ideal: 1280 })
    expect(constraints.height).toEqual({ ideal: 720 })
    expect(constraints.frameRate).toEqual({ ideal: 15, max: 30 })
  })

  it('keeps browser audio processing off unless the parent enables it', () => {
    const constraints = audioConstraints()
    expect(constraints.echoCancellation).toBe(false)
    expect(constraints.noiseSuppression).toBe(false)
    expect(constraints.autoGainControl).toBe(false)
  })

  it('passes exact device ids when selected', () => {
    const video = videoConstraints({ videoDeviceId: 'camera-1' })
    const audio = audioConstraints({ audioDeviceId: 'mic-1' })
    expect(video.deviceId).toEqual({ exact: 'camera-1' })
    expect(audio.deviceId).toEqual({ exact: 'mic-1' })
  })
})
