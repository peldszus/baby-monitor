export type Rotation = 0 | 90 | 180 | 270

export interface PresentationState {
  rotation: Rotation
  zoom: number
  panX: number
  panY: number
}

export const MIN_ZOOM = 1
export const MAX_ZOOM = 4
export const DEFAULT_PRESENTATION: Readonly<PresentationState> = Object.freeze({
  rotation: 0,
  zoom: MIN_ZOOM,
  panX: 0,
  panY: 0,
})

export function rotateBy(rotation: Rotation, steps: number): Rotation {
  const quarterTurns = Math.round(steps)
  const next = (((rotation / 90 + quarterTurns) % 4) + 4) % 4
  return (next * 90) as Rotation
}

export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return MIN_ZOOM
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

export function clampPan(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(-1, value))
}

export function clampPresentation(state: PresentationState): PresentationState {
  const zoom = clampZoom(state.zoom)
  if (zoom === MIN_ZOOM) return { rotation: state.rotation, zoom, panX: 0, panY: 0 }
  return {
    rotation: state.rotation,
    zoom,
    panX: clampPan(state.panX),
    panY: clampPan(state.panY),
  }
}

export function isTransformed(state: PresentationState): boolean {
  return state.rotation !== 0 || state.zoom !== MIN_ZOOM || state.panX !== 0 || state.panY !== 0
}

export function rotatedSize(
  width: number,
  height: number,
  rotation: Rotation
): { width: number; height: number } {
  if (rotation === 90 || rotation === 270) return { width: height, height: width }
  return { width, height }
}

export function panPixels(pan: number, zoom: number, size: number): number {
  return clampPan(pan) * (clampZoom(zoom) - MIN_ZOOM) * (size / 2)
}
