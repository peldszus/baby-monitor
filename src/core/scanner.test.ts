import { describe, expect, it } from 'vitest'
import { scannerVideoConstraints } from './scanner'

describe('scanner camera constraints', () => {
  it('asks for the rear camera at 1280x720 and 16:9 by default', () => {
    const constraints = scannerVideoConstraints()
    expect(constraints.facingMode).toEqual({ ideal: 'environment' })
    expect(constraints.width).toEqual({ ideal: 1280 })
    expect(constraints.height).toEqual({ ideal: 720 })
    expect(constraints.aspectRatio).toEqual({ ideal: 16 / 9 })
    expect(constraints.deviceId).toBeUndefined()
  })

  it('uses an exact device when one is selected', () => {
    const constraints = scannerVideoConstraints('camera-1')
    expect(constraints.deviceId).toEqual({ exact: 'camera-1' })
    expect(constraints.facingMode).toBeUndefined()
  })
})
