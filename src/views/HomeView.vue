<script setup lang="ts">
import { mdiBabyCarriage, mdiVideoOffOutline } from '@mdi/js'
</script>

<template>
  <div class="home">
    <section class="hero">
      <div class="hero-icon">
        <v-icon :icon="mdiBabyCarriage" size="48" color="primary" />
      </div>
      <h1 class="text-h5">Baby Monitor</h1>
      <p class="text-body-1 text-medium-emphasis">
        A calm, private place to keep an eye and an ear on your little one.
      </p>
    </section>

    <v-card variant="flat" color="surface-container" class="empty-state">
      <v-card-item>
        <template #prepend>
          <v-icon :icon="mdiVideoOffOutline" color="on-surface-variant" />
        </template>
        <v-card-title class="text-subtitle-1">No monitor paired</v-card-title>
        <v-card-subtitle>Camera and audio monitoring will appear here.</v-card-subtitle>
      </v-card-item>
    </v-card>
  </div>
</template>

<style scoped>
.home {
  max-width: 640px;
  margin: 0 auto;
  padding: 32px 16px calc(32px + env(safe-area-inset-bottom));
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.hero {
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.hero-icon {
  display: grid;
  place-items: center;
  width: 96px;
  height: 96px;
  margin-bottom: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-primary-container));
}

.hero p {
  max-width: 36ch;
}
</style>
