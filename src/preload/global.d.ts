import type { KarnamaApi } from './index'

declare global {
  interface Window {
    karnama: KarnamaApi
  }
}

export {}
