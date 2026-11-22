<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { createQrScanner } from '@/core/scanner'

const props = defineProps<{
  modelValue: boolean
  /** Reuse an existing camera stream instead of opening a second one. */
  stream?: MediaStream | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  decoded: [text: string]
}>()

const video = ref<HTMLVideoElement | null>(null)
const error = ref<string | null>(null)
const scanning = ref(false)
const captured = ref(false)
const scanner = createQrScanner()
let starting = false
let capturedTimer: ReturnType<typeof setTimeout> | undefined

function onDecoded(text: string): void {
  captured.value = true
  clearTimeout(capturedTimer)
  capturedTimer = setTimeout(() => {
    captured.value = false
  }, 1500)
  emit('decoded', text)
}

async function start(): Promise<void> {
  const element = video.value
  if (!element || starting) return
  starting = true
  error.value = null
  captured.value = false
  try {
    await scanner.start(element, onDecoded, props.stream)
    scanning.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start the camera.'
  } finally {
    starting = false
  }
}

function stop(): void {
  scanning.value = false
  captured.value = false
  clearTimeout(capturedTimer)
  scanner.stop()
}

watch(
  () => props.modelValue,
  async (open) => {
    if (open) {
      await nextTick()
      await start()
    } else {
      stop()
    }
  }
)

watch(video, (element) => {
  if (element && props.modelValue) void start()
})

onBeforeUnmount(stop)
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="520"
    persistent
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title>Scan QR code</v-card-title>
      <v-card-text class="scanner-body">
        <v-alert v-if="error" type="error" variant="tonal">{{ error }}</v-alert>
        <video ref="video" class="scanner-video" muted playsinline />
        <v-progress-linear v-if="!error" indeterminate color="primary" rounded />
        <p class="scanner-hint" data-testid="scanner-status">
          {{
            error
              ? 'Camera unavailable.'
              : captured
                ? 'Code captured. Scan the next code if prompted.'
                : scanning
                  ? 'Scanning for a QR code…'
                  : 'Starting the camera…'
          }}
        </p>
        <p class="scanner-hint">Scanning is automatic. There is no shutter button.</p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="emit('update:modelValue', false)">Cancel</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.scanner-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.scanner-video {
  width: 100%;
  min-height: 240px;
  border-radius: 12px;
  background: #000;
  object-fit: cover;
}

.scanner-hint {
  margin: 0;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
