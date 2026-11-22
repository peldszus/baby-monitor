import jsQR from 'jsqr'

interface BarcodeDetectorResult {
  rawValue: string
}

interface BarcodeDetectorLike {
  detect(source: HTMLVideoElement): Promise<BarcodeDetectorResult[]>
}

type BarcodeDetectorConstructor = new (options: { formats: string[] }) => BarcodeDetectorLike

export interface QrScanner {
  start(
    video: HTMLVideoElement,
    onResult: (text: string) => void,
    sourceStream?: MediaStream | null
  ): Promise<void>
  stop(): void
}

const DETECT_INTERVAL_MS = 250
const DUPLICATE_WINDOW_MS = 2000

function createBarcodeDetector(): BarcodeDetectorLike | null {
  const Detector = (globalThis as unknown as { BarcodeDetector?: BarcodeDetectorConstructor })
    .BarcodeDetector
  if (!Detector) return null
  try {
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
  let frame = 0
  let lastText = ''
  let lastAt = 0

  function emit(text: string, onResult: (text: string) => void): void {
    const now = Date.now()
    if (text === lastText && now - lastAt < DUPLICATE_WINDOW_MS) return
    lastText = text
    lastAt = now
    onResult(text)
  }

  async function detectWithBarcodeDetector(
    detector: BarcodeDetectorLike,
    video: HTMLVideoElement,
    onResult: (text: string) => void
  ): Promise<void> {
    while (running) {
      if (video.readyState >= 2) {
        try {
          const results = await detector.detect(video)
          const value = results[0]?.rawValue
          if (value) emit(value, onResult)
        } catch {
          // A transient detection failure should not stop the camera.
        }
      }
      await delay(DETECT_INTERVAL_MS)
    }
  }

  function detectWithJsQr(video: HTMLVideoElement, onResult: (text: string) => void): void {
    const canvas = document.createElement('canvas')
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) return

    const tick = () => {
      if (!running) return
      if (video.readyState >= 2 && video.videoWidth > 0) {
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        context.drawImage(video, 0, 0, canvas.width, canvas.height)
        const image = context.getImageData(0, 0, canvas.width, canvas.height)
        const result = jsQR(image.data, image.width, image.height)
        if (result?.data) emit(result.data, onResult)
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }

  return {
    async start(video, onResult, sourceStream) {
      if (running) return

      if (sourceStream) {
        stream = sourceStream
        ownsStream = false
      } else {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error('Camera access is not available in this browser.')
        }
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
          audio: false,
        })
        ownsStream = true
      }

      video.srcObject = stream
      video.muted = true
      video.playsInline = true
      await video.play()
      running = true

      const detector = createBarcodeDetector()
      if (detector) {
        void detectWithBarcodeDetector(detector, video, onResult)
      } else {
        detectWithJsQr(video, onResult)
      }
    },

    stop() {
      running = false
      cancelAnimationFrame(frame)
      if (stream && ownsStream) {
        for (const track of stream.getTracks()) track.stop()
      }
      stream = null
      ownsStream = false
    },
  }
}
