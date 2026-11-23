<script setup lang="ts">
import { mdiAlertOctagonOutline } from '@mdi/js'

defineProps<{
  active: boolean
  muted: boolean
  reconnecting: boolean
}>()

defineEmits<{
  silence: []
  stop: []
}>()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="active"
      class="alarm-overlay"
      role="alertdialog"
      aria-modal="true"
      aria-live="assertive"
      data-testid="alarm-overlay"
    >
      <v-icon :icon="mdiAlertOctagonOutline" size="64" color="white" />
      <h1>Connection lost</h1>
      <p>Check the child device now.</p>
      <p class="alarm-detail">
        {{ reconnecting ? 'Trying to reconnect…' : 'The connection did not recover. Pair again.' }}
      </p>
      <p v-if="muted" class="alarm-detail" data-testid="alarm-muted">Alarm sound is silenced.</p>
      <div class="alarm-actions">
        <v-btn
          v-if="!muted"
          color="white"
          variant="flat"
          data-testid="alarm-silence"
          @click="$emit('silence')"
        >
          Silence alarm
        </v-btn>
        <v-btn color="white" variant="outlined" data-testid="alarm-stop" @click="$emit('stop')">
          Stop monitoring
        </v-btn>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.alarm-overlay {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 24px calc(24px + env(safe-area-inset-right)) calc(24px + env(safe-area-inset-bottom))
    calc(24px + env(safe-area-inset-left));
  background: #b3261e;
  color: #fff;
  text-align: center;
}

.alarm-overlay h1 {
  margin: 0;
  font-size: 1.75rem;
}

.alarm-overlay p {
  max-width: 32rem;
  margin: 0;
  font-size: 1.05rem;
}

.alarm-detail {
  opacity: 0.85;
}

.alarm-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 8px;
}
</style>
