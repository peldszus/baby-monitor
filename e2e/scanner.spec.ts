import { chromium, expect, test } from '@playwright/test'
import { encode } from 'uqr'
import fs from 'node:fs'

const WIDTH = 640
const HEIGHT = 480
const QR_PIXELS = 420
const FRAMES = 10

function writeQrVideo(file: string, text: string): void {
  const qr = encode(text, { ecc: 'L', border: 2 })
  const scale = Math.max(1, Math.floor(QR_PIXELS / qr.size))
  const qrPixels = qr.size * scale
  const offsetX = Math.floor((WIDTH - qrPixels) / 2)
  const offsetY = Math.floor((HEIGHT - qrPixels) / 2)

  const luma = Buffer.alloc(WIDTH * HEIGHT, 235)
  for (let y = 0; y < qrPixels; y++) {
    for (let x = 0; x < qrPixels; x++) {
      const dark = qr.data[Math.floor(y / scale)][Math.floor(x / scale)]
      luma[(offsetY + y) * WIDTH + offsetX + x] = dark ? 16 : 235
    }
  }

  const chroma = Buffer.alloc((WIDTH / 2) * (HEIGHT / 2), 128)
  const header = Buffer.from(`YUV4MPEG2 W${WIDTH} H${HEIGHT} F30:1 Ip A1:1 C420jpeg\n`)
  const frames: Buffer[] = [header]
  for (let i = 0; i < FRAMES; i++) {
    frames.push(Buffer.from('FRAME\n'), luma, chroma, chroma)
  }
  fs.writeFileSync(file, Buffer.concat(frames))
}

// eslint-disable-next-line no-empty-pattern -- this test launches its own browser
test('scanner reads a QR code automatically and recovers from a broken BarcodeDetector', async ({}, testInfo) => {
  const videoFile = testInfo.outputPath('scanner.y4m')
  writeQrVideo(videoFile, 'HELLO-SCANNER')

  const browser = await chromium.launch({
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      `--use-file-for-fake-video-capture=${videoFile}`,
    ],
  })

  try {
    const context = await browser.newContext({ permissions: ['camera'] })
    const page = await context.newPage()
    await page.addInitScript(() => {
      class BrokenBarcodeDetector {
        static async getSupportedFormats(): Promise<string[]> {
          return ['qr_code']
        }

        async detect(): Promise<never> {
          throw new Error('simulated BarcodeDetector failure')
        }
      }

      Object.defineProperty(globalThis, 'BarcodeDetector', { value: BrokenBarcodeDetector })
    })
    await page.goto('/')

    const result = await page.evaluate(async (): Promise<{ text?: string; reason?: string }> => {
      const { createQrScanner } = await import('/src/core/scanner.ts')
      const video = document.createElement('video')
      video.muted = true
      video.playsInline = true
      document.body.append(video)

      const scanner = createQrScanner()
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          scanner.stop()
          resolve({ reason: 'timeout' })
        }, 15_000)

        scanner
          .start(video, (text) => {
            clearTimeout(timer)
            scanner.stop()
            resolve({ text })
          })
          .catch((error: unknown) => {
            clearTimeout(timer)
            resolve({ reason: String(error) })
          })
      })
    })

    expect(result).toEqual({ text: 'HELLO-SCANNER' })
  } finally {
    await browser.close()
    fs.rmSync(videoFile, { force: true })
  }
})
