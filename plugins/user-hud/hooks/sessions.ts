// Pure session logic: a status file of `~/.claude/sessions/` read into a session, the titles its transcript
// holds, and every live session filed under what it needs from the person.
import type { SessionGroup, SessionInfo, SessionStatus, Sessions } from '../types'

/** An idle session finished within this long is done; longer, it is asleep. */
export const DONE_MS = 8 * 3_600_000

export const TITLE_MAX = 30

export const SESSION_GROUPS: readonly SessionGroup[] = ['needs', 'working', 'done', 'asleep']

export const EMPTY_SESSIONS: Sessions = { self: null, byGroup: { needs: [], working: [], done: [], asleep: [] }, readAt: 0 }

export type SessionFile = {
  pid: number
  sessionId: string
  status: SessionStatus
  name: string | null
  isUserName: boolean
  entry: 'cli' | 'app'
  statusAt: number
}

const STATUSES: readonly SessionStatus[] = ['busy', 'waiting', 'idle']

/** A session id as the engine mints one: it names a transcript file, so nothing else is let through. */
const isSessionId = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(v)

/** A status file's text as a session, or null for one unreadable or missing its pid or id. */
export function parseSessionFile(text: string): SessionFile | null {
  let o: Record<string, unknown>
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return null
    o = parsed as Record<string, unknown>
  } catch {
    return null
  }
  if (typeof o.pid !== 'number' || !Number.isInteger(o.pid) || o.pid <= 0 || !isSessionId(o.sessionId)) return null
  return {
    pid: o.pid,
    sessionId: o.sessionId,
    status: STATUSES.find(s => s === o.status) ?? 'idle',
    name: typeof o.name === 'string' && o.name.trim() ? o.name.trim() : null,
    isUserName: o.nameSource === 'user',
    entry: o.entrypoint === 'cli' ? 'cli' : 'app',
    statusAt: typeof o.statusUpdatedAt === 'number' ? o.statusUpdatedAt : 0,
  }
}

/** The pids `ps -o pid=` printed: the ones still running. */
export const livePids = (stdout: string): Set<number> =>
  new Set(
    stdout
      .split('\n')
      .map(l => Number(l.trim()))
      .filter(n => Number.isInteger(n) && n > 0),
  )

/**
 * Prints the last custom-title and the last ai-title row of each session's transcript. Arguments: the
 * projects folder, then the session ids. Transcripts run far past what one file read may copy, so grep reads them.
 */
export const TITLES_SCRIPT = [
  'dir=$1; shift',
  'for id in "$@"; do',
  '  for f in "$dir"/*/"$id".jsonl; do',
  '    [ -f "$f" ] || continue',
  `    grep -E '"type":"custom-title"' "$f" | tail -n 1`,
  `    grep -E '"type":"ai-title"' "$f" | tail -n 1`,
  '  done',
  'done',
].join('\n')

export type Titles = { custom?: string; ai?: string }

/** The titles the script printed, by session id; a row it cannot read is passed over. */
export function parseTitles(stdout: string): Map<string, Titles> {
  const out = new Map<string, Titles>()
  for (const l of stdout.split('\n')) {
    if (!l.trim()) continue
    let o: Record<string, unknown>
    try {
      o = JSON.parse(l) as Record<string, unknown>
    } catch {
      continue
    }
    if (!isSessionId(o.sessionId)) continue
    const t = out.get(o.sessionId) ?? {}
    if (o.type === 'custom-title' && typeof o.customTitle === 'string' && o.customTitle.trim()) t.custom = o.customTitle.trim()
    if (o.type === 'ai-title' && typeof o.aiTitle === 'string' && o.aiTitle.trim()) t.ai = o.aiTitle.trim()
    out.set(o.sessionId, t)
  }
  return out
}

/** `s` in at most `n` characters, the last one `…` when it was cut. */
export const clip = (s: string, n = TITLE_MAX) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/** The name to show: the person's own, then the transcript's custom title, its AI title, then the file's name. */
export function titleOf(f: SessionFile, t: Titles | undefined): string {
  const title = (f.isUserName ? f.name : null) ?? t?.custom ?? t?.ai ?? f.name ?? 'untitled session'
  return clip(title)
}

export function groupOf(s: Pick<SessionInfo, 'status' | 'statusAt'>, now: number): SessionGroup {
  if (s.status === 'waiting') return 'needs'
  if (s.status === 'busy') return 'working'
  return now - s.statusAt <= DONE_MS ? 'done' : 'asleep'
}

/** Every session filed in its group, most recent first; this one (`selfId`) apart, in none. */
export function grouped(list: readonly SessionInfo[], selfId: string | null, now: number): Sessions {
  const byGroup: Sessions['byGroup'] = { needs: [], working: [], done: [], asleep: [] }
  let self: SessionInfo | null = null
  for (const s of [...list].sort((a, b) => b.statusAt - a.statusAt)) {
    if (s.sessionId === selfId) self = s
    else byGroup[groupOf(s, now)].push(s)
  }
  return { self, byGroup, readAt: now }
}

/** `now`, `12m`, `5h`, `5d`: how long since a session's status changed. */
export function ageOf(statusAt: number, now: number): string {
  const m = Math.floor(Math.max(0, now - statusAt) / 60_000)
  return m < 1 ? 'now' : m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`
}
