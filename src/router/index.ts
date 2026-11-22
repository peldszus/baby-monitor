import { createRouter, createWebHashHistory } from 'vue-router'
import HomeView from '@/views/HomeView.vue'

declare module 'vue-router' {
  interface RouteMeta {
    /** Screen title, shown in the top app bar. */
    title?: string
    /** Shows a back button in the app bar. */
    showBackButton?: boolean
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
    {
      path: '/child',
      name: 'child',
      component: () => import('@/views/ChildView.vue'),
      meta: { title: 'Child device', showBackButton: true },
    },
    {
      path: '/parent',
      name: 'parent',
      component: () => import('@/views/ParentView.vue'),
      meta: { title: 'Parent device', showBackButton: true },
    },
  ],
})

const APP_NAME = 'Baby Monitor'

router.afterEach((to) => {
  document.title = to.meta.title ? `${to.meta.title} · ${APP_NAME}` : APP_NAME
})

export default router
