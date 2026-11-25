import { describe, expect, it } from 'vitest'
import {
  createHello,
  createNegotiate,
  createPing,
  createPong,
  createSetAudio,
  createSetScreen,
  createSetVideo,
  createStatus,
  decodeControlMessage,
  encodeControlMessage,
  MAX_CONTROL_MESSAGE_BYTES,
} from './control'

describe('control protocol', () => {
  it('round-trips hello, ping and pong', () => {
    const hello = createHello('child', ['wake-lock'])
    const ping = createPing(12.5)
    const pong = createPong(12.5)
    const negotiate = createNegotiate({
      type: 'offer',
      sdp: 'v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    })

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
    expect(decodeControlMessage(encodeControlMessage(negotiate))).toEqual({
      ok: true,
      message: negotiate,
    })
  })

  it('round-trips M2 control and status messages', () => {
    const video = createSetVideo({ enabled: true, fps: 10, scaleDownBy: 2, maxBitrate: 500_000 })
    const audio = createSetAudio({
      enabled: true,
      gain: 1.5,
      noiseSuppression: true,
      autoGainControl: false,
    })
    const maxAudio = createSetAudio({
      enabled: true,
      gain: 10,
      noiseSuppression: false,
      autoGainControl: false,
    })
    const screen = createSetScreen(true)
    const status = createStatus({
      battery: 87,
      charging: true,
      fps: 10,
      width: 640,
      height: 360,
      bitrate: 480_000,
      audioLevel: 0.25,
      gain: 1.5,
      videoEnabled: true,
      audioEnabled: true,
      noiseSuppression: true,
      autoGainControl: false,
      screenDark: false,
    })

    for (const message of [video, audio, maxAudio, screen, status]) {
      expect(decodeControlMessage(encodeControlMessage(message))).toEqual({
        ok: true,
        message,
      })
    }
  })

  it('rejects M2 values outside their ranges', () => {
    const invalid = [
      '{"v":1,"id":"x","type":"set-video","enabled":true,"fps":0,"scaleDownBy":1,"maxBitrate":500000}',
      '{"v":1,"id":"x","type":"set-video","enabled":true,"fps":31,"scaleDownBy":1,"maxBitrate":500000}',
      '{"v":1,"id":"x","type":"set-video","enabled":true,"fps":10,"scaleDownBy":9,"maxBitrate":500000}',
      '{"v":1,"id":"x","type":"set-video","enabled":true,"fps":10,"scaleDownBy":1,"maxBitrate":1000}',
      '{"v":1,"id":"x","type":"set-audio","enabled":true,"gain":-1,"noiseSuppression":false,"autoGainControl":false}',
      '{"v":1,"id":"x","type":"set-audio","enabled":true,"gain":10.1,"noiseSuppression":false,"autoGainControl":false}',
      '{"v":1,"id":"x","type":"set-audio","enabled":true,"gain":1,"noiseSuppression":"yes","autoGainControl":false}',
      '{"v":1,"id":"x","type":"set-screen","dark":"yes"}',
      '{"v":1,"id":"x","type":"status","battery":101,"charging":true,"fps":10,"width":640,"height":360,"bitrate":0,"audioLevel":0,"gain":1,"videoEnabled":true,"audioEnabled":true,"noiseSuppression":false,"autoGainControl":false,"screenDark":false}',
      '{"v":1,"id":"x","type":"status","battery":50,"charging":true,"fps":10,"width":640,"height":360,"bitrate":0,"audioLevel":1.1,"gain":1,"videoEnabled":true,"audioEnabled":true,"noiseSuppression":false,"autoGainControl":false,"screenDark":false}',
      '{"v":1,"id":"x","type":"status","battery":50,"charging":true,"fps":10,"width":640,"height":360,"bitrate":0,"audioLevel":0,"gain":1,"videoEnabled":true,"audioEnabled":true,"noiseSuppression":false,"autoGainControl":false,"screenDark":"yes"}',
    ]
    for (const raw of invalid) {
      expect(decodeControlMessage(raw)).toEqual({ ok: false, reason: 'invalid-shape' })
    }
  })

  it('accepts unknown battery support as null', () => {
    const raw =
      '{"v":1,"id":"x","type":"status","battery":null,"charging":null,"fps":0,"width":0,"height":0,"bitrate":0,"audioLevel":0,"gain":0,"videoEnabled":false,"audioEnabled":false,"noiseSuppression":false,"autoGainControl":false,"screenDark":false}'
    const result = decodeControlMessage(raw)
    expect(result.ok).toBe(true)
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

  it('validates negotiation descriptions', () => {
    expect(
      decodeControlMessage(
        '{"v":1,"id":"x","type":"negotiate","description":{"type":"rollback","sdp":"v=0"}}'
      )
    ).toEqual({ ok: false, reason: 'invalid-shape' })
    expect(
      decodeControlMessage(
        '{"v":1,"id":"x","type":"negotiate","description":{"type":"offer","sdp":""}}'
      )
    ).toEqual({ ok: false, reason: 'invalid-shape' })
    expect(
      decodeControlMessage(
        `{"v":1,"id":"x","type":"negotiate","description":{"type":"offer","sdp":"${'x'.repeat(12_001)}"}}`
      )
    ).toEqual({ ok: false, reason: 'invalid-shape' })
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
