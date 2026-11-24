<script setup lang="ts">
import { mdiCheck } from '@mdi/js'

const props = defineProps<{
  current: number
  complete?: boolean
}>()

const steps = ['Child code', 'Parent code', 'Connect']

function isDone(index: number): boolean {
  return Boolean(props.complete) || index < props.current - 1
}

function isCurrent(index: number): boolean {
  return !props.complete && index === props.current - 1
}
</script>

<template>
  <ol class="steps" data-testid="pairing-steps" :data-step="complete ? 'done' : current">
    <li
      v-for="(step, index) in steps"
      :key="step"
      class="step"
      :class="{ done: isDone(index), current: isCurrent(index) }"
      :data-testid="`step-${index + 1}`"
      :aria-current="isCurrent(index) ? 'step' : undefined"
    >
      <span class="node">
        <v-icon v-if="isDone(index)" :icon="mdiCheck" size="14" />
        <span v-else>{{ index + 1 }}</span>
      </span>
      <span class="label">{{ step }}</span>
    </li>
  </ol>
</template>

<style scoped>
.steps {
  position: relative;
  display: flex;
  margin: 0 0 8px;
  padding: 0;
  list-style: none;
}

.steps::before {
  position: absolute;
  top: 14px;
  right: 16%;
  left: 16%;
  height: 2px;
  background: rgb(var(--v-theme-outline-variant));
  content: '';
}

.step {
  position: relative;
  z-index: 1;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

.node {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border: 2px solid rgb(var(--v-theme-outline-variant));
  border-radius: 50%;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface-muted));
  font-size: 0.75rem;
  font-weight: 600;
}

.step.done .node {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.step.current .node {
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 4px rgba(var(--v-theme-primary), 0.12);
}

.label {
  color: rgb(var(--v-theme-on-surface-muted));
  font-size: 0.65rem;
  text-align: center;
}

.step.current .label {
  color: rgb(var(--v-theme-primary));
  font-weight: 600;
}
</style>
