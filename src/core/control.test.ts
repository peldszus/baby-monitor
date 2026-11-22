import { describe, expect, it } from 'vitest'
import {
  createHello,
  createPing,
  createPong,
  decodeControlMessage,
  encodeControlMessage,
  MAX_CONTROL_MESSAGE_BYTES,
} from './control'

describe('control protocol', () => {
  it('round-trips hello, ping and pong', () => {
    const hello = createHello('child', ['wake-lock'])
    const ping = createPing(12.5)
    const pong = createPong(12.5)

    expect(decodeControlMessage(encodeControlMessage(hello))).toEqual({
      ok: true,
      message: hello,
    })
    expect(decodeControlMessage(encodeControlMessage(ping))).toEqual({
      ok: true,
      message: ping,
    })
    expect(decodeControlMessage(encodeControlMessage(pong))).toEqual({
      ok: true,
      message: pong,
    })
  })

  it('rejects malformed JSON and unknown types', () => {
    expect(decodeControlMessage('{')).toEqual({ ok: false, reason: 'invalid-json' })
    expect(decodeControlMessage('{"v":1,"id":"x","type":"nope"}')).toEqual({
      ok: false,
      reason: 'unknown-type',
    })
  })

  it('rejects the wrong version, missing ids and out-of-range values', () => {
    expect(decodeControlMessage('{"v":2,"id":"x","type":"ping","t":1}')).toEqual({
      ok: false,
      reason: 'invalid-shape',
    })
    expect(decodeControlMessage('{"v":1,"type":"ping","t":1}')).toEqual({
      ok: false,
      reason: 'invalid-shape',
    })
    expect(decodeControlMessage('{"v":1,"id":"x","type":"ping","t":-1}')).toEqual({
      ok: false,
      reason: 'invalid-shape',
    })
  })

  it('validates hello roles and capabilities', () => {
    expect(
      decodeControlMessage('{"v":1,"id":"x","type":"hello","role":"other","caps":[]}')
    ).toEqual({ ok: false, reason: 'invalid-shape' })
    expect(
      decodeControlMessage('{"v":1,"id":"x","type":"hello","role":"child","caps":"x"}')
    ).toEqual({ ok: false, reason: 'invalid-shape' })
  })

  it('ignores unknown fields on a valid message', () => {
    const raw = '{"v":1,"id":"x","type":"ping","t":4,"extra":"ignored"}'
    const result = decodeControlMessage(raw)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.message.type).toBe('ping')
  })

  it('rejects oversized messages before parsing', () => {
    const raw = 'x'.repeat(MAX_CONTROL_MESSAGE_BYTES + 1)
    expect(decodeControlMessage(raw)).toEqual({ ok: false, reason: 'too-large' })
  })
})
