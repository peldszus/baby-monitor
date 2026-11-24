import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { useInstallPrompt } from './useInstallPrompt'

const TestComponent = defineComponent({
  setup() {
    return useInstallPrompt()
  },
  template: '<div>{{ canInstall ? "installable" : "not-installable" }}</div>',
})

function installEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const event = new Event('beforeinstallprompt') as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
  }
  event.prompt = vi.fn(async () => undefined)
  event.userChoice = Promise.resolve({ outcome, platform: 'web' })
  return event
}

describe('useInstallPrompt', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('exposes the browser install prompt and accepts it', async () => {
    const wrapper = mount(TestComponent)
    const event = installEvent('accepted')

    window.dispatchEvent(event)
    await nextTick()
    expect(wrapper.text()).toBe('installable')

    await wrapper.vm.install()
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(wrapper.vm.installed).toBe(true)
    expect(wrapper.vm.canInstall).toBe(false)
  })

  it('remembers a dismissal', async () => {
    const wrapper = mount(TestComponent)
    window.dispatchEvent(installEvent())
    await nextTick()
    expect(wrapper.vm.canInstall).toBe(true)

    wrapper.vm.dismiss()
    expect(wrapper.vm.canInstall).toBe(false)
    expect(localStorage.getItem('baby-monitor:install-dismissed')).toBe('1')
  })

  it('ignores a dismissed install choice', async () => {
    const wrapper = mount(TestComponent)
    window.dispatchEvent(installEvent('dismissed'))
    await nextTick()

    expect(await wrapper.vm.install()).toBe(false)
    expect(wrapper.vm.installed).toBe(false)
    expect(wrapper.vm.canInstall).toBe(false)
  })
})
