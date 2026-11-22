export type TimerAction =
  | { type: 'start'; taskId: string | null }
  | { type: 'pause'; runId: string }
  | { type: 'resume'; runId: string }
  | { type: 'stop'; runId: string }
  | { type: 'review-recovery'; runId: string; decision: 'accept' | 'discard' }
