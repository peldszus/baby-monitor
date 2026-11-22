export type SignalKind = 'offer' | 'answer'
export type SignalVersion = 1 | 2

export interface SignalPayload {
  /** 1 = compact handshake, 2 = compressed full-SDP fallback. */
  v: SignalVersion
  kind: SignalKind
  sdp: string
  createdAt: number
  expiresAt: number
}

export interface EncodedSignal {
  /** One QR code per entry. The compact handshake is a single entry. */
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
const MAX_SDP_CHARS = 60_000
const HOST_PATTERN = /^[A-Za-z0-9._:-]+$/
const ICE_PATTERN = /^[A-Za-z0-9+/_-]+$/
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type SetupRole = 'actpass' | 'active' | 'passive'

interface HostCandidate {
  host: string
  port: number
}

interface CompactFields {
  ufrag: string
  pwd: string
  fingerprint: Uint8Array
  setup: SetupRole
  candidates: HostCandidate[]
}

interface SignalChunk {
  index: number
  total: number
  crc: string
  data: string
}

type CompactDecodeResult =
  | { ok: true; kind: SignalKind; expiresAt: number; fields: CompactFields }
  | { ok: false; reason: 'invalid-payload' | 'expired' }

const KIND_TO_CODE: Record<SignalKind, number> = { offer: 1, answer: 2 }
const CODE_TO_KIND: Record<number, SignalKind> = { 1: 'offer', 2: 'answer' }
const SETUP_TO_CODE: Record<SetupRole, number> = { actpass: 1, active: 2, passive: 3 }
const CODE_TO_SETUP: Record<number, SetupRole> = { 1: 'actpass', 2: 'active', 3: 'passive' }

class ByteWriter {
  private readonly bytes: number[] = []

  u8(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      throw new Error('Value does not fit in one byte.')
    }
    this.bytes.push(value)
  }

  u16(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new Error('Value does not fit in two bytes.')
    }
    this.bytes.push((value >>> 8) & 0xff, value & 0xff)
  }

  u32(value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error('Value does not fit in four bytes.')
    }
    this.bytes.push(
      (value >>> 24) & 0xff,
      (value >>> 16) & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff
    )
  }

  raw(value: Uint8Array): void {
    for (const byte of value) this.bytes.push(byte)
  }

  string(value: string): void {
    const bytes = encoder.encode(value)
    if (bytes.length > 0xff) throw new Error('String is too long for the payload.')
    this.u8(bytes.length)
    this.raw(bytes)
  }

  finish(): Uint8Array {
    return Uint8Array.from(this.bytes)
  }
}

class ByteReader {
  private offset = 0

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset
  }

  u8(): number {
    if (this.remaining < 1) throw new Error('Unexpected end of payload.')
    return this.bytes[this.offset++]
  }

  u16(): number {
    if (this.remaining < 2) throw new Error('Unexpected end of payload.')
    const value = (this.bytes[this.offset] << 8) | this.bytes[this.offset + 1]
    this.offset += 2
    return value
  }

  u32(): number {
    if (this.remaining < 4) throw new Error('Unexpected end of payload.')
    const value =
      ((this.bytes[this.offset] << 24) |
        (this.bytes[this.offset + 1] << 16) |
        (this.bytes[this.offset + 2] << 8) |
        this.bytes[this.offset + 3]) >>>
      0
    this.offset += 4
    return value
  }

  raw(length: number): Uint8Array {
    if (length < 0 || this.remaining < length) throw new Error('Unexpected end of payload.')
    const value = this.bytes.subarray(this.offset, this.offset + length)
    this.offset += length
    return value
  }

  string(): string {
    return decoder.decode(this.raw(this.u8()))
  }
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

async function inflate(flag: number, bytes: Uint8Array): Promise<Uint8Array | null> {
  if (flag === 0) return bytes
  if (flag !== 1 || typeof globalThis.DecompressionStream !== 'function') return null
  try {
    const stream = new Blob([toBlobPart(bytes)])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
    return new Uint8Array(await new Response(stream).arrayBuffer())
  } catch {
    return null
  }
}

function validIceValue(value: string, min: number, max: number): boolean {
  return value.length >= min && value.length <= max && ICE_PATTERN.test(value)
}

function validHost(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 253 &&
    HOST_PATTERN.test(value) &&
    !value.startsWith('.') &&
    !value.endsWith('.')
  )
}

function isIpv4(value: string): boolean {
  const parts = value.split('.')
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

function candidateRank(candidate: HostCandidate): number {
  if (isIpv4(candidate.host)) return 0
  if (candidate.host.endsWith('.local')) return 1
  if (candidate.host.includes(':')) return 2
  return 3
}

function parseFingerprint(lines: string[]): Uint8Array {
  const line = lines.find((item) => item.toLowerCase().startsWith('a=fingerprint:sha-256 '))
  if (!line) throw new Error('The SDP has no SHA-256 fingerprint.')
  const hex = line.slice('a=fingerprint:sha-256 '.length).trim()
  if (!/^([0-9A-Fa-f]{2}:){31}[0-9A-Fa-f]{2}$/.test(hex)) {
    throw new Error('The SDP fingerprint is malformed.')
  }
  return Uint8Array.from(hex.split(':').map((part) => Number.parseInt(part, 16)))
}

function formatFingerprint(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0').toUpperCase()).join(':')
}

function isDataChannelSdp(sdp: string): boolean {
  if (!sdp || sdp.length > MAX_SDP_CHARS || sdp.includes('\0')) return false
  const lines = sdp.split(/\r?\n/)
  const media = lines.filter((line) => line.startsWith('m='))
  if (
    media.length !== 1 ||
    !/^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/i.test(media[0])
  ) {
    return false
  }
  return (
    lines.some((line) => line.startsWith('a=ice-ufrag:')) &&
    lines.some((line) => line.startsWith('a=ice-pwd:')) &&
    lines.some((line) => line.toLowerCase().startsWith('a=fingerprint:sha-256 ')) &&
    lines.some((line) => /^a=setup:(actpass|active|passive)$/.test(line))
  )
}

function extractCompactFields(sdp: string): CompactFields {
  if (!isDataChannelSdp(sdp)) {
    throw new Error('The SDP is not a data-channel-only description.')
  }
  const lines = sdp.split(/\r?\n/)
  const ufragLine = lines.find((line) => line.startsWith('a=ice-ufrag:'))
  const pwdLine = lines.find((line) => line.startsWith('a=ice-pwd:'))
  const setupLine = lines.find((line) => line.startsWith('a=setup:'))
  if (!ufragLine || !pwdLine || !setupLine) throw new Error('The SDP is missing ICE fields.')

  const ufrag = ufragLine.slice('a=ice-ufrag:'.length).trim()
  const pwd = pwdLine.slice('a=ice-pwd:'.length).trim()
  const setup = setupLine.slice('a=setup:'.length).trim() as SetupRole
  if (!validIceValue(ufrag, 1, 64)) throw new Error('The ICE ufrag is invalid.')
  if (!validIceValue(pwd, 1, 128)) throw new Error('The ICE password is invalid.')
  if (!(setup in SETUP_TO_CODE)) throw new Error('The DTLS setup role is invalid.')

  const candidates: HostCandidate[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    if (!line.startsWith('a=candidate:')) continue
    const parts = line.trim().split(/\s+/)
    if (parts.length < 8) continue
    if (parts[1] !== '1' || parts[2].toLowerCase() !== 'udp') continue
    if (parts[6] !== 'typ' || parts[7] !== 'host') continue
    const host = parts[4]
    const port = Number(parts[5])
    if (!validHost(host) || !Number.isInteger(port) || port < 1 || port > 0xffff) continue
    const key = `${host}:${port}`
    if (seen.has(key)) continue
    seen.add(key)
    candidates.push({ host, port })
  }
  if (candidates.length === 0) throw new Error('The SDP has no usable host candidate.')
  candidates.sort((a, b) => candidateRank(a) - candidateRank(b))
  return {
    ufrag,
    pwd,
    fingerprint: parseFingerprint(lines),
    setup,
    candidates: candidates.slice(0, 2),
  }
}

function buildDataChannelSdp(fields: CompactFields): string {
  const candidateLines = fields.candidates.map(
    (candidate, index) =>
      `a=candidate:${index + 1} 1 udp 2113937151 ${candidate.host} ${candidate.port} typ host generation 0 network-cost 999`
  )
  return [
    'v=0',
    'o=- 0 0 IN IP4 127.0.0.1',
    's=-',
    't=0 0',
    'a=group:BUNDLE 0',
    'a=extmap-allow-mixed',
    'a=msid-semantic: WMS',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'c=IN IP4 0.0.0.0',
    ...candidateLines,
    `a=ice-ufrag:${fields.ufrag}`,
    `a=ice-pwd:${fields.pwd}`,
    'a=ice-options:trickle',
    `a=fingerprint:sha-256 ${formatFingerprint(fields.fingerprint)}`,
    `a=setup:${fields.setup}`,
    'a=mid:0',
    'a=sctp-port:5000',
    'a=max-message-size:262144',
    '',
  ].join('\r\n')
}

function encodeCompact(kind: SignalKind, expiresAt: number, fields: CompactFields): Uint8Array {
  const writer = new ByteWriter()
  writer.u8(1)
  writer.u8(KIND_TO_CODE[kind])
  writer.u32(Math.floor(expiresAt / 1000))
  writer.u8(SETUP_TO_CODE[fields.setup])
  writer.string(fields.ufrag)
  writer.string(fields.pwd)
  writer.raw(fields.fingerprint)
  writer.u8(fields.candidates.length)
  for (const candidate of fields.candidates) {
    writer.string(candidate.host)
    writer.u16(candidate.port)
  }
  return writer.finish()
}

function decodeCompact(bytes: Uint8Array, now: number): CompactDecodeResult {
  try {
    const reader = new ByteReader(bytes)
    if (reader.u8() !== 1) return { ok: false, reason: 'invalid-payload' }
    const kind = CODE_TO_KIND[reader.u8()]
    const expiresAt = reader.u32() * 1000
    const setup = CODE_TO_SETUP[reader.u8()]
    const ufrag = reader.string()
    const pwd = reader.string()
    const fingerprint = reader.raw(32)
    const candidateCount = reader.u8()

    if (!kind || !setup) return { ok: false, reason: 'invalid-payload' }
    if (!validIceValue(ufrag, 1, 64) || !validIceValue(pwd, 1, 128)) {
      return { ok: false, reason: 'invalid-payload' }
    }
    if (fingerprint.length !== 32) return { ok: false, reason: 'invalid-payload' }
    if (candidateCount < 1 || candidateCount > 2) return { ok: false, reason: 'invalid-payload' }

    const candidates: HostCandidate[] = []
    for (let i = 0; i < candidateCount; i++) {
      const host = reader.string()
      const port = reader.u16()
      if (!validHost(host) || port < 1) return { ok: false, reason: 'invalid-payload' }
      candidates.push({ host, port })
    }
    if (reader.remaining !== 0) return { ok: false, reason: 'invalid-payload' }
    if (expiresAt <= now) return { ok: false, reason: 'expired' }

    return { ok: true, kind, expiresAt, fields: { ufrag, pwd, fingerprint, setup, candidates } }
  } catch {
    return { ok: false, reason: 'invalid-payload' }
  }
}

async function encodeFallback(
  kind: SignalKind,
  sdp: string,
  expiresAt: number
): Promise<Uint8Array> {
  if (!isDataChannelSdp(sdp)) throw new Error('The SDP is not a data-channel-only description.')
  const compressed = await deflate(encoder.encode(sdp))
  const writer = new ByteWriter()
  writer.u8(2)
  writer.u8(KIND_TO_CODE[kind])
  writer.u32(Math.floor(expiresAt / 1000))
  writer.u8(compressed.flag === 'z' ? 1 : 0)
  writer.raw(compressed.bytes)
  return writer.finish()
}

function chunkPayload(bytes: Uint8Array, expiresAt: number): EncodedSignal {
  const data = bytesToBase64Url(bytes)
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

export async function encodeSignal(
  kind: SignalKind,
  sdp: string,
  now = Date.now()
): Promise<EncodedSignal> {
  if (!sdp) throw new Error('Cannot encode an empty SDP.')
  if (sdp.length > MAX_SDP_CHARS) throw new Error('The pairing SDP is too large.')

  const expiresAt = now + SIGNAL_TTL_MS
  let bytes: Uint8Array
  try {
    const fields = extractCompactFields(sdp)
    const compact = encodeCompact(kind, expiresAt, fields)
    const roundTrip = decodeCompact(compact, now)
    if (!roundTrip.ok) throw new Error('The compact payload did not round-trip.')
    bytes = compact
  } catch {
    bytes = await encodeFallback(kind, sdp, expiresAt)
  }
  return chunkPayload(bytes, expiresAt)
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

  let bytes: Uint8Array
  try {
    bytes = base64UrlToBytes(joined.data)
  } catch {
    return { ok: false, reason: 'invalid-payload' }
  }
  if (bytes.length === 0) return { ok: false, reason: 'invalid-payload' }

  const version = bytes[0]
  if (version === 1) {
    const compact = decodeCompact(bytes, now)
    if (!compact.ok) return { ok: false, reason: compact.reason }
    return {
      ok: true,
      payload: {
        v: 1,
        kind: compact.kind,
        sdp: buildDataChannelSdp(compact.fields),
        createdAt: compact.expiresAt - SIGNAL_TTL_MS,
        expiresAt: compact.expiresAt,
      },
    }
  }

  if (version === 2) {
    try {
      const reader = new ByteReader(bytes)
      reader.u8()
      const kind = CODE_TO_KIND[reader.u8()]
      const expiresAt = reader.u32() * 1000
      const compression = reader.u8()
      const compressed = reader.raw(reader.remaining)
      if (!kind) return { ok: false, reason: 'invalid-payload' }
      if (expiresAt <= now) return { ok: false, reason: 'expired' }
      const sdpBytes = await inflate(compression, compressed)
      if (!sdpBytes) return { ok: false, reason: 'decompression' }
      const sdp = decoder.decode(sdpBytes)
      if (!isDataChannelSdp(sdp)) return { ok: false, reason: 'invalid-payload' }
      return {
        ok: true,
        payload: {
          v: 2,
          kind,
          sdp,
          createdAt: expiresAt - SIGNAL_TTL_MS,
          expiresAt,
        },
      }
    } catch {
      return { ok: false, reason: 'invalid-payload' }
    }
  }

  return { ok: false, reason: 'invalid-payload' }
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
