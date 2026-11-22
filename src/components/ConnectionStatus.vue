<script setup lang="ts">
import { computed } from 'vue'
import type { SessionState } from '@/core/state'

const props = defineProps<{
  state: SessionState
  peerState: string
  rttMs: number | null
}>()

const labels: Record<SessionState, string> = {
  idle: 'Idle',
  pairing: 'Waiting for pairing',
  connecting: 'Connecting',
  connected: 'Connected',
  degraded: 'Connection unstable',
  lost: 'Connection lost',
}

const colors: Record<SessionState, string> = {
  idle: 'on-surface-muted',
  pairing: 'info',
  connecting: 'info',
  connected: 'success',
  degraded: 'warning',
  lost: 'error',
}

const label = computed(() => labels[props.state])
const color = computed(() => colors[props.state])
</script>

<template>
  <div class="status-row">
    <v-chip :color="color" variant="tonal" data-testid="connection-state">{{ label }}</v-chip>
    <span class="peer-state">WebRTC: {{ peerState }}</span>
    <v-chip v-if="rttMs !== null" size="small" variant="text" data-testid="rtt">
      {{ rttMs }} ms
    </v-chip>
  </div>
</template>

<style scoped>
.status-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.peer-state {
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-muted));
}
</style>
