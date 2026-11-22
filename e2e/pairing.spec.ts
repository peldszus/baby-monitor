import { expect, test } from '@playwright/test'

test.describe('pairing', () => {
  test('child and parent connect, exchange media and ping', async ({ browser }) => {
    test.setTimeout(150_000)

    const childContext = await browser.newContext({ permissions: ['camera', 'microphone'] })
    const parentContext = await browser.newContext({ permissions: ['camera', 'microphone'] })

    try {
      const child = await childContext.newPage()
      const parent = await parentContext.newPage()

      await child.goto('/#/child')
      await child.getByTestId('start-child').click()

      const offerBox = child.getByTestId('offer-text').getByRole('textbox')
      await expect.poll(() => offerBox.inputValue(), { timeout: 45_000 }).not.toBe('')
      const offer = await offerBox.inputValue()
      expect(offer).toContain('BM1|')
      await expect(child.getByTestId('qr-code')).toBeVisible()
      await expect(child.getByTestId('qr-expiry')).toHaveText(/Valid for \d+s/)

      await parent.goto('/#/parent')
      await parent.getByTestId('paste-input').getByRole('textbox').fill(offer)
      await parent.getByTestId('submit-offer').click()

      const answerBox = parent.getByTestId('answer-text').getByRole('textbox')
      await expect.poll(() => answerBox.inputValue(), { timeout: 45_000 }).not.toBe('')
      const answer = await answerBox.inputValue()
      await expect(parent.getByTestId('qr-code')).toBeVisible()

      await child.getByTestId('paste-input').getByRole('textbox').fill(answer)
      await child.getByTestId('submit-answer').click()

      await expect(child.getByTestId('connection-state')).toHaveText('Connected', {
        timeout: 45_000,
      })
      await expect(parent.getByTestId('connection-state')).toHaveText('Connected', {
        timeout: 45_000,
      })

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

      await expect(child.getByTestId('send-ping')).toBeEnabled()
      await child.getByTestId('send-ping').click()
      await expect(child.getByTestId('rtt')).toHaveText(/\d+ ms/)
    } finally {
      await childContext.close()
      await parentContext.close()
    }
  })
})
