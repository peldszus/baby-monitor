import { describe, expect, it } from 'vitest'
import { deriveShortCode, extractFingerprints } from './short-code'

const OFFER = [
  'v=0',
  'a=fingerprint:sha-256 6B:8B:5A:1F:2A:44:9D:53:0B:7A:7E:6C:33:5D:6E:4C:2D:1A:6F:8E:7B:5C:4D:3E:2F:1A:0B:9C:8D:7E:6F',
].join('\r\n')

const ANSWER = [
  'v=0',
  'a=fingerprint:sha-256 AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99',
].join('\r\n')

describe('short authentication code', () => {
  it('extracts unique fingerprints in a stable order', () => {
    const withDuplicate = `${OFFER}\r\n${OFFER}`
    expect(extractFingerprints(withDuplicate)).toEqual([
      '6B:8B:5A:1F:2A:44:9D:53:0B:7A:7E:6C:33:5D:6E:4C:2D:1A:6F:8E:7B:5C:4D:3E:2F:1A:0B:9C:8D:7E:6F',
    ])
  })

  it('derives a stable six-digit code', async () => {
    const first = await deriveShortCode(OFFER, ANSWER)
    const second = await deriveShortCode(OFFER, ANSWER)
    expect(first).toMatch(/^\d{6}$/)
    expect(second).toBe(first)
  })

  it('does not depend on the offer/answer order', async () => {
    expect(await deriveShortCode(ANSWER, OFFER)).toBe(await deriveShortCode(OFFER, ANSWER))
  })

  it('changes when a fingerprint changes', async () => {
    const otherAnswer = ANSWER.replace('AA:BB', 'AA:BC')
    expect(await deriveShortCode(OFFER, otherAnswer)).not.toBe(await deriveShortCode(OFFER, ANSWER))
  })

  it('returns null when no fingerprint is present', async () => {
    expect(await deriveShortCode('v=0', 'v=0')).toBeNull()
  })
})
