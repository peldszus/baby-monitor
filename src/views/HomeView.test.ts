import { describe, expect, it } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import HomeView from './HomeView.vue'

function createTestRouter() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: HomeView },
      { path: '/child', component: { template: '<div>child</div>' } },
      { path: '/parent', component: { template: '<div>parent</div>' } },
    ],
  })
}

describe('HomeView', () => {
  it('offers both device roles', () => {
    const wrapper = mount(HomeView, {
      global: { plugins: [createTestRouter()] },
    })

    expect(wrapper.get('h1').text()).toBe('Baby Monitor')
    expect(wrapper.get('[data-testid="role-child"]').text()).toContain('child')
    expect(wrapper.get('[data-testid="role-parent"]').text()).toContain('parent')
  })

  it('navigates to the child role', async () => {
    const router = createTestRouter()
    await router.push('/')
    await router.isReady()
    const wrapper = mount(HomeView, { global: { plugins: [router] } })

    await wrapper.get('[data-testid="role-child"]').trigger('click')
    await flushPromises()

    expect(router.currentRoute.value.path).toBe('/child')
  })
})
