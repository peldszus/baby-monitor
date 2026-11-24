import { describe, expect, it } from 'vitest'
import {
  clampPan,
  clampPresentation,
  clampZoom,
  DEFAULT_PRESENTATION,
  isTransformed,
  MAX_ZOOM,
  MIN_ZOOM,
  panPixels,
  rotateBy,
  rotatedSize,
} from './presentation'

describe('presentation transforms', () => {
  it('rotates in quarter turns and wraps in both directions', () => {
    expect(rotateBy(0, 1)).toBe(90)
    expect(rotateBy(90, 1)).toBe(180)
    expect(rotateBy(270, 1)).toBe(0)
    expect(rotateBy(0, -1)).toBe(270)
    expect(rotateBy(180, -3)).toBe(270)
  })

  it('clamps zoom and pan', () => {
    expect(clampZoom(0.5)).toBe(MIN_ZOOM)
    expect(clampZoom(8)).toBe(MAX_ZOOM)
    expect(clampZoom(Number.NaN)).toBe(MIN_ZOOM)
    expect(clampPan(-2)).toBe(-1)
    expect(clampPan(2)).toBe(1)
    expect(clampPan(Number.POSITIVE_INFINITY)).toBe(0)
  })

  it('resets pan when zoom returns to one', () => {
    expect(clampPresentation({ rotation: 90, zoom: 1, panX: 0.7, panY: -0.4 })).toEqual({
      rotation: 90,
      zoom: 1,
      panX: 0,
      panY: 0,
    })
  })

  it('detects identity and transformed states', () => {
    expect(isTransformed(DEFAULT_PRESENTATION)).toBe(false)
    expect(isTransformed({ ...DEFAULT_PRESENTATION, rotation: 90 })).toBe(true)
    expect(isTransformed({ ...DEFAULT_PRESENTATION, zoom: 1.2 })).toBe(true)
    expect(isTransformed({ ...DEFAULT_PRESENTATION, panX: 0.1 })).toBe(true)
  })

  it('swaps dimensions for quarter turns', () => {
    expect(rotatedSize(1280, 720, 0)).toEqual({ width: 1280, height: 720 })
    expect(rotatedSize(1280, 720, 90)).toEqual({ width: 720, height: 1280 })
    expect(rotatedSize(1280, 720, 180)).toEqual({ width: 1280, height: 720 })
    expect(rotatedSize(1280, 720, 270)).toEqual({ width: 720, height: 1280 })
  })

  it('converts normalized pan to pixels at the current zoom', () => {
    expect(panPixels(0, 2, 1000)).toBe(0)
    expect(panPixels(1, 2, 1000)).toBe(500)
    expect(panPixels(-1, 3, 1000)).toBe(-1000)
    expect(panPixels(2, 2, 1000)).toBe(500)
  })
})
