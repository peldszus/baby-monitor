<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiCellphone, mdiQrcodeScan } from '@mdi/js'
import AlarmOverlay from '@/components/AlarmOverlay.vue'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import PairingSteps from '@/components/PairingSteps.vue'
import QrScanner from '@/components/QrScanner.vue'
import SignalQr from '@/components/SignalQr.vue'
import PresentationVideo from '@/components/PresentationVideo.vue'
import TextCodePanel from '@/components/TextCodePanel.vue'
import { usePeerSession } from '@/composables/usePeerSession'
import { BITRATE_OPTIONS, FPS_OPTIONS, RESOLUTION_OPTIONS } from '@/core/media-settings'

const {
  state,
  error,
  pairingProgress,
  remoteStream,
  answerChunks,
  answerExpiresAt,
  shortCode,
  rttMs,
  peerState,
  channelOpen,
  videoSettings,
  audioSettings,
  volume,
  mediaStatus,
  batteryLevel,
  charging,
  screenDark,
  alarmActive,
  alarmMuted,
  reconnecting,
  wakeLockActive,
  wakeLockSupported,
  acceptOffer,
  updateVideoSettings,
  updateAudioSettings,
  setVolume,
  setScreenDark,
  silenceAlarm,
  reset,
} = usePeerSession('parent')

const scannerOpen = ref(false)
const pasteText = ref('')
const answerText = computed(() => answerChunks.value.join('\n'))
const monitoring = computed(() => state.value === 'connected' || state.value === 'degraded')
const answerReady = computed(() => answerChunks.value.length > 0)
const pairingStep = computed(() => {
  if (monitoring.value || channelOpen.value) return 3
  if (answerReady.value) return 2
  return 1
})

const statusLine = computed(() => {
  const status = mediaStatus.value
  if (!status) return 'Waiting for the child status…'
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

const screenLine = computed(() => (screenDark.value ? 'Child screen dark' : 'Child screen on'))

function formatBitrate(bitsPerSecond: number): string {
  if (bitsPerSecond >= 1_000_000) return `${(bitsPerSecond / 1_000_000).toFixed(1)} Mbps`
  return `${Math.round(bitsPerSecond / 1000)} kbps`
}

function setVideoEnabled(value: boolean | null): void {
  if (typeof value === 'boolean') updateVideoSettings({ enabled: value })
}

function setAudioEnabled(value: boolean | null): void {
  if (typeof value === 'boolean') updateAudioSettings({ enabled: value })
}

function setScreenDarkValue(value: boolean | null): void {
  if (typeof value === 'boolean') setScreenDark(value)
}

function setFps(value: unknown): void {
  if (typeof value === 'number') updateVideoSettings({ fps: value })
}

function setScaleDownBy(value: unknown): void {
  if (typeof value === 'number') updateVideoSettings({ scaleDownBy: value })
}

function setMaxBitrate(value: unknown): void {
  if (typeof value === 'number') updateVideoSettings({ maxBitrate: value })
}

function setNoiseSuppression(value: boolean | null): void {
  if (typeof value === 'boolean') updateAudioSettings({ noiseSuppression: value })
}

function setAutoGainControl(value: boolean | null): void {
  if (typeof value === 'boolean') updateAudioSettings({ autoGainControl: value })
}

function setGain(value: number | number[]): void {
  updateAudioSettings({ gain: Array.isArray(value) ? value[0] : value })
}

function setVolumeValue(value: number | number[]): void {
  setVolume(Array.isArray(value) ? value[0] : value)
}

async function submitOffer(): Promise<void> {
  const accepted = await acceptOffer(pasteText.value)
  if (accepted) pasteText.value = ''
}

async function onScanned(text: string): Promise<void> {
  const accepted = await acceptOffer(text)
  if (accepted) scannerOpen.value = false
}

function startOver(): void {
  scannerOpen.value = false
  pasteText.value = ''
  reset()
}
</script>

<template>
  <div class="view" :class="{ pairing: !monitoring }">
    <v-alert v-if="error" type="error" variant="tonal" data-testid="error">{{ error }}</v-alert>

    <PairingSteps v-if="!monitoring" :current="pairingStep" />

    <section
      v-if="state === 'idle' || state === 'lost' || (state === 'pairing' && !answerReady)"
      class="panel intro-panel"
    >
      <div class="panel-heading">
        <v-icon :icon="mdiCellphone" color="primary" />
        <h2>Parent device</h2>
        <v-btn variant="text" size="small" class="heading-action" @click="startOver">
          Start over
        </v-btn>
      </div>
      <p>Scan the child device's code to receive video and audio.</p>
      <v-btn
        color="primary"
        size="large"
        block
        :prepend-icon="mdiQrcodeScan"
        data-testid="scan-offer"
        @click="scannerOpen = true"
      >
        Scan child's code
      </v-btn>
      <TextCodePanel
        v-model="pasteText"
        title="Enter text code instead"
        label="Child pairing code"
        test-id="paste-input"
        action-label="Connect"
        action-test-id="submit-offer"
        :action-disabled="!pasteText.trim()"
        @action="submitOffer"
      />
      <p v-if="pairingProgress" class="progress" data-testid="pairing-progress">
        {{ pairingProgress }}
      </p>
    </section>

    <section v-else-if="!monitoring && answerReady && !channelOpen" class="panel pairing-panel">
      <div class="panel-heading">
        <h2>Show this answer to the child</h2>
        <v-btn variant="text" size="small" class="heading-action" @click="startOver">
          Start over
        </v-btn>
      </div>
      <SignalQr :chunks="answerChunks" label="Parent answer code" :expires-at="answerExpiresAt" />
      <p class="progress">Waiting for the child device to accept the answer…</p>
      <TextCodePanel
        title="Show text code instead"
        label="Parent answer code"
        :model-value="answerText"
        test-id="answer-text"
        readonly
      />
    </section>

    <template v-else-if="monitoring">
      <ConnectionStatus
        :state="state"
        :peer-state="peerState"
        :rtt-ms="rttMs"
        :reconnecting="reconnecting"
        :wake-lock-active="wakeLockActive"
        :wake-lock-supported="wakeLockSupported"
      />
      <PresentationVideo
        :stream="remoteStream"
        :volume="volume"
        :muted="!audioSettings.enabled"
        :warning="state === 'degraded'"
        test-id="remote-video"
      />

      <section class="panel status-panel">
        <div class="status-heading">
          <h2>Live status</h2>
          <v-chip v-if="batteryLine" size="small" variant="tonal">{{ batteryLine }}</v-chip>
        </div>
        <p data-testid="media-status">{{ statusLine }}</p>
        <p data-testid="audio-status">{{ audioLine }}</p>
        <p data-testid="screen-status">{{ screenLine }}</p>
      </section>

      <section class="panel controls-panel">
        <h2>Camera and sound</h2>
        <v-switch
          :model-value="videoSettings.enabled"
          label="Video"
          color="primary"
          hide-details
          data-testid="video-toggle"
          @update:model-value="setVideoEnabled"
        />
        <v-switch
          :model-value="audioSettings.enabled"
          label="Audio"
          color="primary"
          hide-details
          data-testid="audio-toggle"
          @update:model-value="setAudioEnabled"
        />

        <v-switch
          :model-value="audioSettings.noiseSuppression"
          label="Noise suppression"
          color="primary"
          hide-details
          data-testid="noise-toggle"
          @update:model-value="setNoiseSuppression"
        />
        <v-switch
          :model-value="audioSettings.autoGainControl"
          label="Automatic gain"
          color="primary"
          hide-details
          data-testid="auto-gain-toggle"
          @update:model-value="setAutoGainControl"
        />
        <v-switch
          :model-value="screenDark"
          label="Child screen dark"
          color="primary"
          hide-details
          data-testid="screen-dark-toggle"
          @update:model-value="setScreenDarkValue"
        />
        <p class="progress">The child can double-tap its screen to wake it.</p>

        <div class="control-row">
          <span>Frame rate</span>
          <v-btn-toggle
            :model-value="videoSettings.fps"
            mandatory
            density="comfortable"
            variant="tonal"
            @update:model-value="setFps"
          >
            <v-btn
              v-for="fps in FPS_OPTIONS"
              :key="fps"
              :value="fps"
              size="small"
              :data-testid="`fps-${fps}`"
            >
              {{ fps }}
            </v-btn>
          </v-btn-toggle>
        </div>

        <div class="control-row">
          <span>Resolution</span>
          <v-btn-toggle
            :model-value="videoSettings.scaleDownBy"
            mandatory
            density="comfortable"
            variant="tonal"
            @update:model-value="setScaleDownBy"
          >
            <v-btn
              v-for="option in RESOLUTION_OPTIONS"
              :key="option.value"
              :value="option.value"
              size="small"
              :data-testid="`resolution-${option.value}`"
            >
              {{ option.title }}
            </v-btn>
          </v-btn-toggle>
        </div>

        <div class="control-row">
          <span>Bitrate</span>
          <v-btn-toggle
            :model-value="videoSettings.maxBitrate"
            mandatory
            density="comfortable"
            variant="tonal"
            @update:model-value="setMaxBitrate"
          >
            <v-btn
              v-for="option in BITRATE_OPTIONS"
              :key="option.value"
              :value="option.value"
              size="small"
              :data-testid="`bitrate-${option.value}`"
            >
              {{ option.title }}
            </v-btn>
          </v-btn-toggle>
        </div>

        <div class="control-row">
          <span>Mic gain {{ audioSettings.gain.toFixed(1) }}</span>
          <v-slider
            :model-value="audioSettings.gain"
            :min="0"
            :max="4"
            :step="0.1"
            color="primary"
            hide-details
            data-testid="gain-slider"
            @update:model-value="setGain"
          />
        </div>

        <div class="control-row">
          <span>Volume {{ Math.round(volume * 100) }}%</span>
          <v-slider
            :model-value="volume"
            :min="0"
            :max="1"
            :step="0.05"
            color="primary"
            hide-details
            data-testid="volume-slider"
            @update:model-value="setVolumeValue"
          />
        </div>
        <p class="progress">Actual values come from the child device.</p>
      </section>
      <section v-if="shortCode" class="panel short-code-panel">
        <p>Compare this code on both devices:</p>
        <div class="short-code" data-testid="short-code">{{ shortCode }}</div>
      </section>
      <v-btn variant="text" block @click="startOver">Stop monitoring</v-btn>
    </template>

    <section v-else-if="channelOpen" class="panel connecting-panel">
      <v-progress-circular indeterminate color="primary" size="44" />
      <h2>Connecting…</h2>
      <p data-testid="pairing-progress">
        {{ pairingProgress ?? 'Setting up the encrypted connection…' }}
      </p>
      <v-btn variant="text" size="small" @click="startOver">Cancel</v-btn>
    </section>

    <p class="disclaimer">This app is not a medical device and does not replace supervision.</p>

    <QrScanner v-model="scannerOpen" :progress="pairingProgress" @decoded="onScanned" />
    <AlarmOverlay
      :active="alarmActive"
      :muted="alarmMuted"
      :reconnecting="reconnecting"
      @silence="silenceAlarm"
      @stop="startOver"
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

.control-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.control-row > span {
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-muted));
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
