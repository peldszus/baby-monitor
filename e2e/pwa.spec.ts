import { expect, test } from '@playwright/test'

test('serves the PWA shell offline and exposes install metadata', async ({ page, context }) => {
  const externalRequests: string[] = []
  page.on('request', (request) => {
    const url = new URL(request.url())
    if (/^https?:$/.test(url.protocol) && url.origin !== 'http://127.0.0.1:4174') {
      externalRequests.push(request.url())
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Baby Monitor' })).toBeVisible()

  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  expect(csp).toContain("default-src 'self'")
  expect(csp).toContain("object-src 'none'")
  expect(csp).not.toContain('unsafe-eval')
  expect(await page.locator('meta[name="referrer"]').getAttribute('content')).toBe('no-referrer')

  const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifestHref).toBeTruthy()
  const manifest = await page.evaluate(
    async (href) => (await fetch(href)).json(),
    manifestHref as string
  )
  expect(manifest.display).toBe('standalone')
  expect(manifest.icons.some((icon: { sizes: string }) => icon.sizes === '512x512')).toBe(true)
  expect(manifest.icons.some((icon: { purpose?: string }) => icon.purpose === 'maskable')).toBe(
    true
  )

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready
  })
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)), {
      timeout: 30_000,
    })
    .toBe(true)

  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt') as Event & {
      prompt: () => Promise<void>
      userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
    }
    event.prompt = async () => undefined
    event.userChoice = Promise.resolve({ outcome: 'dismissed', platform: 'web' })
    window.dispatchEvent(event)
  })
  await expect(page.getByTestId('install-prompt')).toBeVisible()
  await page.getByTestId('dismiss-install').click()
  await expect(page.getByTestId('install-prompt')).toHaveCount(0)

  await context.setOffline(true)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { name: 'Baby Monitor' })).toBeVisible()
  await expect(page.getByTestId('role-child')).toBeVisible()
  await context.setOffline(false)

  expect(externalRequests).toEqual([])
})
