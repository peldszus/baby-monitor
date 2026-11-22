import jsQR from 'jsqr'

interface BarcodeDetectorResult {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>
}

type BarcodeDetectorConstructor = {
  new (options: { formats: string[] }): BarcodeDetectorLike
  getSupportedFormats?: () => Promise<string[]>
}

export interface QrScanner {
  start(
    video: HTMLVideoElement,
    onResult: (text: string) => void,
    sourceStream?: MediaStream | null
  ): Promise<void>
  stop(): void
}

const BARCODE_INTERVAL_MS = 200
const JSQR_INTERVAL_MS = 120
const JSQR_MAX_WIDTH = 960
const BARCODE_EMPTY_LIMIT = 15
const DUPLICATE_WINDOW_MS = 2000

async function createBarcodeDetector(): Promise<BarcodeDetectorLike | null> {
  const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector
  if (!Detector) return null
  try {
    if (typeof Detector.getSupportedFormats === 'function') {
      const formats = await Detector.getSupportedFormats()
      if (!formats.includes('qr_code')) return null
    }
    return new Detector({ formats: ['qr_code'] })
  } catch {
    return null
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createQrScanner(): QrScanner {
  let stream: MediaStream | null = null
  let ownsStream = false
  let running = false
  let generation = 0
  let lastText = ''
  let lastAt = 0

  function emit(text: string, onResult: (text: string) => void): void {
    const now = Date.now()
    if (text === lastText && now - lastAt < DUPLICATE_WINDOW_MS) return
    lastText = text
    lastAt = now
    onResult(text)
  }

  async function detectLoop(
    video: HTMLVideoElement,
    onResult: (text: string) => void,
    detector: BarcodeDetectorLike | null,
    token: number
  ): Promise<void> {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    let useJsQr = !detector || !context
    let emptyRuns = 0

    while (running && token === generation) {
      if (video.readyState >= 2 && video.videoWidth > 0) {
        let value: string | undefined

        if (!useJsQr && detector) {
          try {
            const results = await detector.detect(video)
            value = results[0]?.rawValue
            if (value) emptyRuns = 0
            else if (++emptyRuns >= BARCODE_EMPTY_LIMIT) useJsQr = true
          } catch {
            // Some implementations expose BarcodeDetector but fail on camera
            // frames. Fall back to the JavaScript decoder instead of idling.
            useJsQr = true
          }
        }

        if (useJsQr && context) {
          const scale = Math.min(1, JSQR_MAX_WIDTH / video.videoWidth)
          canvas.width = Math.max(1, Math.round(video.videoWidth * scale))
          canvas.height = Math.max(1, Math.round(video.videoHeight * scale))
          context.drawImage(video, 0, 0, canvas.width, canvas.height)
          const image = context.getImageData(0, 0, canvas.width, canvas.height)
          value = jsQR(image.data, image.width, image.height)?.data
        }

        if (value) emit(value, onResult)
      }

      await delay(useJsQr ? JSQR_INTERVAL_MS : BARCODE_INTERVAL_MS)
    }
  }

  return {
    async start(video, onResult, sourceStream) {
      if (running) return
      const token = ++generation

      if (sourceStream) {
        stream = sourceStream
        ownsStream = false
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available in this browser.')
        }
        const nextStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })
        if (token !== generation) {
          for (const track of nextStream.getTracks()) track.stop()
          return
        }
        stream = nextStream
        ownsStream = true
      }

      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()
      if (token !== generation) {
        if (stream && ownsStream) {
          for (const track of stream.getTracks()) track.stop()
        }
        stream = null
        ownsStream = false
        return
      }
      running = true

      const detector = await createBarcodeDetector()
      if (token !== generation) return
      void detectLoop(video, onResult, detector, token)
    },

    stop() {
      running = false
      generation += 1
      if (stream && ownsStream) {
        for (const track of stream.getTracks()) track.stop()
      }
      stream = null
      ownsStream = false
    },
  }
}
