<script setup lang="ts">
import { computed, ref } from 'vue'
import { mdiCellphone, mdiQrcodeScan } from '@mdi/js'
import ConnectionStatus from '@/components/ConnectionStatus.vue'
import QrScanner from '@/components/QrScanner.vue'
import SignalQr from '@/components/SignalQr.vue'
import VideoStream from '@/components/VideoStream.vue'
import { usePeerSession } from '@/composables/usePeerSession'

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
  acceptOffer,
  sendPing,
  reset,
} = usePeerSession('parent')

const scannerOpen = ref(false)
const pasteText = ref('')
const answerText = computed(() => answerChunks.value.join('\n'))
const pairingVisible = computed(() => state.value === 'pairing' || state.value === 'connecting')
const monitoring = computed(() => state.value === 'connected' || state.value === 'degraded')
const answerReady = computed(() => answerChunks.value.length > 0)

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
  <div class="view">
    <v-alert v-if="error" type="error" variant="tonal" data-testid="error">{{ error }}</v-alert>

    <section v-if="state === 'idle' || state === 'lost'" class="panel">
      <div class="panel-heading">
        <v-icon :icon="mdiCellphone" color="primary" />
        <h2>Parent device</h2>
      </div>
      <p>Scan the child device's code to receive video and audio.</p>
      <v-btn
        variant="tonal"
        block
        :prepend-icon="mdiQrcodeScan"
        data-testid="scan-offer"
        @click="scannerOpen = true"
      >
        Scan child QR
      </v-btn>
      <v-textarea
        v-model="pasteText"
        label="Paste the child code"
        rows="3"
        auto-grow
        data-testid="paste-input"
      />
      <v-btn
        color="primary"
        block
        :disabled="!pasteText.trim()"
        data-testid="submit-offer"
        @click="submitOffer"
      >
        Connect
      </v-btn>
      <p v-if="pairingProgress" class="progress" data-testid="pairing-progress">
        {{ pairingProgress }}
      </p>
    </section>

    <template v-else-if="pairingVisible">
      <section v-if="!answerReady" class="panel">
        <h2>Scan the child's code</h2>
        <v-btn
          variant="tonal"
          block
          :prepend-icon="mdiQrcodeScan"
          data-testid="scan-offer"
          @click="scannerOpen = true"
        >
          Scan child QR
        </v-btn>
        <v-textarea
          v-model="pasteText"
          label="Paste the child code"
          rows="3"
          auto-grow
          data-testid="paste-input"
        />
        <v-btn
          color="primary"
          block
          :disabled="!pasteText.trim()"
          data-testid="submit-offer"
          @click="submitOffer"
        >
          Connect
        </v-btn>
        <p v-if="pairingProgress" class="progress" data-testid="pairing-progress">
          {{ pairingProgress }}
        </p>
      </section>

      <section v-else class="panel">
        <h2>Show this answer to the child</h2>
        <SignalQr :chunks="answerChunks" label="Parent answer code" :expires-at="answerExpiresAt" />
        <v-textarea
          readonly
          :model-value="answerText"
          label="Text code (copy and paste)"
          rows="2"
          auto-grow
          data-testid="answer-text"
        />
        <p class="progress">
          {{
            channelOpen ? 'Connecting media…' : 'Waiting for the child device to accept the answer…'
          }}
        </p>
        <v-btn variant="text" block @click="startOver">Start over</v-btn>
      </section>
    </template>

    <template v-else-if="monitoring">
      <ConnectionStatus :state="state" :peer-state="peerState" :rtt-ms="rttMs" />
      <VideoStream :stream="remoteStream" test-id="remote-video" />
      <section v-if="shortCode" class="panel short-code-panel">
        <p>Compare this code on both devices:</p>
        <div class="short-code" data-testid="short-code">{{ shortCode }}</div>
      </section>
      <v-btn
        variant="tonal"
        block
        :disabled="!channelOpen"
        data-testid="send-ping"
        @click="sendPing"
      >
        Send ping
      </v-btn>
      <v-btn variant="text" block @click="startOver">Stop monitoring</v-btn>
    </template>

    <p class="disclaimer">This app is not a medical device and does not replace supervision.</p>

    <QrScanner v-model="scannerOpen" :progress="pairingProgress" @decoded="onScanned" />
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
