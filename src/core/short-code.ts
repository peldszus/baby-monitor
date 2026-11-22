const FINGERPRINT_PATTERN = /^a=fingerprint:sha-256\s+([0-9a-f:]+)\s*$/gim

export function extractFingerprints(sdp: string): string[] {
  const found = new Set<string>()
  for (const match of sdp.matchAll(FINGERPRINT_PATTERN)) {
    found.add(match[1].toUpperCase())
  }
  return [...found].sort()
}

/**
 * Six-digit short authentication string derived from both DTLS fingerprints.
 * Both devices compute the same value from the offer and answer, so the user can
 * compare it out of band if a QR code could have been photographed.
 */
export async function deriveShortCode(offerSdp: string, answerSdp: string): Promise<string | null> {
  const fingerprints = [
    ...new Set([...extractFingerprints(offerSdp), ...extractFingerprints(answerSdp)]),
  ].sort()
  if (fingerprints.length === 0) return null
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') return null

  const data = new TextEncoder().encode(fingerprints.join('\n'))
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', data))
  const value =
    (((digest[0] << 24) | (digest[1] << 16) | (digest[2] << 8) | digest[3]) >>> 0) % 1_000_000
  return value.toString().padStart(6, '0')
}
