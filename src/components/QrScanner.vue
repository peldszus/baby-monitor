<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue'
import CameraSelect from '@/components/CameraSelect.vue'
import { listVideoInputs, preferNormalCamera, type CameraDevice } from '@/core/camera'
import { createQrScanner } from '@/core/scanner'

const props = defineProps<{
  modelValue: boolean
  /** Reuse an existing camera stream instead of opening a second one. */
  stream?: MediaStream | null
  /** Multi-code progress from the pairing session. */
  progress?: string | null
}>()

const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  decoded: [text: string]
}>()

const video = ref<HTMLVideoElement | null>(null)
const error = ref<string | null>(null)
const scanning = ref(false)
const captured = ref(false)
const devices = ref<CameraDevice[]>([])
const selectedDeviceId = ref('')
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

function currentDeviceId(): string {
  const stream = video.value?.srcObject as MediaStream | null
  return stream?.getVideoTracks()[0]?.getSettings().deviceId ?? ''
}

async function startScanner(deviceId?: string, restart = false): Promise<void> {
  const element = video.value
  if (!element || starting || !props.modelValue) return
  starting = true
  if (restart) {
    scanner.stop()
    scanning.value = false
  }
  error.value = null
  captured.value = false
  try {
    await scanner.start(element, onDecoded, props.stream, deviceId)
    if (!props.modelValue) {
      scanner.stop()
      return
    }
    scanning.value = true
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : 'Could not start the camera.'
  } finally {
    starting = false
  }
}

async function openScanner(): Promise<void> {
  const hadSelection = Boolean(selectedDeviceId.value)
  await startScanner(selectedDeviceId.value || undefined)
  if (error.value || !props.modelValue || props.stream) return
  try {
    const list = await listVideoInputs()
    if (!props.modelValue) return
    devices.value = list
    const current = currentDeviceId()
    if (current) selectedDeviceId.value = current
    if (hadSelection) return
    const preferred = preferNormalCamera(list, current)
    if (preferred && preferred !== selectedDeviceId.value) {
      selectedDeviceId.value = preferred
      await startScanner(preferred, true)
    }
  } catch {
    devices.value = []
  }
}

async function selectCamera(deviceId: string): Promise<void> {
  if (!deviceId || deviceId === selectedDeviceId.value) return
  selectedDeviceId.value = deviceId
  await startScanner(deviceId, true)
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
      await openScanner()
    } else {
      stop()
    }
  }
)

watch(video, (element) => {
  if (element && props.modelValue) void openScanner()
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
        <CameraSelect
          v-if="!stream && devices.length > 1"
          :devices="devices"
          :model-value="selectedDeviceId"
          label="Camera"
          test-id="scanner-camera-select"
          @update:model-value="selectCamera"
        />
        <p v-if="!stream && devices.length > 1" class="scanner-hint">
          Choose the normal rear camera if the preview is too wide.
        </p>
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
        <p v-if="progress" class="scanner-hint" data-testid="scanner-progress">{{ progress }}</p>
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
  min-height: 180px;
  max-height: 45dvh;
  border-radius: 12px;
  background: #000;
  object-fit: cover;
}

.scanner-hint {
  margin: 0;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-muted));
}
</style>
