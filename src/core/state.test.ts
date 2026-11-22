import { describe, expect, it } from 'vitest'
import { transition } from './state'

describe('session state machine', () => {
  it('walks the happy path', () => {
    let state = transition('idle', 'start-pairing')
    expect(state).toBe('pairing')
    state = transition(state!, 'connect')
    expect(state).toBe('connecting')
    state = transition(state!, 'connected')
    expect(state).toBe('connected')
  })

  it('allows a degraded connection to recover', () => {
    const degraded = transition('connected', 'degraded')
    expect(degraded).toBe('degraded')
    expect(transition(degraded!, 'connected')).toBe('connected')
    expect(transition(degraded!, 'recovered')).toBe('connected')
  })

  it('ignores events that do not fit the current state', () => {
    expect(transition('idle', 'connected')).toBeNull()
    expect(transition('pairing', 'degraded')).toBeNull()
    expect(transition('lost', 'connected')).toBeNull()
  })

  it('can reset or restart from lost', () => {
    expect(transition('lost', 'reset')).toBe('idle')
    expect(transition('lost', 'start-pairing')).toBe('pairing')
  })
})
