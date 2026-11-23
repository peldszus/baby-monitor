<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  mdiAlertCircleOutline,
  mdiPictureInPictureBottomRight,
  mdiRestore,
  mdiRotateLeft,
  mdiRotateRight,
} from '@mdi/js'
import {
  clampPresentation,
  clampZoom,
  DEFAULT_PRESENTATION,
  isTransformed,
  MAX_ZOOM,
  MIN_ZOOM,
  panPixels,
  rotateBy,
  rotatedSize,
  type PresentationState,
} from '@/core/presentation'

const props = defineProps<{
  stream: MediaStream | null
  muted?: boolean
  volume?: number
  warning?: boolean
  testId?: string
}>()

const video = ref<HTMLVideoElement | null>(null)
const canvas = ref<HTMLCanvasElement | null>(null)
const pipVideo = ref<HTMLVideoElement | null>(null)
const stage = ref<HTMLDivElement | null>(null)

const presentation = ref<PresentationState>({ ...DEFAULT_PRESENTATION })
const videoSize = ref({ width: 0, height: 0 })
const supportsPip = ref(false)
const pipActive = ref(false)
const pipMode = ref<'standard' | 'canvas' | null>(null)
const pipError = ref<string | null>(null)

const transformed = computed(() => isTransformed(presentation.value))
const zoomLabel = computed(() => `${presentation.value.zoom.toFixed(1)}×`)

let drawFrameId: number | null = null
let canvasStream: MediaStream | null = null
let unmounted = false
let pointerStart: { x: number; y: number; panX: number; panY: number } | null = null
let pinchStart: { distance: number; zoom: number } | null = null
const pointers = new Map<number, { x: number; y: number }>()

function applyPlayback(): void {
  const element = video.value
  if (element) {
    element.muted = pipMode.value === 'canvas' ? true : (props.muted ?? false)
    element.volume = Math.min(1, Math.max(0, props.volume ?? 1))
  }
  const pip = pipVideo.value
  if (pip) {
    pip.muted = props.muted ?? false
    pip.volume = Math.min(1, Math.max(0, props.volume ?? 1))
  }
}

function syncCanvasAudio(): void {
  if (pipMode.value !== 'canvas' || !canvasStream || !props.stream) return
  for (const track of canvasStream.getAudioTracks()) canvasStream.removeTrack(track)
  if (props.muted) return
  const audio = props.stream.getAudioTracks().find((track) => track.readyState === 'live')
  if (audio) canvasStream.addTrack(audio)
}

function updateVideoSize(): void {
  const element = video.value
  if (!element) return
  if (element.videoWidth > 0 && element.videoHeight > 0) {
    videoSize.value = { width: element.videoWidth, height: element.videoHeight }
    resizeCanvas()
  }
}

function resizeCanvas(): void {
  const element = canvas.value
  if (!element) return
  const size = rotatedSize(
    videoSize.value.width,
    videoSize.value.height,
    presentation.value.rotation
  )
  if (size.width === 0 || size.height === 0) return
  if (element.width !== size.width) element.width = size.width
  if (element.height !== size.height) element.height = size.height
}

function drawWarning(ctx: CanvasRenderingContext2D, width: number): void {
  const padding = Math.max(12, Math.round(width * 0.025))
  ctx.fillStyle = 'rgba(179, 38, 30, 0.92)'
  ctx.fillRect(0, 0, width, padding * 3)
  ctx.fillStyle = '#fff'
  ctx.font = `600 ${padding}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Connection unstable', width / 2, padding * 1.5)
  ctx.textAlign = 'start'
  ctx.textBaseline = 'alphabetic'
}

function drawFrame(): void {
  const element = canvas.value
  const source = video.value
  if (!element || !source || videoSize.value.width === 0) return
  resizeCanvas()
  const ctx = element.getContext('2d')
  if (!ctx) return
  const { width, height } = element
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, width, height)
  if (source.readyState >= 2) {
    const panX = panPixels(presentation.value.panX, presentation.value.zoom, width)
    const panY = panPixels(presentation.value.panY, presentation.value.zoom, height)
    ctx.save()
    ctx.translate(width / 2 + panX, height / 2 + panY)
    ctx.rotate((presentation.value.rotation * Math.PI) / 180)
    ctx.scale(presentation.value.zoom, presentation.value.zoom)
    ctx.drawImage(
      source,
      -videoSize.value.width / 2,
      -videoSize.value.height / 2,
      videoSize.value.width,
      videoSize.value.height
    )
    ctx.restore()
  }
  if (props.warning) drawWarning(ctx, width)
}

function stopDrawLoop(): void {
  if (drawFrameId !== null) cancelAnimationFrame(drawFrameId)
  drawFrameId = null
}

function startDrawLoop(): void {
  if (unmounted || drawFrameId !== null) return
  let lastDraw = 0
  const loop = (time: number): void => {
    if (time - lastDraw >= 1000 / 30) {
      drawFrame()
      lastDraw = time
    }
    drawFrameId = requestAnimationFrame(loop)
  }
  drawFrame()
  drawFrameId = requestAnimationFrame(loop)
}

function syncDrawLoop(): void {
  if (unmounted) return
  if (transformed.value) startDrawLoop()
  else {
    stopDrawLoop()
    const element = canvas.value
    const ctx = element?.getContext('2d')
    if (element && ctx) ctx.clearRect(0, 0, element.width, element.height)
  }
}

function attach(): void {
  const element = video.value
  if (!element) return
  if (element.srcObject !== props.stream) element.srcObject = props.stream
  applyPlayback()
  updateVideoSize()
  syncDrawLoop()
  if (props.stream) void element.play().catch(() => undefined)
}

function rotate(steps: number): void {
  presentation.value = clampPresentation({
    ...presentation.value,
    rotation: rotateBy(presentation.value.rotation, steps),
  })
}

function setZoom(value: number | number[]): void {
  const next = Array.isArray(value) ? value[0] : value
  presentation.value = clampPresentation({ ...presentation.value, zoom: next })
}

function resetPresentation(): void {
  presentation.value = { ...DEFAULT_PRESENTATION }
}

function pointerDistance(): number {
  const [first, second] = [...pointers.values()]
  if (!first || !second) return 0
  return Math.hypot(second.x - first.x, second.y - first.y)
}

function onPointerDown(event: PointerEvent): void {
  if (!props.stream) return
  stage.value?.setPointerCapture(event.pointerId)
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size === 1) {
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      panX: presentation.value.panX,
      panY: presentation.value.panY,
    }
    pinchStart = null
  } else if (pointers.size === 2) {
    pointerStart = null
    pinchStart = { distance: pointerDistance(), zoom: presentation.value.zoom }
  }
}

function onPointerMove(event: PointerEvent): void {
  if (!pointers.has(event.pointerId)) return
  pointers.set(event.pointerId, { x: event.clientX, y: event.clientY })
  if (pointers.size >= 2 && pinchStart) {
    const distance = pointerDistance()
    if (pinchStart.distance > 0 && distance > 0) {
      setZoom(pinchStart.zoom * (distance / pinchStart.distance))
    }
    return
  }
  if (!pointerStart) return
  const element = stage.value
  if (!element) return
  const rangeX = Math.max(1, ((presentation.value.zoom - MIN_ZOOM) * element.clientWidth) / 2)
  const rangeY = Math.max(1, ((presentation.value.zoom - MIN_ZOOM) * element.clientHeight) / 2)
  presentation.value = clampPresentation({
    ...presentation.value,
    panX: pointerStart.panX + (event.clientX - pointerStart.x) / rangeX,
    panY: pointerStart.panY + (event.clientY - pointerStart.y) / rangeY,
  })
}

function onPointerUp(event: PointerEvent): void {
  pointers.delete(event.pointerId)
  if (stage.value?.hasPointerCapture(event.pointerId)) {
    stage.value.releasePointerCapture(event.pointerId)
  }
  if (pointers.size < 2) pinchStart = null
  if (pointers.size === 1) {
    const [remaining] = [...pointers.values()]
    pointerStart = remaining
      ? {
          x: remaining.x,
          y: remaining.y,
          panX: presentation.value.panX,
          panY: presentation.value.panY,
        }
      : null
  } else if (pointers.size === 0) {
    pointerStart = null
  }
}

function onWheel(event: WheelEvent): void {
  if (!props.stream) return
  const step = event.deltaY > 0 ? -0.1 : 0.1
  setZoom(clampZoom(presentation.value.zoom + step))
}

function onEnterStandardPip(): void {
  pipMode.value = 'standard'
  pipActive.value = true
  pipError.value = null
}

function onLeaveStandardPip(): void {
  if (pipMode.value !== 'standard') return
  pipMode.value = null
  pipActive.value = false
}

function stopCanvasPip(): void {
  const pip = pipVideo.value
  if (pip) {
    pip.pause()
    pip.srcObject = null
  }
  canvasStream?.getVideoTracks().forEach((track) => track.stop())
  canvasStream = null
  pipMode.value = null
  pipActive.value = false
  applyPlayback()
  syncDrawLoop()
}

async function startCanvasPip(): Promise<void> {
  const element = canvas.value
  const pip = pipVideo.value
  if (!element || !pip || !props.stream) return
  if (typeof element.captureStream !== 'function') {
    throw new Error('Canvas Picture-in-Picture is unavailable in this browser.')
  }
  drawFrame()
  const stream = element.captureStream(30)
  const audio = props.muted
    ? undefined
    : props.stream.getAudioTracks().find((track) => track.readyState === 'live')
  if (audio) stream.addTrack(audio)
  canvasStream = stream
  pip.srcObject = stream
  pipMode.value = 'canvas'
  applyPlayback()
  await pip.play()
  await pip.requestPictureInPicture()
  pipActive.value = true
}

async function startPip(): Promise<void> {
  pipError.value = null
  const element = video.value
  if (!element || !props.stream) return
  if (!supportsPip.value) {
    pipError.value = 'Picture-in-Picture is unavailable in this browser.'
    return
  }
  try {
    if (transformed.value) {
      await startCanvasPip()
    } else {
      await element.requestPictureInPicture()
      onEnterStandardPip()
    }
  } catch (cause) {
    stopCanvasPip()
    pipError.value = cause instanceof Error ? cause.message : 'Could not open Picture-in-Picture.'
  }
}

async function togglePip(): Promise<void> {
  if (pipActive.value) {
    await document.exitPictureInPicture().catch(() => undefined)
    return
  }
  await startPip()
}

watch(() => props.stream, attach)
watch(
  () => props.muted,
  () => {
    applyPlayback()
    syncCanvasAudio()
  }
)
watch(() => props.volume, applyPlayback)
watch(
  () => [
    presentation.value.rotation,
    presentation.value.zoom,
    presentation.value.panX,
    presentation.value.panY,
  ],
  () => {
    resizeCanvas()
    syncDrawLoop()
    if (pipMode.value === 'standard' && transformed.value) {
      pipError.value = 'Picture-in-Picture closed to apply the new view. Start it again.'
      void document.exitPictureInPicture().catch(() => undefined)
    }
    if (pipMode.value === 'canvas' && !transformed.value) {
      pipError.value = 'Picture-in-Picture closed because the view was reset.'
      void document.exitPictureInPicture().catch(() => undefined)
    }
  }
)

onMounted(() => {
  const element = video.value
  supportsPip.value = Boolean(
    document.pictureInPictureEnabled &&
    element &&
    typeof element.requestPictureInPicture === 'function'
  )
  element?.addEventListener('enterpictureinpicture', onEnterStandardPip)
  element?.addEventListener('leavepictureinpicture', onLeaveStandardPip)
  pipVideo.value?.addEventListener('leavepictureinpicture', stopCanvasPip)
  attach()
})

onBeforeUnmount(() => {
  unmounted = true
  stopDrawLoop()
  if (pipActive.value) void document.exitPictureInPicture().catch(() => undefined)
  stopCanvasPip()
  video.value?.removeEventListener('enterpictureinpicture', onEnterStandardPip)
  video.value?.removeEventListener('leavepictureinpicture', onLeaveStandardPip)
  pipVideo.value?.removeEventListener('leavepictureinpicture', stopCanvasPip)
})
</script>

<template>
  <div class="presentation">
    <div
      ref="stage"
      class="stage"
      :data-rotation="presentation.rotation"
      :data-zoom="presentation.zoom.toFixed(2)"
      :data-pan-x="presentation.panX.toFixed(3)"
      :data-pan-y="presentation.panY.toFixed(3)"
      :data-pip="pipActive ? (pipMode ?? 'active') : 'none'"
      data-testid="presentation-stage"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @wheel.prevent="onWheel"
    >
      <video
        ref="video"
        class="video"
        :class="{ hidden: transformed }"
        autoplay
        playsinline
        :muted="muted"
        :data-testid="testId"
        @loadedmetadata="attach"
      />
      <canvas v-show="transformed" ref="canvas" class="canvas" data-testid="presentation-canvas" />
      <video ref="pipVideo" class="pip-source" playsinline />
      <div v-if="!stream" class="placeholder">Waiting for the child video…</div>
      <div
        v-if="warning && !transformed"
        class="warning-overlay"
        data-testid="presentation-warning"
      >
        <v-icon :icon="mdiAlertCircleOutline" size="20" />
        Connection lost
      </div>
    </div>

    <div class="presentation-controls">
      <div class="control-row">
        <v-btn
          variant="text"
          size="small"
          :icon="mdiRotateLeft"
          aria-label="Rotate left"
          data-testid="rotate-left"
          @click="rotate(-1)"
        />
        <v-btn
          variant="text"
          size="small"
          :icon="mdiRotateRight"
          aria-label="Rotate right"
          data-testid="rotate-right"
          @click="rotate(1)"
        />
        <v-btn
          variant="text"
          size="small"
          :icon="mdiRestore"
          aria-label="Reset view"
          data-testid="reset-presentation"
          @click="resetPresentation"
        />
        <span class="zoom-label" data-testid="zoom-label">{{ zoomLabel }}</span>
        <v-btn
          variant="text"
          size="small"
          :icon="mdiPictureInPictureBottomRight"
          :color="pipActive ? 'primary' : undefined"
          :aria-pressed="pipActive"
          aria-label="Picture-in-Picture"
          data-testid="pip-button"
          :disabled="!supportsPip || !stream"
          @click="togglePip"
        />
      </div>
      <v-slider
        :model-value="presentation.zoom"
        :min="MIN_ZOOM"
        :max="MAX_ZOOM"
        :step="0.1"
        color="primary"
        hide-details
        aria-label="Zoom"
        data-testid="zoom-slider"
        @update:model-value="setZoom"
      />
      <p v-if="!supportsPip" class="presentation-hint">
        Picture-in-Picture is unavailable in this browser.
      </p>
      <p v-if="pipError" class="presentation-hint" data-testid="pip-error">{{ pipError }}</p>
    </div>
  </div>
</template>

<style scoped>
.presentation {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.stage {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 180px;
  max-height: 60vh;
  overflow: hidden;
  border-radius: 16px;
  background: #000;
  touch-action: none;
}

.video,
.canvas {
  display: block;
  width: 100%;
  max-height: 60vh;
  object-fit: contain;
}

.video.hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.canvas {
  touch-action: none;
}

.pip-source {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
}

.placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 16px;
  color: rgb(var(--v-theme-on-surface-muted));
  text-align: center;
}

.warning-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  background: rgba(179, 38, 30, 0.92);
  color: #fff;
  font-size: 0.8rem;
  font-weight: 600;
}

.presentation-controls {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.control-row {
  display: flex;
  align-items: center;
  gap: 2px;
}

.zoom-label {
  min-width: 44px;
  margin-left: 4px;
  color: rgb(var(--v-theme-on-surface-muted));
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}

.presentation-hint {
  margin: 0;
  color: rgb(var(--v-theme-on-surface-muted));
  font-size: 0.8rem;
}
</style>
