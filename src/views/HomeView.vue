<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { mdiCameraOutline, mdiCellphone, mdiCellphoneArrowDown, mdiShareVariant } from '@mdi/js'
import { useInstallPrompt } from '@/composables/useInstallPrompt'

const router = useRouter()
const { canInstall, isIos, install, dismiss } = useInstallPrompt()
const installing = ref(false)
const iconUrl = `${import.meta.env.BASE_URL}icon.svg`

function choose(path: string): void {
  void router.push(path)
}

async function installApp(): Promise<void> {
  installing.value = true
  try {
    await install()
  } finally {
    installing.value = false
  }
}
</script>

<template>
  <div class="home">
    <section class="hero">
      <img :src="iconUrl" alt="" class="hero-icon" />
      <h1 class="text-h5">Baby Monitor</h1>
      <p class="text-body-1 text-medium-emphasis">
        A calm, private place to keep an eye and an ear on your little one.
      </p>
    </section>

    <v-card
      v-if="canInstall"
      variant="flat"
      color="surface-container-high"
      class="install-card"
      data-testid="install-prompt"
    >
      <v-card-item>
        <template #prepend>
          <v-icon :icon="mdiCellphoneArrowDown" color="primary" />
        </template>
        <v-card-title class="text-subtitle-1">Install Baby Monitor</v-card-title>
        <v-card-subtitle>Full screen and available offline.</v-card-subtitle>
      </v-card-item>
      <v-card-actions>
        <v-btn color="primary" :loading="installing" data-testid="install-app" @click="installApp">
          Install
        </v-btn>
        <v-btn variant="text" data-testid="dismiss-install" @click="dismiss">Not now</v-btn>
      </v-card-actions>
    </v-card>

    <v-card
      v-else-if="isIos"
      variant="flat"
      color="surface-container"
      class="install-card"
      data-testid="install-ios-hint"
    >
      <v-card-item>
        <template #prepend>
          <v-icon :icon="mdiShareVariant" color="primary" />
        </template>
        <v-card-title class="text-subtitle-1">Add to Home Screen</v-card-title>
        <v-card-subtitle>Safari: Share → Add to Home Screen.</v-card-subtitle>
      </v-card-item>
    </v-card>

    <div class="roles">
      <v-card
        variant="flat"
        color="surface-container"
        class="role-card"
        data-testid="role-child"
        role="button"
        tabindex="0"
        @click="choose('/child')"
        @keydown.enter="choose('/child')"
        @keydown.space.prevent="choose('/child')"
      >
        <v-card-item>
          <template #prepend>
            <v-icon :icon="mdiCameraOutline" color="primary" />
          </template>
          <v-card-title class="text-subtitle-1">Use as child device</v-card-title>
        </v-card-item>
      </v-card>

      <v-card
        variant="flat"
        color="surface-container"
        class="role-card"
        data-testid="role-parent"
        role="button"
        tabindex="0"
        @click="choose('/parent')"
        @keydown.enter="choose('/parent')"
        @keydown.space.prevent="choose('/parent')"
      >
        <v-card-item>
          <template #prepend>
            <v-icon :icon="mdiCellphone" color="primary" />
          </template>
          <v-card-title class="text-subtitle-1">Use as parent device</v-card-title>
        </v-card-item>
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
  display: block;
  width: 96px;
  height: 96px;
  margin-bottom: 8px;
  border-radius: 50%;
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

.install-card {
  display: flex;
  flex-direction: column;
}

.role-card {
  cursor: pointer;
  transition: background-color 150ms ease;
}

.role-card:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.role-card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.disclaimer {
  margin: 0;
  font-size: 0.75rem;
  text-align: center;
  color: rgb(var(--v-theme-on-surface-muted));
}
</style>
