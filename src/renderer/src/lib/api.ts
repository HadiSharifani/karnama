import type { ApiResult } from '@shared/contracts/api'

export function unwrapResult<T>(result: ApiResult<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}
