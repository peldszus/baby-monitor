import {
  AUDIO_LIMITS,
  VIDEO_LIMITS,
  type AudioSettings,
  type VideoSettings,
} from './media-settings'
import type { NegotiationDescription } from './negotiation'

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

export interface NegotiateMessage extends MessageBase {
  type: 'negotiate'
  description: NegotiationDescription
}

export interface SetVideoMessage extends MessageBase, VideoSettings {
  type: 'set-video'
}

export interface SetAudioMessage extends MessageBase, AudioSettings {
  type: 'set-audio'
}

export interface StatusMessage extends MessageBase {
  type: 'status'
  battery: number | null
  charging: boolean | null
  fps: number
  width: number
  height: number
  bitrate: number
  audioLevel: number
  gain: number
  videoEnabled: boolean
  audioEnabled: boolean
  noiseSuppression: boolean
  autoGainControl: boolean
}

export type ControlMessage =
  | HelloMessage
  | PingMessage
  | PongMessage
  | NegotiateMessage
  | SetVideoMessage
  | SetAudioMessage
  | StatusMessage

export type DecodeFailure = 'too-large' | 'invalid-json' | 'invalid-shape' | 'unknown-type'

export type DecodeResult =
  { ok: true; message: ControlMessage } | { ok: false; reason: DecodeFailure }

export const MAX_CONTROL_MESSAGE_BYTES = 16 * 1024
const MAX_CAPS = 32
const MAX_CAP_LENGTH = 64
const MAX_NEGOTIATION_SDP_CHARS = 12_000

const encoder = new TextEncoder()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNumberInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isNullableNumberInRange(value: unknown, min: number, max: number): value is number | null {
  return value === null || isNumberInRange(value, min, max)
}

function isNullableBoolean(value: unknown): value is boolean | null {
  return value === null || typeof value === 'boolean'
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

export function createNegotiate(description: NegotiationDescription): NegotiateMessage {
  return { v: 1, id: makeId(), type: 'negotiate', description }
}

export function createSetVideo(settings: VideoSettings): SetVideoMessage {
  return { v: 1, id: makeId(), type: 'set-video', ...settings }
}

export function createSetAudio(settings: AudioSettings): SetAudioMessage {
  return { v: 1, id: makeId(), type: 'set-audio', ...settings }
}

export type StatusInput = Omit<StatusMessage, 'v' | 'id' | 'type'>

export function createStatus(status: StatusInput): StatusMessage {
  return { v: 1, id: makeId(), type: 'status', ...status }
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
    case 'set-video': {
      if (
        typeof value.enabled !== 'boolean' ||
        !isNumberInRange(value.fps, VIDEO_LIMITS.fpsMin, VIDEO_LIMITS.fpsMax) ||
        !isNumberInRange(
          value.scaleDownBy,
          VIDEO_LIMITS.scaleDownByMin,
          VIDEO_LIMITS.scaleDownByMax
        ) ||
        !isNumberInRange(value.maxBitrate, VIDEO_LIMITS.bitrateMin, VIDEO_LIMITS.bitrateMax)
      ) {
        return { ok: false, reason: 'invalid-shape' }
      }
      return {
        ok: true,
        message: {
          v: 1,
          id: value.id,
          type: 'set-video',
          enabled: value.enabled,
          fps: value.fps,
          scaleDownBy: value.scaleDownBy,
          maxBitrate: value.maxBitrate,
        },
      }
    }
    case 'set-audio': {
      if (
        typeof value.enabled !== 'boolean' ||
        !isNumberInRange(value.gain, AUDIO_LIMITS.gainMin, AUDIO_LIMITS.gainMax) ||
        typeof value.noiseSuppression !== 'boolean' ||
        typeof value.autoGainControl !== 'boolean'
      ) {
        return { ok: false, reason: 'invalid-shape' }
      }
      return {
        ok: true,
        message: {
          v: 1,
          id: value.id,
          type: 'set-audio',
          enabled: value.enabled,
          gain: value.gain,
          noiseSuppression: value.noiseSuppression,
          autoGainControl: value.autoGainControl,
        },
      }
    }
    case 'status': {
      if (
        !isNullableNumberInRange(value.battery, 0, 100) ||
        !isNullableBoolean(value.charging) ||
        !isNumberInRange(value.fps, 0, 120) ||
        !isNumberInRange(value.width, 0, 7680) ||
        !isNumberInRange(value.height, 0, 7680) ||
        !isNumberInRange(value.bitrate, 0, 100_000_000) ||
        !isNumberInRange(value.audioLevel, 0, 1) ||
        !isNumberInRange(value.gain, AUDIO_LIMITS.gainMin, AUDIO_LIMITS.gainMax) ||
        typeof value.videoEnabled !== 'boolean' ||
        typeof value.audioEnabled !== 'boolean' ||
        typeof value.noiseSuppression !== 'boolean' ||
        typeof value.autoGainControl !== 'boolean'
      ) {
        return { ok: false, reason: 'invalid-shape' }
      }
      return {
        ok: true,
        message: {
          v: 1,
          id: value.id,
          type: 'status',
          battery: value.battery,
          charging: value.charging,
          fps: value.fps,
          width: value.width,
          height: value.height,
          bitrate: value.bitrate,
          audioLevel: value.audioLevel,
          gain: value.gain,
          videoEnabled: value.videoEnabled,
          audioEnabled: value.audioEnabled,
          noiseSuppression: value.noiseSuppression,
          autoGainControl: value.autoGainControl,
        },
      }
    }
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
    case 'negotiate': {
      if (!isRecord(value.description)) {
        return { ok: false, reason: 'invalid-shape' }
      }
      const description = value.description
      if (description.type !== 'offer' && description.type !== 'answer') {
        return { ok: false, reason: 'invalid-shape' }
      }
      if (
        typeof description.sdp !== 'string' ||
        description.sdp.length === 0 ||
        description.sdp.length > MAX_NEGOTIATION_SDP_CHARS
      ) {
        return { ok: false, reason: 'invalid-shape' }
      }
      return {
        ok: true,
        message: {
          v: 1,
          id: value.id,
          type: 'negotiate',
          description: { type: description.type, sdp: description.sdp },
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
