<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref } from 'vue'
import { mdiCameraOutline, mdiQrcodeScan } from '@mdi/js'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import PairingSteps from '@/components/PairingSteps.vue'
import QrScanner from '@/components/QrScanner.vue'
import SignalQr from '@/components/SignalQr.vue'
import TextCodePanel from '@/components/TextCodePanel.vue'
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
  channelOpen,
  mediaStatus,
  batteryLevel,
  charging,
  screenDark,
  wakeLockActive,
  wakeLockSupported,
  startChild,
  acceptAnswer,
  wakeScreen,
  reset,
} = usePeerSession('child')

const scannerOpen = ref(false)
const pasteText = ref('')
const offerText = computed(() => offerChunks.value.join('\n'))
const offerReady = computed(() => offerChunks.value.length > 0)
const monitoring = computed(() => state.value === 'connected' || state.value === 'degraded')
const pairingStep = computed(() => {
  if (monitoring.value || state.value === 'connecting' || channelOpen.value) return 3
  if (state.value === 'pairing' && offerReady.value) return 2
  return 1
})

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

let wakePressTimer: ReturnType<typeof setTimeout> | null = null

function cancelWakePress(): void {
  if (wakePressTimer) clearTimeout(wakePressTimer)
  wakePressTimer = null
}

function startWakePress(): void {
  cancelWakePress()
  wakePressTimer = setTimeout(() => {
    wakePressTimer = null
    void wakeScreen()
  }, 800)
}

onBeforeUnmount(cancelWakePress)
</script>

<template>
  <div class="view" :class="{ pairing: !monitoring }">
    <div
      v-if="screenDark"
      class="dark-screen"
      data-testid="dark-screen"
      @dblclick="wakeScreen"
      @pointerdown="startWakePress"
      @pointerup="cancelWakePress"
      @pointercancel="cancelWakePress"
      @pointerleave="cancelWakePress"
    >
      <span class="dark-hint">Double-tap to wake</span>
    </div>

    <v-alert v-if="error" type="error" variant="tonal" data-testid="error">{{ error }}</v-alert>

    <PairingSteps v-if="!monitoring" :current="pairingStep" />

    <section v-if="state === 'idle' || state === 'lost'" class="panel intro-panel">
      <div class="panel-heading">
        <v-icon :icon="mdiCameraOutline" color="primary" />
        <h2>Child device</h2>
      </div>
      <p>This device sends video and audio. Keep it charged and pointed at your little one.</p>
      <v-btn color="primary" size="large" block data-testid="start-child" @click="start">
        Generate pairing code
      </v-btn>
    </section>

    <section v-else-if="state === 'pairing' && !offerReady" class="panel connecting-panel">
      <v-progress-circular indeterminate color="primary" size="44" />
      <p data-testid="pairing-progress">Creating pairing code…</p>
    </section>

    <section v-else-if="state === 'pairing' && !channelOpen" class="panel pairing-panel">
      <div class="panel-heading">
        <h2>Show this code to the parent</h2>
        <v-btn variant="text" size="small" class="heading-action" @click="startOver">
          Start over
        </v-btn>
      </div>
      <SignalQr :chunks="offerChunks" label="Child pairing code" :expires-at="offerExpiresAt" />
      <v-btn
        color="primary"
        block
        :prepend-icon="mdiQrcodeScan"
        data-testid="scan-answer"
        @click="scannerOpen = true"
      >
        Scan parent's answer
      </v-btn>
      <TextCodePanel
        title="Show text code instead"
        label="Child pairing code"
        :model-value="offerText"
        test-id="offer-text"
        readonly
      />
      <TextCodePanel
        v-model="pasteText"
        title="Enter answer manually"
        label="Parent answer"
        test-id="paste-input"
        action-label="Finish pairing"
        action-test-id="submit-answer"
        :action-disabled="!pasteText.trim()"
        @action="submitAnswer"
      />
    </section>

    <section
      v-else-if="!monitoring && (state === 'connecting' || channelOpen)"
      class="panel connecting-panel"
    >
      <v-progress-circular indeterminate color="primary" size="44" />
      <h2>Connecting…</h2>
      <p data-testid="pairing-progress">
        {{ pairingProgress ?? 'Setting up the encrypted connection…' }}
      </p>
      <v-btn variant="text" size="small" @click="startOver">Cancel</v-btn>
    </section>

    <template v-else-if="monitoring">
      <ConnectionStatus
        :state="state"
        :peer-state="peerState"
        :rtt-ms="rttMs"
        :wake-lock-active="wakeLockActive"
        :wake-lock-supported="wakeLockSupported"
      />
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

.dark-screen {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding-bottom: calc(24px + env(safe-area-inset-bottom));
  background: #000;
  touch-action: manipulation;
}

.dark-hint {
  color: #444;
  font-size: 0.8rem;
  opacity: 0.45;
  user-select: none;
}

.view.pairing {
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  gap: 8px;
}

.panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 20px;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface-container));
}

.pairing .panel {
  gap: 6px;
  padding: 12px;
}

.panel-heading {
  display: flex;
  align-items: center;
  gap: 8px;
}

.heading-action {
  margin-left: auto;
}

.panel h2 {
  margin: 0;
  font-size: 1.125rem;
}

.pairing .panel h2 {
  font-size: 1rem;
}

.panel p {
  margin: 0;
}

.pairing-panel {
  align-items: stretch;
}

.connecting-panel {
  align-items: center;
  padding: 28px 16px;
  text-align: center;
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

.pairing .disclaimer {
  font-size: 0.65rem;
}
</style>
