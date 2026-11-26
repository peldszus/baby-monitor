<script setup lang="ts">
import type { CameraDevice } from '@/core/camera'

defineProps<{
  devices: CameraDevice[]
  modelValue: string
  disabled?: boolean
  label?: string
  testId?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

function update(value: unknown): void {
  if (typeof value === 'string') emit('update:modelValue', value)
}
</script>

<template>
  <v-select
    :model-value="modelValue"
    :items="devices"
    item-title="label"
    item-value="deviceId"
    :label="label ?? 'Camera'"
    :disabled="disabled"
    variant="outlined"
    density="comfortable"
    hide-details
    :data-testid="testId"
    @update:model-value="update"
  />
</template>
