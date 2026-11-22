<script setup lang="ts">
import { useRoute, useRouter } from 'vue-router'

const route = useRoute()
const router = useRouter()
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
