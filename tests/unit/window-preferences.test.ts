import { describe, expect, it } from 'vitest'
import { secureWindowPreferences } from '../../src/main/security/window-preferences'

describe('Electron renderer security defaults', () => {
  it('keeps context isolation and renderer sandbox enabled', () => {
    expect(secureWindowPreferences('preload.js')).toEqual({
      preload: 'preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    })
  })
})
