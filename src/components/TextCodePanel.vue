<script setup lang="ts">
defineProps<{
  title: string
  label: string
  modelValue: string
  testId: string
  readonly?: boolean
  rows?: number
  actionLabel?: string
  actionTestId?: string
  actionDisabled?: boolean
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  action: []
  open: []
}>()

function onSelected(value: { value: boolean }): void {
  if (value.value) emit('open')
}
</script>

<template>
  <v-expansion-panels variant="accordion" flat class="text-code">
    <v-expansion-panel @group:selected="onSelected">
      <v-expansion-panel-title class="text-code-title">{{ title }}</v-expansion-panel-title>
      <v-expansion-panel-text>
        <v-textarea
          :model-value="modelValue"
          :label="label"
          :readonly="readonly"
          :rows="rows ?? 2"
          auto-grow
          density="compact"
          variant="outlined"
          hide-details
          :data-testid="testId"
          @update:model-value="emit('update:modelValue', $event)"
        />
        <v-btn
          v-if="actionLabel"
          color="primary"
          block
          class="text-code-action"
          :disabled="actionDisabled"
          :data-testid="actionTestId"
          @click="emit('action')"
        >
          {{ actionLabel }}
        </v-btn>
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>

<style scoped>
.text-code {
  margin-top: 2px;
}

.text-code :deep(.v-expansion-panel) {
  background: transparent;
}

.text-code :deep(.v-expansion-panel-title) {
  min-height: 28px;
  padding: 0 4px;
  color: rgb(var(--v-theme-on-surface-muted));
  font-size: 0.875rem;
}

.text-code :deep(.v-expansion-panel-text__wrapper) {
  padding: 8px 4px 4px;
}

.text-code-action {
  margin-top: 8px;
}
</style>
