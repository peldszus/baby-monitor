import { expect, test, type Page } from '@playwright/test'

async function expectNoScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => {
    const element = document.scrollingElement ?? document.documentElement
    return element.scrollHeight - element.clientHeight
  })
  expect(overflow).toBeLessThanOrEqual(1)
}

async function pairViaText(child: Page, parent: Page): Promise<void> {
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
  await child.getByTestId('paste-input').getByRole('textbox').fill(answer)
  await child.getByTestId('submit-answer').click()
  await expect(child.getByTestId('connection-state')).toHaveText('Connected', { timeout: 45_000 })
  await expect(parent.getByTestId('connection-state')).toHaveText('Connected', { timeout: 45_000 })
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

      await parent.evaluate(() => {
        const state = { draws: 0 }
        Object.defineProperty(window, '__canvasDraws', { value: state, configurable: true })
        const proto = CanvasRenderingContext2D.prototype
        const original = proto.drawImage
        proto.drawImage = function (this: CanvasRenderingContext2D, ...args: unknown[]) {
          state.draws += 1
          return original.apply(this, args as never)
        }
      })

      const remoteVideo = parent.getByTestId('remote-video')
      await expect
        .poll(() => remoteVideo.evaluate((element) => (element as HTMLVideoElement).videoWidth), {
          timeout: 45_000,
        })
        .toBeGreaterThan(0)

      const localVideo = child.getByTestId('local-video')
      await expect
        .poll(() => localVideo.evaluate((element) => (element as HTMLVideoElement).videoWidth), {
          timeout: 45_000,
        })
        .toBeGreaterThan(0)
      const localStage = localVideo.locator('xpath=..')
      await expect(localStage).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      const localStageBox = await localStage.boundingBox()
      const localVideoBox = await localVideo.boundingBox()
      if (!localStageBox || !localVideoBox) throw new Error('Child preview stage is missing.')
      expect(localStageBox.width).toBeCloseTo(localVideoBox.width, 0)
      expect(localStageBox.height).toBeCloseTo(localVideoBox.height, 0)

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
      await expect(audioStatus).toContainText('gain 10.0')

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
      const canvas = parent.getByTestId('presentation-canvas')
      await expect(canvas).toBeVisible()
      await expect
        .poll(() =>
          canvas.evaluate((element) => [
            (element as HTMLCanvasElement).width,
            (element as HTMLCanvasElement).height,
          ])
        )
        .toEqual([180, 320])
      const canvasBox = await canvas.boundingBox()
      if (!canvasBox) throw new Error('Presentation canvas has no bounding box.')
      expect(canvasBox.width / canvasBox.height).toBeCloseTo(180 / 320, 2)

      await remoteVideo.evaluate((element) => {
        Object.defineProperty(element, 'videoWidth', { configurable: true, get: () => 180 })
        Object.defineProperty(element, 'videoHeight', { configurable: true, get: () => 320 })
      })
      await expect
        .poll(() =>
          canvas.evaluate((element) => [
            (element as HTMLCanvasElement).width,
            (element as HTMLCanvasElement).height,
          ])
        )
        .toEqual([320, 180])
      await remoteVideo.evaluate((element) => {
        Reflect.deleteProperty(element, 'videoWidth')
        Reflect.deleteProperty(element, 'videoHeight')
      })
      await expect
        .poll(() =>
          canvas.evaluate((element) => [
            (element as HTMLCanvasElement).width,
            (element as HTMLCanvasElement).height,
          ])
        )
        .toEqual([180, 320])

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

      const drawsBefore = await parent.evaluate(
        () => (window as unknown as { __canvasDraws: { draws: number } }).__canvasDraws.draws
      )
      await parent.evaluate(() => {
        Object.defineProperty(document, 'visibilityState', {
          configurable: true,
          get: () => 'hidden',
        })
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expect
        .poll(
          () =>
            parent.evaluate(
              () => (window as unknown as { __canvasDraws: { draws: number } }).__canvasDraws.draws
            ),
          { timeout: 10_000 }
        )
        .toBeGreaterThan(drawsBefore + 2)
      await parent.evaluate(() => {
        delete (document as unknown as { visibilityState?: string }).visibilityState
        document.dispatchEvent(new Event('visibilitychange'))
      })
      await expect(stage).toHaveAttribute('data-pip', 'canvas')

      await parent.getByTestId('pip-button').click()
      await expect(stage).toHaveAttribute('data-pip', 'none')

      await parent.getByTestId('reset-presentation').click()
      await expect(stage).toHaveAttribute('data-rotation', '0')
      await expect(stage).toHaveAttribute('data-zoom', '1.00')
      await expect(stage).toHaveAttribute('data-pan-x', '0.000')
      await expect(parent.getByTestId('presentation-canvas')).toBeHidden()

      await expect(stage).toHaveAttribute('data-fullscreen', 'false')
      await expect(stage).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      const normalStageBox = await stage.boundingBox()
      const normalVideoBox = await remoteVideo.boundingBox()
      if (!normalStageBox || !normalVideoBox) throw new Error('Video stage is missing.')
      expect(normalStageBox.width).toBeCloseTo(normalVideoBox.width, 0)
      expect(normalStageBox.height).toBeCloseTo(normalVideoBox.height, 0)
      await parent.getByTestId('fullscreen-button').click()
      await expect(stage).toHaveAttribute('data-fullscreen', 'true')
      await expect(stage).toHaveCSS('background-color', 'rgb(0, 0, 0)')
      await expect(parent.getByTestId('fullscreen-button')).toHaveAttribute('aria-pressed', 'true')
      await expect(parent.getByTestId('fullscreen-exit')).toBeVisible()
      await parent.getByTestId('fullscreen-exit').click()
      await expect(stage).toHaveAttribute('data-fullscreen', 'false')
      await expect(stage).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)')
      await expect(parent.getByTestId('fullscreen-button')).toHaveAttribute('aria-pressed', 'false')

      await parent.getByTestId('rotate-right').click()
      await expect(stage).toHaveAttribute('data-rotation', '90')
      await parent.getByTestId('fullscreen-button').click()
      await expect(stage).toHaveAttribute('data-fullscreen', 'true')
      await expect(parent.getByTestId('presentation-canvas')).toBeVisible()
      await expect(remoteVideo).toHaveCSS('visibility', 'hidden')
      await parent.getByTestId('fullscreen-exit').click()
      await expect(stage).toHaveAttribute('data-fullscreen', 'false')
      await parent.getByTestId('reset-presentation').click()
      await expect(stage).toHaveAttribute('data-rotation', '0')

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

      await parent.getByText('Stop monitoring').click()
      await expect(parent.getByTestId('role-child')).toBeVisible()
      await expect(parent).toHaveURL(/#\/$/)
      await expect(child).toHaveURL(/#\/$/)
      await expect(child.getByTestId('app-notice')).toContainText(
        /The parent device ended the stream at /
      )
      await expect(child.getByTestId('error')).toHaveCount(0)
    } finally {
      await childContext.close()
      await parentContext.close()
    }
  })

  test('parent pagehide ends the child session without an error', async ({ browser }) => {
    test.setTimeout(120_000)

    const childContext = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const parentContext = await browser.newContext({ permissions: ['camera', 'microphone'] })

    try {
      const child = await childContext.newPage()
      const parent = await parentContext.newPage()

      await child.goto('/#/child')
      await child.getByTestId('start-child').click()
      await expect(child.getByTestId('qr-code')).toBeVisible({ timeout: 45_000 })
      await child.getByText('Show text code instead').click()
      const offer = await child.getByTestId('offer-text').getByRole('textbox').inputValue()

      await parent.goto('/#/parent')
      await parent.getByText('Enter text code instead').click()
      await parent.getByTestId('paste-input').getByRole('textbox').fill(offer)
      await parent.getByTestId('submit-offer').click()
      await expect(parent.getByTestId('qr-code')).toBeVisible({ timeout: 45_000 })
      await parent.getByText('Show text code instead').click()

      await child.getByText('Enter answer manually').click()
      const answerBox = parent.getByTestId('answer-text').getByRole('textbox')
      await expect.poll(() => answerBox.inputValue(), { timeout: 45_000 }).not.toBe('')
      const answer = await answerBox.inputValue()
      await child.getByTestId('paste-input').getByRole('textbox').fill(answer)
      await child.getByTestId('submit-answer').click()
      await expect(child.getByTestId('connection-state')).toHaveText('Connected', {
        timeout: 45_000,
      })
      await expect(parent.getByTestId('connection-state')).toHaveText('Connected', {
        timeout: 45_000,
      })

      await parent.evaluate(() => window.dispatchEvent(new Event('pagehide')))
      await expect(child).toHaveURL(/#\/$/, { timeout: 10_000 })
      await expect(child.getByTestId('app-notice')).toContainText(
        /The parent device ended the stream at /
      )
      await expect(child.getByTestId('error')).toHaveCount(0)
    } finally {
      await childContext.close()
      await parentContext.close()
    }
  })

  test('child stop returns both devices home with a notice', async ({ browser }) => {
    test.setTimeout(120_000)

    const childContext = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const parentContext = await browser.newContext({ permissions: ['camera', 'microphone'] })

    try {
      const child = await childContext.newPage()
      const parent = await parentContext.newPage()
      await pairViaText(child, parent)

      await child.getByText('Stop monitoring').click()
      await expect(child).toHaveURL(/#\/$/)
      await expect(parent).toHaveURL(/#\/$/)
      await expect(parent.getByTestId('app-notice')).toContainText(
        /The child device ended the stream at /
      )
      await expect(parent.getByTestId('alarm-overlay')).toHaveCount(0)
      await expect(parent.getByTestId('error')).toHaveCount(0)
    } finally {
      await childContext.close()
      await parentContext.close()
    }
  })

  test('child pagehide ends the parent session without an error', async ({ browser }) => {
    test.setTimeout(120_000)

    const childContext = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const parentContext = await browser.newContext({ permissions: ['camera', 'microphone'] })

    try {
      const child = await childContext.newPage()
      const parent = await parentContext.newPage()
      await pairViaText(child, parent)

      await child.evaluate(() => window.dispatchEvent(new Event('pagehide')))
      await expect(parent).toHaveURL(/#\/$/, { timeout: 10_000 })
      await expect(parent.getByTestId('app-notice')).toContainText(
        /The child device ended the stream at /
      )
      await expect(parent.getByTestId('alarm-overlay')).toHaveCount(0)
      await expect(parent.getByTestId('error')).toHaveCount(0)
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
      await expect(parent.getByTestId('role-child')).toBeVisible()
      await expect(parent).toHaveURL(/#\/$/)
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
