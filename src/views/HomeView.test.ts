import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import HomeView from './HomeView.vue'

describe('HomeView', () => {
  it('shows the app name and the empty monitor state', () => {
    const wrapper = mount(HomeView)

    expect(wrapper.get('h1').text()).toBe('Baby Monitor')
    expect(wrapper.text()).toContain('No monitor paired')
  })
})
