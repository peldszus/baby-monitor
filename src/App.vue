<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'
import { useAppNotice } from '@/composables/useAppNotice'

const route = useRoute()
const router = useRouter()
const { notice, dismissNotice } = useAppNotice()

function onNoticeUpdate(value: boolean): void {
  if (!value) dismissNotice()
}
</script>

<template>
  <v-app>
    <v-app-bar flat color="surface">
      <v-app-bar-nav-icon
        v-if="route.meta.showBackButton"
        aria-label="Back"
        @click="router.back()"
      />
      <v-app-bar-title>{{ route.meta.title ?? 'Baby Monitor' }}</v-app-bar-title>
    </v-app-bar>

    <v-main>
      <RouterView v-slot="{ Component, route: currentRoute }">
        <Transition name="screen" mode="out-in">
          <component :is="Component" :key="currentRoute.path" />
        </Transition>
      </RouterView>
    </v-main>

    <v-snackbar
      :model-value="notice !== null"
      :timeout="8000"
      color="surface-container-high"
      location="bottom"
      @update:model-value="onNoticeUpdate"
    >
      <span data-testid="app-notice">{{ notice }}</span>
      <template #actions>
        <v-btn variant="text" @click="dismissNotice">Close</v-btn>
      </template>
    </v-snackbar>
  </v-app>
</template>

<style>
.screen-enter-active,
.screen-leave-active {
  transition: opacity 150ms ease;
}
.screen-enter-from,
.screen-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .screen-enter-active,
  .screen-leave-active {
    transition: none;
  }
}
</style>
