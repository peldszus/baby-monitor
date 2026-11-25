import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isRearCameraLabel,
  isWideCameraLabel,
  listVideoInputs,
  preferNormalCamera,
  type CameraDevice,
} from './camera'

const devices: CameraDevice[] = [
  { deviceId: 'back-wide', label: 'Back Ultra Wide Camera', wide: true },
  { deviceId: 'back-main', label: 'Back Camera', wide: false },
  { deviceId: 'front', label: 'Front Camera', wide: false },
]

describe('camera selection', () => {
  it('recognises wide-angle and rear camera labels', () => {
    expect(isWideCameraLabel('Back Ultra Wide Camera')).toBe(true)
    expect(isWideCameraLabel('Back Camera')).toBe(false)
    expect(isRearCameraLabel('camera2 0, facing back')).toBe(true)
    expect(isRearCameraLabel('Front Camera')).toBe(false)
  })

  it('keeps a normal current camera', () => {
    expect(preferNormalCamera(devices, 'back-main')).toBe('back-main')
  })

  it('prefers a normal rear camera over a wide-angle current camera', () => {
    expect(preferNormalCamera(devices, 'back-wide')).toBe('back-main')
  })

  it('does not fall back to a front camera when only wide rear cameras exist', () => {
    const rearWide = devices.filter((device) => device.deviceId !== 'back-main')
    expect(preferNormalCamera(rearWide, 'back-wide')).toBe('back-wide')
  })

  it('returns the first normal rear camera when there is no current camera', () => {
    expect(preferNormalCamera(devices)).toBe('back-main')
  })

  it('does not guess when labels are unavailable', () => {
    const unlabeled: CameraDevice[] = [
      { deviceId: 'camera-1', label: 'Camera 1', wide: false },
      { deviceId: 'camera-2', label: 'Camera 2', wide: false },
    ]
    expect(preferNormalCamera(unlabeled)).toBe('')
    expect(preferNormalCamera(unlabeled, 'camera-2')).toBe('camera-2')
  })

  it('prefers the first normal rear camera over a later rear lens', () => {
    const twoRear = [
      { deviceId: 'back-main', label: 'Back Camera', wide: false },
      { deviceId: 'back-tele', label: 'Back Telephoto Camera', wide: false },
    ]
    expect(preferNormalCamera(twoRear, 'back-tele')).toBe('back-main')
  })
})

describe('listVideoInputs', () => {
  const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices')

  beforeEach(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        enumerateDevices: vi.fn(async () => [
          { kind: 'videoinput', deviceId: 'back', label: 'Back Camera', groupId: 'g' },
          { kind: 'audioinput', deviceId: 'mic', label: 'Microphone', groupId: 'g' },
          { kind: 'videoinput', deviceId: 'front', label: '', groupId: 'g' },
        ]),
      },
    })
  })

  afterEach(() => {
    if (originalMediaDevices) {
      Object.defineProperty(navigator, 'mediaDevices', originalMediaDevices)
    } else {
      Reflect.deleteProperty(navigator, 'mediaDevices')
    }
  })

  it('lists only video inputs and supplies fallback labels', async () => {
    await expect(listVideoInputs()).resolves.toEqual([
      { deviceId: 'back', label: 'Back Camera', wide: false },
      { deviceId: 'front', label: 'Camera 2', wide: false },
    ])
  })
})
