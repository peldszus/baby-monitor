<script setup lang="ts">
import { useRouter } from 'vue-router'
import { mdiBabyCarriage, mdiCameraOutline, mdiCellphone } from '@mdi/js'

const router = useRouter()

function choose(path: string): void {
  void router.push(path)
}
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

    <div class="roles">
      <v-card variant="flat" color="surface-container" class="role-card">
        <v-card-item>
          <template #prepend>
            <v-icon :icon="mdiCameraOutline" color="primary" />
          </template>
          <v-card-title class="text-subtitle-1">Child device</v-card-title>
          <v-card-subtitle>Sends video and audio. Leave it with your little one.</v-card-subtitle>
        </v-card-item>
        <v-card-actions>
          <v-btn block color="primary" data-testid="role-child" @click="choose('/child')">
            Use as child device
          </v-btn>
        </v-card-actions>
      </v-card>

      <v-card variant="flat" color="surface-container" class="role-card">
        <v-card-item>
          <template #prepend>
            <v-icon :icon="mdiCellphone" color="primary" />
          </template>
          <v-card-title class="text-subtitle-1">Parent device</v-card-title>
          <v-card-subtitle>Receives video and audio. Keep it with you.</v-card-subtitle>
        </v-card-item>
        <v-card-actions>
          <v-btn block color="primary" data-testid="role-parent" @click="choose('/parent')">
            Use as parent device
          </v-btn>
        </v-card-actions>
      </v-card>
    </div>

    <p class="disclaimer">
      Pairing uses a direct, encrypted WebRTC connection on your local network. No account, no cloud
      and no analytics. This app is not a medical device and does not replace supervision.
    </p>
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

.roles {
  display: grid;
  gap: 16px;
}

@media (min-width: 560px) {
  .roles {
    grid-template-columns: 1fr 1fr;
  }
}

.role-card {
  display: flex;
  flex-direction: column;
}

.role-card :deep(.v-card-actions) {
  margin-top: auto;
}

.disclaimer {
  margin: 0;
  font-size: 0.75rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface-muted));
}
</style>
