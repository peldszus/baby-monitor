<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { renderSVG } from 'uqr'

const props = defineProps<{
  chunks: string[]
  label: string
  expiresAt: number | null
}>()

const index = ref(0)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | undefined

watch(
  () => props.chunks,
  () => {
    index.value = 0
  }
)

const current = computed(() => props.chunks[index.value] ?? '')
const svg = computed(() =>
  current.value
    ? renderSVG(current.value, {
        ecc: 'L',
        border: 2,
        pixelSize: 5,
        blackColor: '#10181B',
        whiteColor: '#FFFFFF',
      })
    : ''
)
const remaining = computed(() =>
  props.expiresAt === null ? null : Math.max(0, Math.ceil((props.expiresAt - now.value) / 1000))
)

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (timer) clearInterval(timer)
})
</script>

<template>
  <div class="signal-qr">
    <!-- Generated locally from our own pairing payload; no remote markup. -->
    <!-- eslint-disable-next-line vue/no-v-html -->
    <div v-if="svg" class="qr-frame" data-testid="qr-code" v-html="svg" />
    <p class="qr-label">
      {{ label }}
      <span v-if="chunks.length > 1"> — code {{ index + 1 }} of {{ chunks.length }}</span>
    </p>
    <div v-if="chunks.length > 1" class="qr-nav">
      <v-btn
        size="small"
        variant="tonal"
        :disabled="index === 0"
        @click="index = Math.max(0, index - 1)"
      >
        Previous
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        :disabled="index >= chunks.length - 1"
        @click="index = Math.min(chunks.length - 1, index + 1)"
      >
        Next
      </v-btn>
    </div>
    <p v-if="remaining !== null" class="qr-expiry" data-testid="qr-expiry">
      {{ remaining > 0 ? `Valid for ${remaining}s` : 'Expired — start over' }}
    </p>
  </div>
</template>

<style scoped>
.signal-qr {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.qr-frame {
  width: min(100%, 420px);
  padding: 8px;
  border-radius: 12px;
  background: #fff;
}

.qr-frame :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}

.qr-label {
  margin: 0;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-variant));
}

.qr-nav {
  display: flex;
  gap: 8px;
}

.qr-expiry {
  margin: 0;
  font-size: 0.875rem;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
