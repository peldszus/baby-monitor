import { describe, expect, it } from 'vitest'
import {
  crc32,
  decodeSignal,
  encodeSignal,
  SIGNAL_TTL_MS,
  SignalChunkCollector,
} from './signaling-qr'

const SDP = [
  'v=0',
  'o=- 4611731400430051336 2 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'a=fingerprint:sha-256 6B:8B:5A:1F:2A:44:9D:53:0B:7A:7E:6C:33:5D:6E:4C:2D:1A:6F:8E:7B:5C:4D:3E:2F:1A:0B:9C:8D:7E:6F',
  'm=audio 9 UDP/TLS/RTP/SAVPF 111',
  'a=ice-ufrag:abcd',
  'a=ice-pwd:0123456789abcdef0123456789abcdef',
  'a=setup:actpass',
  'a=mid:0',
].join('\r\n')

describe('QR signaling codec', () => {
  it('computes the standard CRC-32 vector', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe('cbf43926')
  })

  it('round-trips a single offer', async () => {
    const now = 1_700_000_000_000
    const encoded = await encodeSignal('offer', SDP, now)
    expect(encoded.chunks).toHaveLength(1)
    expect(encoded.expiresAt).toBe(now + SIGNAL_TTL_MS)

    const decoded = await decodeSignal(encoded.chunks[0], now + 1000)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.payload.kind).toBe('offer')
      expect(decoded.payload.sdp).toBe(SDP)
      expect(decoded.payload.expiresAt).toBe(encoded.expiresAt)
    }
  })

  it('rejects an expired code', async () => {
    const now = 1_700_000_000_000
    const encoded = await encodeSignal('answer', SDP, now)
    expect(await decodeSignal(encoded.chunks[0], now + SIGNAL_TTL_MS + 1)).toEqual({
      ok: false,
      reason: 'expired',
    })
  })

  it('chunks a large signal and reassembles it out of order', async () => {
    const largeSdp = `${SDP}\r\n${Array.from(
      { length: 120 },
      (_, i) => `a=candidate:${i} 1 udp 2122260223 192.168.1.${i % 255} 54321 typ host`
    ).join('\r\n')}`
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
    const largeSdp = `${SDP}\r\n${'a=x:y\r\n'.repeat(400)}`
    const encoded = await encodeSignal('offer', largeSdp, 1_700_000_000_000)
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
    const first = await encodeSignal('offer', `${SDP}\r\n${'a=x:y\r\n'.repeat(400)}`, now)
    const second = await encodeSignal('offer', `${SDP}\r\n${'a=x:z\r\n'.repeat(400)}`, now)
    expect(first.chunks.length).toBeGreaterThan(1)
    expect(second.chunks.length).toBe(first.chunks.length)

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
    const encoded = await encodeSignal('offer', SDP, 1_700_000_000_000)
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
    const encoded = await encodeSignal('answer', SDP, 1_700_000_000_000)
    const collector = new SignalChunkCollector()
    const result = collector.add(encoded.chunks[0])
    expect(result.status).toBe('complete')
  })
})
