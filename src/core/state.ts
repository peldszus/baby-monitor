export type SessionState = 'idle' | 'pairing' | 'connecting' | 'connected' | 'degraded' | 'lost'

export type SessionEvent =
  'start-pairing' | 'connect' | 'connected' | 'degraded' | 'recovered' | 'lost' | 'reset'

const transitions: Record<SessionState, Partial<Record<SessionEvent, SessionState>>> = {
  idle: { 'start-pairing': 'pairing', lost: 'lost', reset: 'idle' },
  pairing: { connect: 'connecting', lost: 'lost', reset: 'idle' },
  connecting: { connected: 'connected', degraded: 'degraded', lost: 'lost', reset: 'idle' },
  connected: { degraded: 'degraded', lost: 'lost', reset: 'idle' },
  degraded: { recovered: 'connected', connected: 'connected', lost: 'lost', reset: 'idle' },
  lost: { 'start-pairing': 'pairing', reset: 'idle' },
}

/**
 * Returns the next state, or null when the event is not valid for the current state.
 * Invalid events are ignored rather than throwing, so a late WebRTC callback cannot
 * move a finished session back into an earlier state.
 */
export function transition(current: SessionState, event: SessionEvent): SessionState | null {
  return transitions[current][event] ?? null
}
