import { describe, expect, it } from 'vitest'
import { formatRemoteEndNotice } from './notice'

describe('remote end notice', () => {
  it('names the device that ended the stream and includes a timestamp', () => {
    const notice = formatRemoteEndNotice('child', new Date('2026-11-25T22:30:00Z'))
    expect(notice).toMatch(/^The child device ended the stream at .+\.$/)
    expect(notice).not.toContain('Invalid Date')
  })

  it('uses the other role when the parent ends the stream', () => {
    expect(formatRemoteEndNotice('parent', new Date('2026-11-25T22:30:00Z'))).toMatch(
      /^The parent device ended the stream at /
    )
  })
})
