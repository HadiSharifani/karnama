import { describe, expect, it } from 'vitest'
import { isTrustedIpcSender, isTrustedOrigin } from '../../src/main/security/trusted-sender'

describe('IPC sender validation', () => {
  it('accepts only the expected resource origin', () => {
    expect(isTrustedOrigin('app://karnama/index.html', 'app://karnama')).toBe(true)
    expect(isTrustedOrigin('https://karnama.example/', 'app://karnama')).toBe(false)
    expect(isTrustedOrigin('not-a-url', 'app://karnama')).toBe(false)
  })

  it('accepts only the primary frame of the expected application window', () => {
    const sender = {}
    const frame = { url: 'app://karnama/index.html' }

    expect(
      isTrustedIpcSender({
        sender,
        expectedSender: sender,
        frame,
        mainFrame: frame,
        expectedOrigin: 'app://karnama'
      })
    ).toBe(true)
  })

  it('rejects other windows, child frames, and foreign origins', () => {
    const sender = {}
    const otherSender = {}
    const mainFrame = { url: 'app://karnama/index.html' }

    expect(
      isTrustedIpcSender({
        sender: otherSender,
        expectedSender: sender,
        frame: mainFrame,
        mainFrame,
        expectedOrigin: 'app://karnama'
      })
    ).toBe(false)
    expect(
      isTrustedIpcSender({
        sender,
        expectedSender: sender,
        frame: { url: 'app://karnama/iframe.html' },
        mainFrame,
        expectedOrigin: 'app://karnama'
      })
    ).toBe(false)
    expect(
      isTrustedIpcSender({
        sender,
        expectedSender: sender,
        frame: { url: 'https://example.com/' },
        mainFrame: { url: 'https://example.com/' },
        expectedOrigin: 'app://karnama'
      })
    ).toBe(false)
  })
})
