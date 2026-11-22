<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'

const props = defineProps<{
  stream: MediaStream | null
  muted?: boolean
  testId?: string
}>()

const video = ref<HTMLVideoElement | null>(null)

function attach(): void {
  const element = video.value
  if (!element) return
  if (element.srcObject !== props.stream) element.srcObject = props.stream
  if (props.stream) void element.play().catch(() => undefined)
}

watch(() => props.stream, attach)
onMounted(attach)
</script>

<template>
  <video
    ref="video"
    class="video-stream"
    autoplay
    playsinline
    :muted="muted"
    :data-testid="testId"
    @loadedmetadata="attach"
  />
</template>

<style scoped>
.video-stream {
  display: block;
  width: 100%;
  max-height: 60vh;
  border-radius: 16px;
  background: #000;
  object-fit: contain;
}
</style>
