import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** Screen title, shown in the top app bar. */
    title?: string
  }
}

const router = createRouter({
  // Hash history keeps deep links working on GitHub Pages without server rewrites.
  history: createWebHashHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'home',
      component: HomeView,
      meta: { title: 'Baby Monitor' },
    },
  ],
})

const APP_NAME = 'Baby Monitor'

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME
})

export default router
