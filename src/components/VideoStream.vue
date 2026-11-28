<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{
  stream: MediaStream | null
  muted?: boolean
  volume?: number
  testId?: string
}>()

const video = ref<HTMLVideoElement | null>(null)

function applyPlayback(): void {
  const element = video.value
  if (!element) return
  element.muted = props.muted ?? false
  element.volume = Math.min(1, Math.max(0, props.volume ?? 1))
}

function attach(): void {
  const element = video.value
  if (!element) return
  if (element.srcObject !== props.stream) element.srcObject = props.stream
  applyPlayback()
  if (props.stream) void element.play().catch(() => undefined)
}

watch(() => props.stream, attach)
watch(() => [props.muted, props.volume], applyPlayback)
onMounted(attach)
</script>

<template>
  <div class="video-stage">
    <video
      ref="video"
      class="video-stream"
      autoplay
      playsinline
      :muted="muted"
      :data-testid="testId"
      @loadedmetadata="attach"
    />
  </div>
</template>

<style scoped>
.video-stage {
  width: fit-content;
  max-width: 100%;
  margin: 0 auto;
  overflow: hidden;
  border-radius: 16px;
  background: transparent;
}

.video-stream {
  display: block;
  width: auto;
  height: auto;
  max-width: 100%;
  max-height: 60vh;
  background: transparent;
  object-fit: contain;
}
</style>
