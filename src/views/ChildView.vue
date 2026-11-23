<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import { mdiCameraOutline, mdiQrcodeScan } from '@mdi/js'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import QrScanner from '@/components/QrScanner.vue'
import SignalQr from '@/components/SignalQr.vue'
import VideoStream from '@/components/VideoStream.vue'
import { usePeerSession } from '@/composables/usePeerSession'

const {
  state,
  error,
  pairingProgress,
  localStream,
  offerChunks,
  offerExpiresAt,
  shortCode,
  rttMs,
  peerState,
  mediaStatus,
  batteryLevel,
  charging,
  startChild,
  acceptAnswer,
  reset,
} = usePeerSession('child')

const scannerOpen = ref(false)
const pasteText = ref('')
const offerText = computed(() => offerChunks.value.join('\n'))
const pairingVisible = computed(() => state.value === 'pairing' || state.value === 'connecting')
const monitoring = computed(() => state.value === 'connected' || state.value === 'degraded')

const statusLine = computed(() => {
  const status = mediaStatus.value
  if (!status) return 'Waiting for media status…'
  const video = status.videoEnabled ? 'Video on' : 'Video off'
  return `${video} · ${status.width}×${status.height} · ${status.fps} fps · ${formatBitrate(status.bitrate)}`
})

const audioLine = computed(() => {
  const status = mediaStatus.value
  if (!status) return 'Waiting for microphone status…'
  const audio = status.audioEnabled ? 'Mic on' : 'Mic off'
  const processing = `NS ${status.noiseSuppression ? 'on' : 'off'} · AGC ${status.autoGainControl ? 'on' : 'off'}`
  return `${audio} · gain ${status.gain.toFixed(1)} · level ${Math.round(status.audioLevel * 100)}% · ${processing}`
})

const batteryLine = computed(() => {
  if (batteryLevel.value === null) return null
  return `${batteryLevel.value}%${charging.value ? ' charging' : ''}`
})

function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

async function start(): Promise<void> {
  await startChild()
}

async function submitAnswer(): Promise<void> {
  const accepted = await acceptAnswer(pasteText.value)
  if (accepted) pasteText.value = ''
}

async function onScanned(text: string): Promise<void> {
  scannerOpen.value = false
  await nextTick()
  const accepted = await acceptAnswer(text)
  if (accepted) pasteText.value = ''
}

function startOver(): void {
  scannerOpen.value = false
  pasteText.value = ''
  reset()
}
</script>

<template>
  <div class="view">
    <v-alert v-if="error" type="error" variant="tonal" data-testid="error">{{ error }}</v-alert>

    <section v-if="state === 'idle' || state === 'lost'" class="panel">
      <div class="panel-heading">
        <v-icon :icon="mdiCameraOutline" color="primary" />
        <h2>Child device</h2>
      </div>
      <p>This device sends video and audio. Keep it on a charger and pointed at your little one.</p>
      <p>The camera starts after the parent has accepted the pairing code.</p>
      <v-btn color="primary" size="large" block data-testid="start-child" @click="start">
        Create pairing code
      </v-btn>
    </section>

    <template v-else-if="pairingVisible">
      <section class="panel">
        <h2>1. Show this code to the parent</h2>
        <SignalQr :chunks="offerChunks" label="Child pairing code" :expires-at="offerExpiresAt" />
        <v-textarea
          readonly
          :model-value="offerText"
          label="Text code (copy and paste)"
          rows="2"
          auto-grow
          data-testid="offer-text"
        />
      </section>

      <section class="panel">
        <h2>2. Scan the parent's answer</h2>
        <v-btn
          variant="tonal"
          block
          :prepend-icon="mdiQrcodeScan"
          data-testid="scan-answer"
          @click="scannerOpen = true"
        >
          Scan answer QR
        </v-btn>
        <v-textarea
          v-model="pasteText"
          label="Paste the parent answer"
          rows="3"
          auto-grow
          data-testid="paste-input"
        />
        <v-btn
          color="primary"
          block
          :disabled="!pasteText.trim()"
          data-testid="submit-answer"
          @click="submitAnswer"
        >
          Finish pairing
        </v-btn>
        <p v-if="pairingProgress" class="progress" data-testid="pairing-progress">
          {{ pairingProgress }}
        </p>
        <v-btn variant="text" block @click="startOver">Start over</v-btn>
      </section>
    </template>

    <template v-else-if="monitoring">
      <ConnectionStatus :state="state" :peer-state="peerState" :rtt-ms="rttMs" />
      <VideoStream :stream="localStream" muted test-id="local-video" />
      <section class="panel status-panel">
        <div class="status-heading">
          <h2>Live status</h2>
          <v-chip v-if="batteryLine" size="small" variant="tonal">{{ batteryLine }}</v-chip>
        </div>
        <p data-testid="child-media-status">{{ statusLine }}</p>
        <p data-testid="child-audio-status">{{ audioLine }}</p>
        <p class="progress">The parent device controls video and sound.</p>
      </section>
      <section v-if="shortCode" class="panel short-code-panel">
        <p>Compare this code on both devices:</p>
        <div class="short-code" data-testid="short-code">{{ shortCode }}</div>
      </section>
      <v-btn variant="text" block @click="startOver">Stop monitoring</v-btn>
    </template>

    <p class="disclaimer">This app is not a medical device and does not replace supervision.</p>

    <QrScanner
      v-model="scannerOpen"
      :stream="localStream"
      :progress="pairingProgress"
      @decoded="onScanned"
    />
  </div>
</template>

<style scoped>
.view {
  max-width: 560px;
  margin: 0 auto;
  padding: 24px 16px calc(32px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container));
}

.panel-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.panel h2 {
  margin: 0;
  font-size: 1.125rem;
}

.panel p {
  margin: 0;
}

.progress {
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-muted));
}

.status-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.short-code-panel {
  align-items: center;
  text-align: center;
}

.short-code {
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.25em;
  font-variant-numeric: tabular-nums;
}

.disclaimer {
  margin: 0;
  font-size: 0.75rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface-muted));
}
</style>
