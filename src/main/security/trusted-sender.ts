export type IpcSenderFrame = { url: string }

export type IpcSenderCheck = {
  sender: unknown
  expectedSender: unknown
  frame: IpcSenderFrame | null
  mainFrame: IpcSenderFrame
  expectedOrigin: string
}

export function isTrustedIpcSender(check: IpcSenderCheck): boolean {
  if (check.sender !== check.expectedSender || !check.frame || check.frame !== check.mainFrame) {
    return false
  }

  try {
    return new URL(check.frame.url).origin === new URL(check.expectedOrigin).origin
  } catch {
    return false
  }
}
