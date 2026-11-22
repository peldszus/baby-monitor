export type SignalKind = 'offer' | 'answer'

export interface SignalPayload {
  v: 1
  kind: SignalKind
  sdp: string
  createdAt: number
  expiresAt: number
}

export interface EncodedSignal {
  /** One QR code per entry. A single entry is the common case. */
  chunks: string[]
  expiresAt: number
}

export type SignalFailure =
  | 'empty'
  | 'invalid-format'
  | 'incomplete'
  | 'checksum'
  | 'decompression'
  | 'invalid-payload'
  | 'expired'

export type DecodeSignalResult =
  { ok: true; payload: SignalPayload } | { ok: false; reason: SignalFailure }

export const SIGNAL_TTL_MS = 2 * 60 * 1000
export const MAX_SIGNAL_CHUNKS = 64
export const MAX_CHUNK_CHARS = 900

const PREFIX = 'BM1'
const encoder = new TextEncoder()

interface SignalChunk {
  index: number
  total: number
  crc: string
  data: string
}

let crcTable: Uint32Array | null = null

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let value = i
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    table[i] = value >>> 0
  }
  crcTable = table
  return table
}

export function crc32(bytes: Uint8Array): string {
  const table = getCrcTable()
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  }
  return ((crc ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0')
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const step = 0x8000
  for (let offset = 0; offset < bytes.length; offset += step) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + step))
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function toBlobPart(bytes: Uint8Array): BlobPart {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return copy.buffer as ArrayBuffer
}

async function deflate(bytes: Uint8Array): Promise<{ flag: 'z' | 'p'; bytes: Uint8Array }> {
  if (typeof globalThis.CompressionStream !== 'function') {
    return { flag: 'p', bytes }
  }
  try {
    const stream = new Blob([toBlobPart(bytes)])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'))
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer())
    return { flag: 'z', bytes: compressed }
  } catch {
    return { flag: 'p', bytes }
  }
}

async function inflate(flag: string, bytes: Uint8Array): Promise<Uint8Array | null> {
  if (flag === 'p') return bytes
  if (flag !== 'z' || typeof globalThis.DecompressionStream !== 'function') return null
  try {
    const stream = new Blob([toBlobPart(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

function isSignalPayload(value: unknown): value is SignalPayload {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    record.v === 1 &&
    (record.kind === 'offer' || record.kind === 'answer') &&
    typeof record.sdp === 'string' &&
    record.sdp.length > 0 &&
    typeof record.createdAt === 'number' &&
    Number.isFinite(record.createdAt) &&
    typeof record.expiresAt === 'number' &&
    Number.isFinite(record.expiresAt)
  )
}

function parseChunk(text: string): SignalChunk | null {
  const parts = text.split('|')
  if (parts.length !== 5 || parts[0] !== PREFIX) return null

  const index = Number(parts[1])
  const total = Number(parts[2])
  const crc = parts[3]
  const data = parts[4]

  if (!Number.isInteger(index) || index < 1) return null
  if (!Number.isInteger(total) || total < 1 || total > MAX_SIGNAL_CHUNKS) return null
  if (index > total) return null
  if (!/^[0-9a-f]{8}$/.test(crc)) return null
  if (!/^[A-Za-z0-9_-]+$/.test(data)) return null

  return { index, total, crc, data }
}

function assemble(chunks: SignalChunk[]): { ok: true; data: string; crc: string } | { ok: false } {
  if (chunks.length === 0) return { ok: false }
  const total = chunks[0].total
  const crc = chunks[0].crc
  if (chunks.some((chunk) => chunk.total !== total || chunk.crc !== crc)) return { ok: false }

  const ordered = [...chunks].sort((a, b) => a.index - b.index)
  if (ordered.some((chunk, i) => chunk.index !== i + 1)) return { ok: false }
  if (ordered.length !== total) return { ok: false }

  return { ok: true, data: ordered.map((chunk) => chunk.data).join(''), crc }
}

export async function encodeSignal(
  kind: SignalKind,
  sdp: string,
  now = Date.now()
): Promise<EncodedSignal> {
  if (!sdp) throw new Error('Cannot encode an empty SDP.')

  const expiresAt = now + SIGNAL_TTL_MS
  const payload: SignalPayload = { v: 1, kind, sdp, createdAt: now, expiresAt }
  const compressed = await deflate(encoder.encode(JSON.stringify(payload)))
  const data = compressed.flag + bytesToBase64Url(compressed.bytes)
  const checksum = crc32(encoder.encode(data))

  const parts: string[] = []
  for (let offset = 0; offset < data.length; offset += MAX_CHUNK_CHARS) {
    parts.push(data.slice(offset, offset + MAX_CHUNK_CHARS))
  }
  if (parts.length > MAX_SIGNAL_CHUNKS) {
    throw new Error('Pairing code is too large to display.')
  }

  return {
    chunks: parts.map((part, i) => `${PREFIX}|${i + 1}|${parts.length}|${checksum}|${part}`),
    expiresAt,
  }
}

export async function decodeSignal(text: string, now = Date.now()): Promise<DecodeSignalResult> {
  const parts = text
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
  if (parts.length === 0) return { ok: false, reason: 'empty' }

  const chunks: SignalChunk[] = []
  for (const part of parts) {
    const chunk = parseChunk(part)
    if (!chunk) return { ok: false, reason: 'invalid-format' }
    chunks.push(chunk)
  }

  const joined = assemble(chunks)
  if (!joined.ok) {
    const total = chunks[0]?.total ?? 0
    return { ok: false, reason: chunks.length < total ? 'incomplete' : 'invalid-format' }
  }

  if (crc32(encoder.encode(joined.data)) !== joined.crc) {
    return { ok: false, reason: 'checksum' }
  }

  const flag = joined.data[0]
  let payloadBytes: Uint8Array | null
  try {
    payloadBytes = await inflate(flag, base64UrlToBytes(joined.data.slice(1)))
  } catch {
    payloadBytes = null
  }
  if (!payloadBytes) return { ok: false, reason: 'decompression' }

  let payload: unknown
  try {
    payload = JSON.parse(new TextDecoder().decode(payloadBytes))
  } catch {
    return { ok: false, reason: 'invalid-payload' }
  }
  if (!isSignalPayload(payload)) return { ok: false, reason: 'invalid-payload' }
  if (payload.expiresAt <= now) return { ok: false, reason: 'expired' }

  return { ok: true, payload }
}

export type CollectorResult =
  | { status: 'partial'; received: number; total: number }
  | { status: 'complete'; text: string }
  | { status: 'invalid'; reason: SignalFailure }

/**
 * Collects the chunks of a multi-code signal in scan order. A single-code signal
 * completes on the first call. Callers should keep the collector for the whole
 * pairing attempt and reset it when starting over.
 */
export class SignalChunkCollector {
  private readonly chunks = new Map<number, SignalChunk>()

  addMany(text: string): CollectorResult {
    const parts = text
      .trim()
      .split(/\s+/)
      .filter((part) => part.length > 0)
    if (parts.length === 0) return { status: 'invalid', reason: 'empty' }

    let last: CollectorResult = { status: 'invalid', reason: 'empty' }
    for (const part of parts) {
      last = this.add(part)
      if (last.status === 'complete') return last
    }
    return last
  }

  add(text: string): CollectorResult {
    const chunk = parseChunk(text.trim())
    if (!chunk) return { status: 'invalid', reason: 'invalid-format' }

    const existing = this.chunks.get(chunk.index)
    if (existing && (existing.total !== chunk.total || existing.crc !== chunk.crc)) {
      this.chunks.clear()
      return { status: 'invalid', reason: 'invalid-format' }
    }
    if (this.chunks.size > 0) {
      const first = this.chunks.values().next().value as SignalChunk
      if (first.total !== chunk.total || first.crc !== chunk.crc) {
        this.chunks.clear()
        return { status: 'invalid', reason: 'invalid-format' }
      }
    }
    this.chunks.set(chunk.index, chunk)

    if (this.chunks.size < chunk.total) {
      return { status: 'partial', received: this.chunks.size, total: chunk.total }
    }

    const joined = assemble([...this.chunks.values()])
    if (!joined.ok) return { status: 'invalid', reason: 'invalid-format' }

    return {
      status: 'complete',
      text: [...this.chunks.values()]
        .sort((a, b) => a.index - b.index)
        .map((item) => `${PREFIX}|${item.index}|${item.total}|${item.crc}|${item.data}`)
        .join('\n'),
    }
  }

  get received(): number {
    return this.chunks.size
  }

  reset(): void {
    this.chunks.clear()
  }
}
