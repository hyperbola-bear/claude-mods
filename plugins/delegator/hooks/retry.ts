// When a surface's grid is tried again after it fails: a frame may only have stalled. Pure: tests call it directly.

/** The waits before each try. Past the last, the surface keeps its text rows until the plugin reloads. */
export const RETRY_MS = [30_000, 120_000, 600_000] as const

/** A grid that holds this long has recovered: the tries start over. */
export const CALM_MS = 30 * 60_000

export type Retries = { tries: number; at: number }

/** The wait before the next try, or null once the tries are spent, and the count to keep. */
export function nextRetry(last: Retries | undefined, now: number): { wait: number | null; retries: Retries } {
  const tries = last !== undefined && now - last.at < CALM_MS ? last.tries : 0
  return { wait: RETRY_MS[tries] ?? null, retries: { tries: tries + 1, at: now } }
}
