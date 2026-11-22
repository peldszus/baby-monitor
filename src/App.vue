<script setup lang="ts">
import { useRoute } from 'vue-router'

const route = useRoute()
</script>

<template>
  <v-app>
    <v-app-bar flat color="surface">
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
