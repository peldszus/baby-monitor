import { beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
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
  beforeEach(() => {
    localStorage.clear()
  })

  it('offers both device roles', () => {
    const wrapper = mount(HomeView, {
      global: { plugins: [createTestRouter()] },
    })

    expect(wrapper.get('h1').text()).toBe('Baby Monitor')
    expect(wrapper.get('[data-testid="role-child"]').text()).toContain('child')
    expect(wrapper.get('[data-testid="role-parent"]').text()).toContain('parent')
    expect(wrapper.get('[data-testid="role-parent"]').classes()).toEqual(
      wrapper.get('[data-testid="role-child"]').classes()
    )
  })

  it('offers the install prompt when the browser provides one', async () => {
    const wrapper = mount(HomeView, {
      global: { plugins: [createTestRouter()] },
    })
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
    }
    event.prompt = vi.fn(async () => undefined)
    event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' })

    window.dispatchEvent(event)
    await nextTick()
    expect(wrapper.find('[data-testid="install-prompt"]').exists()).toBe(true)

    await wrapper.get('[data-testid="dismiss-install"]').trigger('click')
    expect(wrapper.find('[data-testid="install-prompt"]').exists()).toBe(false)
    wrapper.unmount()
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
