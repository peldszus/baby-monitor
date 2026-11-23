import { expect, test, type Page } from '@playwright/test'

async function expectNoScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const element = document.scrollingElement ?? document.documentElement
    return element.scrollHeight - element.clientHeight
  })
  expect(overflow).toBeLessThanOrEqual(1)
}

test.describe('pairing', () => {
  test('child and parent connect, exchange media and ping', async ({ browser }) => {
    test.setTimeout(150_000)

    const childContext = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const parentContext = await browser.newContext({ permissions: ['camera', 'microphone'] })

    try {
      const child = await childContext.newPage()
      const parent = await parentContext.newPage()

      await child.goto('/#/child')
      await expect(child.getByTestId('step-1')).toHaveAttribute('aria-current', 'step')
      await child.getByTestId('start-child').click()

      await expect(child.getByTestId('step-1')).toHaveClass(/done/)
      await expect(child.getByTestId('step-2')).toHaveAttribute('aria-current', 'step')
      await child.getByText('Show text code instead').click()
      const offerBox = child.getByTestId('offer-text').getByRole('textbox')
      await expect.poll(() => offerBox.inputValue(), { timeout: 45_000 }).not.toBe('')
      const offer = await offerBox.inputValue()
      expect(offer).toContain('BM1|')
      expect(offer.split(/\s+/).filter(Boolean)).toHaveLength(1)
      expect(offer.length).toBeLessThan(400)
      await expect(child.getByTestId('qr-code')).toBeVisible()
      await expect(child.getByTestId('qr-expiry')).toHaveText(/Valid for \d+s/)

      await parent.goto('/#/parent')
      await expect(parent.getByTestId('step-1')).toHaveAttribute('aria-current', 'step')
      await parent.getByText('Enter text code instead').click()
      await parent.getByTestId('paste-input').getByRole('textbox').fill(offer)
      await parent.getByTestId('submit-offer').click()

      await expect(parent.getByTestId('step-1')).toHaveClass(/done/)
      await expect(parent.getByTestId('step-2')).toHaveAttribute('aria-current', 'step')
      await parent.getByText('Show text code instead').click()
      const answerBox = parent.getByTestId('answer-text').getByRole('textbox')
      await expect.poll(() => answerBox.inputValue(), { timeout: 45_000 }).not.toBe('')
      const answer = await answerBox.inputValue()
      expect(answer.split(/\s+/).filter(Boolean)).toHaveLength(1)
      expect(answer.length).toBeLessThan(400)
      await expect(parent.getByTestId('qr-code')).toBeVisible()

      await child.getByText('Enter answer manually').click()
      await expect(child.getByTestId('qr-code')).toHaveCount(0)
      await expect(child.getByTestId('answer-mode')).toBeVisible()
      await expect(child.getByTestId('show-child-code')).toBeVisible()
      await child.getByTestId('paste-input').getByRole('textbox').fill(answer)
      await child.getByTestId('submit-answer').click()

      await expect(child.getByTestId('connection-state')).toHaveText('Connected', {
        timeout: 45_000,
      })
      await expect(parent.getByTestId('connection-state')).toHaveText('Connected', {
        timeout: 45_000,
      })
      await expect(parent.getByTestId('rtt')).toHaveText(/\d+ ms/, { timeout: 30_000 })
      await expect(child.getByTestId('rtt')).toHaveText(/\d+ ms/, { timeout: 30_000 })
      await expect(parent.getByTestId('send-ping')).toHaveCount(0)
      await expect(child.getByTestId('send-ping')).toHaveCount(0)

      const remoteVideo = parent.getByTestId('remote-video')
      await expect
        .poll(() => remoteVideo.evaluate((element) => (element as HTMLVideoElement).videoWidth), {
          timeout: 45_000,
        })
        .toBeGreaterThan(0)

      await expect(child.getByTestId('short-code')).toHaveText(/^\d{6}$/)
      await expect(parent.getByTestId('short-code')).toHaveText(/^\d{6}$/)
      expect(await parent.getByTestId('short-code').textContent()).toBe(
        await child.getByTestId('short-code').textContent()
      )

      const mediaStatus = parent.getByTestId('media-status')
      const audioStatus = parent.getByTestId('audio-status')
      await expect(mediaStatus).toContainText('Video on')
      await expect(audioStatus).toContainText('Mic on')

      const videoToggle = parent.getByTestId('video-toggle').locator('input')
      await videoToggle.click()
      await expect(mediaStatus).toContainText('Video off')
      expect(
        await child
          .getByTestId('local-video')
          .evaluate((element) => (element as HTMLVideoElement).srcObject?.getVideoTracks().length)
      ).toBe(0)
      await videoToggle.click()
      await expect(mediaStatus).toContainText('Video on')
      await expect
        .poll(() => remoteVideo.evaluate((element) => (element as HTMLVideoElement).videoWidth))
        .toBeGreaterThan(0)

      const audioToggle = parent.getByTestId('audio-toggle').locator('input')
      await audioToggle.click()
      await expect(audioStatus).toContainText('Mic off')
      expect(
        await child
          .getByTestId('local-video')
          .evaluate((element) => (element as HTMLVideoElement).srcObject?.getAudioTracks().length)
      ).toBe(0)
      await audioToggle.click()
      await expect(audioStatus).toContainText('Mic on')
      expect(
        await child
          .getByTestId('local-video')
          .evaluate((element) => (element as HTMLVideoElement).srcObject?.getAudioTracks().length)
      ).toBe(1)

      await parent.getByTestId('fps-5').click()
      // Measured fps is rounded from a one-second sample, so allow 3-7 for a
      // 5 fps target instead of requiring an exact count.
      await expect(mediaStatus).toContainText(/[3-7] fps/)

      await parent.getByTestId('resolution-2').click()
      await expect(mediaStatus).toContainText('640×360')

      await parent.getByTestId('bitrate-250000').click()
      await expect
        .poll(
          async () => {
            const match = (await mediaStatus.innerText()).match(/(\d+) kbps/)
            return match ? Number(match[1]) : 0
          },
          { timeout: 30_000 }
        )
        .toBeGreaterThan(0)

      const noiseToggle = parent.getByTestId('noise-toggle').locator('input')
      await noiseToggle.click()
      await expect(audioStatus).toContainText('NS on')
      const autoGainToggle = parent.getByTestId('auto-gain-toggle').locator('input')
      await autoGainToggle.click()
      await expect(audioStatus).toContainText('AGC on')

      const gain = parent.getByTestId('gain-slider').getByRole('slider')
      await gain.focus()
      await gain.press('End')
      await expect(audioStatus).toContainText('gain 4.0')

      const volume = parent.getByTestId('volume-slider').getByRole('slider')
      await volume.focus()
      await volume.press('Home')
      await expect
        .poll(() => remoteVideo.evaluate((element) => (element as HTMLVideoElement).volume))
        .toBe(0)

      const stage = parent.getByTestId('presentation-stage')
      await expect(stage).toHaveAttribute('data-rotation', '0')
      await parent.getByTestId('rotate-right').click()
      await expect(stage).toHaveAttribute('data-rotation', '90')
      await expect(parent.getByTestId('presentation-canvas')).toBeVisible()

      const zoom = parent.getByTestId('zoom-slider').getByRole('slider')
      await zoom.focus()
      await zoom.press('End')
      await expect(stage).toHaveAttribute('data-zoom', '4.00')

      const box = await stage.boundingBox()
      if (!box) throw new Error('Presentation stage has no bounding box.')
      await parent.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await parent.mouse.down()
      await parent.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 })
      await parent.mouse.up()
      await expect(stage).not.toHaveAttribute('data-pan-x', '0.000')

      await expect(stage).toHaveAttribute('data-pip', 'none')
      await parent.getByTestId('pip-button').click()
      await expect(stage).toHaveAttribute('data-pip', 'canvas', { timeout: 15_000 })
      await parent.getByTestId('pip-button').click()
      await expect(stage).toHaveAttribute('data-pip', 'none')

      await parent.getByTestId('reset-presentation').click()
      await expect(stage).toHaveAttribute('data-rotation', '0')
      await expect(stage).toHaveAttribute('data-zoom', '1.00')
      await expect(stage).toHaveAttribute('data-pan-x', '0.000')
      await expect(parent.getByTestId('presentation-canvas')).toBeHidden()

      await parent.getByTestId('pip-button').click()
      await expect(stage).toHaveAttribute('data-pip', 'standard', { timeout: 15_000 })
      await parent.getByTestId('pip-button').click()
      await expect(stage).toHaveAttribute('data-pip', 'none')

      const darkToggle = parent.getByTestId('screen-dark-toggle').locator('input')
      await darkToggle.click()
      await expect(child.getByTestId('dark-screen')).toBeVisible({ timeout: 15_000 })
      await expect(parent.getByTestId('screen-status')).toHaveText('Child screen dark')
      await child.getByTestId('dark-screen').dblclick()
      await expect(child.getByTestId('dark-screen')).toHaveCount(0)
      await expect(parent.getByTestId('screen-status')).toHaveText('Child screen on')

      await expect(parent.getByTestId('error')).toHaveCount(0)
      await expect(child.getByTestId('error')).toHaveCount(0)
    } finally {
      await childContext.close()
      await parentContext.close()
    }
  })

  test('parent raises an alarm when the child connection disappears', async ({ browser }) => {
    test.setTimeout(120_000)

    const childContext = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const parentContext = await browser.newContext({ permissions: ['camera', 'microphone'] })

    await parentContext.addInitScript(() => {
      const sentinel = {
        released: false,
        addEventListener: () => undefined,
        release: async () => {
          sentinel.released = true
          ;(window as unknown as { __wakeLockReleased?: boolean }).__wakeLockReleased = true
        },
      }
      Object.defineProperty(navigator, 'wakeLock', {
        configurable: true,
        value: {
          request: async () => {
            const state = window as unknown as { __wakeLockRequests?: number }
            state.__wakeLockRequests = (state.__wakeLockRequests ?? 0) + 1
            return sentinel
          },
        },
      })
    })

    try {
      const child = await childContext.newPage()
      const parent = await parentContext.newPage()

      await child.goto('/#/child')
      await child.getByTestId('start-child').click()
      await child.getByText('Show text code instead').click()
      const offerBox = child.getByTestId('offer-text').getByRole('textbox')
      await expect.poll(() => offerBox.inputValue(), { timeout: 45_000 }).not.toBe('')
      const offer = await offerBox.inputValue()

      await parent.goto('/#/parent')
      await parent.getByText('Enter text code instead').click()
      await parent.getByTestId('paste-input').getByRole('textbox').fill(offer)
      await parent.getByTestId('submit-offer').click()
      await parent.getByText('Show text code instead').click()
      const answerBox = parent.getByTestId('answer-text').getByRole('textbox')
      await expect.poll(() => answerBox.inputValue(), { timeout: 45_000 }).not.toBe('')
      const answer = await answerBox.inputValue()

      await child.getByText('Enter answer manually').click()
      await expect(child.getByTestId('qr-code')).toHaveCount(0)
      await expect(child.getByTestId('answer-mode')).toBeVisible()
      await expect(child.getByTestId('show-child-code')).toBeVisible()
      await child.getByTestId('paste-input').getByRole('textbox').fill(answer)
      await child.getByTestId('submit-answer').click()

      await expect(parent.getByTestId('connection-state')).toHaveText('Connected', {
        timeout: 45_000,
      })
      await expect(parent.getByTestId('rtt')).toHaveText(/\d+ ms/, { timeout: 30_000 })
      await expect(parent.getByTestId('alarm-overlay')).toHaveCount(0)

      await childContext.close()

      await expect(parent.getByTestId('alarm-overlay')).toBeVisible({ timeout: 15_000 })
      expect(
        await parent.evaluate(
          () => (window as unknown as { __wakeLockRequests?: number }).__wakeLockRequests ?? 0
        )
      ).toBeGreaterThan(0)
      expect(
        await parent.evaluate(
          () => (window as unknown as { __wakeLockReleased?: boolean }).__wakeLockReleased ?? false
        )
      ).toBe(false)

      await parent.getByTestId('alarm-silence').click()
      await expect(parent.getByTestId('alarm-muted')).toBeVisible()
      await parent.getByTestId('alarm-stop').click()
      await expect(parent.getByTestId('alarm-overlay')).toHaveCount(0)
      await expect
        .poll(() =>
          parent.evaluate(
            () =>
              (window as unknown as { __wakeLockReleased?: boolean }).__wakeLockReleased ?? false
          )
        )
        .toBe(true)
    } finally {
      await childContext.close()
      await parentContext.close()
    }
  })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 360, height: 640 },
    { width: 320, height: 568 },
  ]) {
    test(`pairing fits without scrolling at ${viewport.width}x${viewport.height}`, async ({
      browser,
    }) => {
      test.setTimeout(120_000)
      const childContext = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport,
      })
      const parentContext = await browser.newContext({
        permissions: ['camera', 'microphone'],
        viewport,
      })

      try {
        const child = await childContext.newPage()
        const parent = await parentContext.newPage()

        await child.goto('/#/child')
        await expectNoScroll(child)
        await child.getByTestId('start-child').click()
        await expect(child.getByTestId('qr-code')).toBeVisible({ timeout: 45_000 })
        await expectNoScroll(child)

        await parent.goto('/#/parent')
        await expectNoScroll(parent)
        await parent.getByText('Enter text code instead').click()
        await child.getByText('Show text code instead').click()
        const offer = await child.getByTestId('offer-text').getByRole('textbox').inputValue()
        await parent.getByTestId('paste-input').getByRole('textbox').fill(offer)
        await parent.getByTestId('submit-offer').click()

        await expect(parent.getByTestId('qr-code')).toBeVisible({ timeout: 45_000 })
        await expectNoScroll(parent)
        await expect(child.getByTestId('pairing-steps')).toHaveAttribute('data-step', '2')
      } finally {
        await childContext.close()
        await parentContext.close()
      }
    })
  }
})
