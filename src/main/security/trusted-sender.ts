export type IpcSenderFrame = { url: string }

export type IpcSenderCheck = {
  sender: unknown
  expectedSender: unknown
  frame: IpcSenderFrame | null
  mainFrame: IpcSenderFrame
  expectedOrigin: string
}

export function isTrustedOrigin(value: string, expectedOrigin: string): boolean {
  try {
    return new URL(value).origin === new URL(expectedOrigin).origin
  } catch {
    return false
  }
}

export function isTrustedIpcSender(check: IpcSenderCheck): boolean {
  if (check.sender !== check.expectedSender || !check.frame || check.frame !== check.mainFrame) {
    return false
  }

  return isTrustedOrigin(check.frame.url, check.expectedOrigin)
}
