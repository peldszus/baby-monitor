export type ControlRole = 'child' | 'parent'

interface MessageBase {
  v: 1
  id: string
  type: string
}

export interface HelloMessage extends MessageBase {
  type: 'hello'
  role: ControlRole
  caps: string[]
}

export interface PingMessage extends MessageBase {
  type: 'ping'
  /** Sender's performance.now() timestamp, echoed back in the pong. */
  t: number
}

export interface PongMessage extends MessageBase {
  type: 'pong'
  t: number
}

export type ControlMessage = HelloMessage | PingMessage | PongMessage

export type DecodeFailure = 'too-large' | 'invalid-json' | 'invalid-shape' | 'unknown-type'

export type DecodeResult =
  { ok: true; message: ControlMessage } | { ok: false; reason: DecodeFailure }

export const MAX_CONTROL_MESSAGE_BYTES = 8 * 1024
const MAX_CAPS = 32
const MAX_CAP_LENGTH = 64

const encoder = new TextEncoder()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function makeId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function createHello(role: ControlRole, caps: string[] = []): HelloMessage {
  return { v: 1, id: makeId(), type: 'hello', role, caps }
}

export function createPing(t: number): PingMessage {
  return { v: 1, id: makeId(), type: 'ping', t }
}

export function createPong(t: number): PongMessage {
  return { v: 1, id: makeId(), type: 'pong', t }
}

export function encodeControlMessage(message: ControlMessage): string {
  const raw = JSON.stringify(message)
  if (encoder.encode(raw).byteLength > MAX_CONTROL_MESSAGE_BYTES) {
    throw new Error('Control message exceeds the size limit.')
  }
  return raw
}

/**
 * Strictly validates an incoming control message. Unknown fields are ignored, but
 * unknown types and malformed values are rejected. Callers should silently drop
 * failures: the data channel is authenticated, but a broken peer must not crash us.
 */
export function decodeControlMessage(raw: unknown): DecodeResult {
  if (typeof raw !== 'string') return { ok: false, reason: 'invalid-shape' }
  if (encoder.encode(raw).byteLength > MAX_CONTROL_MESSAGE_BYTES) {
    return { ok: false, reason: 'too-large' }
  }

  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'invalid-json' }
  }

  if (!isRecord(value)) return { ok: false, reason: 'invalid-shape' }
  if (value.v !== 1) return { ok: false, reason: 'invalid-shape' }
  if (typeof value.id !== 'string' || value.id.length === 0 || value.id.length > 64) {
    return { ok: false, reason: 'invalid-shape' }
  }
  if (typeof value.type !== 'string') return { ok: false, reason: 'invalid-shape' }

  switch (value.type) {
    case 'hello': {
      if (value.role !== 'child' && value.role !== 'parent') {
        return { ok: false, reason: 'invalid-shape' }
      }
      if (
        !Array.isArray(value.caps) ||
        value.caps.length > MAX_CAPS ||
        value.caps.some((cap) => typeof cap !== 'string' || cap.length > MAX_CAP_LENGTH)
      ) {
        return { ok: false, reason: 'invalid-shape' }
      }
      return {
        ok: true,
        message: {
          v: 1,
          id: value.id,
          type: 'hello',
          role: value.role,
          caps: value.caps,
        },
      }
    }
    case 'ping':
    case 'pong': {
      if (typeof value.t !== 'number' || !Number.isFinite(value.t) || value.t < 0) {
        return { ok: false, reason: 'invalid-shape' }
      }
      return {
        ok: true,
        message: { v: 1, id: value.id, type: value.type, t: value.t },
      }
    }
    default:
      return { ok: false, reason: 'unknown-type' }
  }
}
