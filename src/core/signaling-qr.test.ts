import { describe, expect, it } from 'vitest'
import {
  crc32,
  decodeSignal,
  encodeSignal,
  SIGNAL_TTL_MS,
  SignalChunkCollector,
} from './signaling-qr'

const FINGERPRINT =
  '00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF'

function dataChannelSdp(candidate: string, extra = ''): string {
  return [
    'v=0',
    'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    candidate,
    'a=ice-ufrag:abcd',
    'a=ice-pwd:0123456789abcdef0123456789abcdef',
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${FINGERPRINT}`,
    'a=setup:actpass',
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    extra,
  ]
    .filter((line) => line.length > 0)
    .join('\r\n')
}

const HOST_CANDIDATE =
  'a=candidate:1 1 udp 2113937151 192.168.1.20 54321 typ host generation 0 network-cost 999'
const SRFLX_ONLY_CANDIDATE =
  'a=candidate:1 1 udp 2113937151 203.0.113.5 54321 typ srflx raddr 0.0.0.0 rport 0 generation 0 network-cost 999'
const DATA_SDP = dataChannelSdp(HOST_CANDIDATE)
const FALLBACK_SDP = dataChannelSdp(SRFLX_ONLY_CANDIDATE)

function largeFallbackSdp(seedValue: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let seed = seedValue
  let noise = ''
  for (let i = 0; i < 6000; i++) {
    seed = (seed * 1103515245 + 12345) >>> 0
    noise += chars[seed % chars.length]
  }
  return dataChannelSdp(SRFLX_ONLY_CANDIDATE, `a=x-padding:${noise}`)
}

describe('QR signaling codec', () => {
  it('computes the standard CRC-32 vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe('cbf43926')
  })

  it('round-trips a compact data-channel offer in one small code', async () => {
    const now = 1_700_000_000_000
    const encoded = await encodeSignal('offer', DATA_SDP, now)
    expect(encoded.chunks).toHaveLength(1)
    expect(encoded.chunks[0].length).toBeLessThan(300)
    expect(encoded.expiresAt).toBe(now + SIGNAL_TTL_MS)

    const decoded = await decodeSignal(encoded.chunks[0], now + 1000)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.payload.v).toBe(1)
    expect(decoded.payload.kind).toBe('offer')
    expect(decoded.payload.expiresAt).toBe(encoded.expiresAt)
    expect(decoded.payload.sdp).toContain('a=ice-ufrag:abcd')
    expect(decoded.payload.sdp).toContain('a=ice-pwd:0123456789abcdef0123456789abcdef')
    expect(decoded.payload.sdp).toContain(`a=fingerprint:sha-256 ${FINGERPRINT}`)
    expect(decoded.payload.sdp).toContain('192.168.1.20 54321 typ host')
    expect(decoded.payload.sdp).not.toContain('192.168.1.20 54321 typ srflx')
  })

  it('round-trips an mDNS host candidate', async () => {
    const mdnsSdp = dataChannelSdp(
      'a=candidate:1 1 udp 2113937151 7fd055fa-f349-4631-b907-b862982d7f92.local 44887 typ host generation 0 network-cost 999'
    )
    const now = 1_700_000_000_000
    const encoded = await encodeSignal('offer', mdnsSdp, now)
    expect(encoded.chunks).toHaveLength(1)
    const decoded = await decodeSignal(encoded.chunks[0], now + 1000)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.payload.sdp).toContain(
      '7fd055fa-f349-4631-b907-b862982d7f92.local 44887 typ host'
    )
  })

  it('falls back to the compressed full SDP when no host candidate is present', async () => {
    const now = 1_700_000_000_000
    const encoded = await encodeSignal('answer', FALLBACK_SDP, now)
    const decoded = await decodeSignal(encoded.chunks[0], now + 1000)
    expect(decoded.ok).toBe(true)
    if (!decoded.ok) return
    expect(decoded.payload.v).toBe(2)
    expect(decoded.payload.kind).toBe('answer')
    expect(decoded.payload.sdp).toBe(FALLBACK_SDP)
  })

  it('rejects an SDP that is not a data-channel description', async () => {
    const audioSdp = [
      'v=0',
      'o=- 1 2 IN IP4 127.0.0.1',
      's=-',
      't=0 0',
      'm=audio 9 UDP/TLS/RTP/SAVPF 111',
      'a=ice-ufrag:abcd',
      'a=ice-pwd:0123456789abcdef0123456789abcdef',
      `a=fingerprint:sha-256 ${FINGERPRINT}`,
      'a=setup:actpass',
    ].join('\r\n')
    await expect(encodeSignal('offer', audioSdp, 1_700_000_000_000)).rejects.toThrow(/data-channel/)
  })

  it('rejects an expired code', async () => {
    const now = 1_700_000_000_000
    const encoded = await encodeSignal('answer', DATA_SDP, now)
    expect(await decodeSignal(encoded.chunks[0], now + SIGNAL_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('chunks a large fallback signal and reassembles it out of order', async () => {
    const largeSdp = largeFallbackSdp(1)
    const now = 1_700_000_000_000
    const encoded = await encodeSignal('offer', largeSdp, now)
    expect(encoded.chunks.length).toBeGreaterThan(1)

    const collector = new SignalChunkCollector()
    const reversed = [...encoded.chunks].reverse()
    let result = collector.add(reversed[0])
    for (const chunk of reversed.slice(1)) result = collector.add(chunk)

    expect(result.status).toBe('complete')
    if (result.status !== 'complete') return

    const decoded = await decodeSignal(result.text, now + 1000)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(decoded.payload.sdp).toBe(largeSdp)
  })

  it('reports partial progress while chunks are missing', async () => {
    const encoded = await encodeSignal('offer', largeFallbackSdp(2), 1_700_000_000_000)
    expect(encoded.chunks.length).toBeGreaterThan(1)

    const collector = new SignalChunkCollector()
    const result = collector.add(encoded.chunks[0])
    expect(result).toEqual({
      status: 'partial',
      received: 1,
      total: encoded.chunks.length,
    })
  })

  it('restarts collection when a different code arrives', async () => {
    const now = 1_700_000_000_000
    const first = await encodeSignal('offer', largeFallbackSdp(3), now)
    const second = await encodeSignal('offer', largeFallbackSdp(4), now)
    expect(first.chunks.length).toBeGreaterThan(1)
    expect(second.chunks.length).toBeGreaterThan(1)

    const collector = new SignalChunkCollector()
    expect(collector.add(first.chunks[0]).status).toBe('partial')
    expect(collector.add(second.chunks[0])).toEqual({
      status: 'invalid',
      reason: 'invalid-format',
    })

    let result = collector.add(second.chunks[0])
    for (const chunk of second.chunks.slice(1)) result = collector.add(chunk)
    expect(result.status).toBe('complete')
  })

  it('rejects a tampered payload', async () => {
    const encoded = await encodeSignal('offer', DATA_SDP, 1_700_000_000_000)
    const parts = encoded.chunks[0].split('|')
    const data = parts[4]
    parts[4] = (data[0] === 'A' ? 'B' : 'A') + data.slice(1)
    expect(await decodeSignal(parts.join('|'), 1_700_000_001_000)).toEqual({
      ok: false,
      reason: 'checksum',
    })
  })

  it('rejects malformed chunk headers', async () => {
    expect(await decodeSignal('not-a-code')).toEqual({ ok: false, reason: 'invalid-format' })
    expect(await decodeSignal('')).toEqual({ ok: false, reason: 'empty' })
  })

  it('collects a single code immediately', async () => {
    const encoded = await encodeSignal('answer', DATA_SDP, 1_700_000_000_000)
    const collector = new SignalChunkCollector()
    const result = collector.add(encoded.chunks[0])
    expect(result.status).toBe('complete')
  })
})
