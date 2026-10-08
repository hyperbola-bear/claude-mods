// Pure handoff logic: where handoff notes live and the prompts around them.
import type { HandoffFile } from '../types'

/** Folders searched for handoff notes, relative to the project root. */
export const HANDOFF_DIRS = ['.', '.claude', '.claude/handoffs', 'handoffs', 'docs', 'docs/handoffs', '.handoff']

/** Markdown files named like a handoff; inside a folder named for handoffs, any markdown file. */
export function isHandoffName(dir: string, name: string): boolean {
  if (!/\.md$/i.test(name)) return false
  return /handoff/i.test(name) || /handoffs?$/i.test(dir)
}

/** Newest first, each path once, at most `max`. */
export function newest(files: readonly HandoffFile[], max = 8): HandoffFile[] {
  const seen = new Set<string>()
  return [...files]
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .filter(f => (seen.has(f.path) ? false : (seen.add(f.path), true)))
    .slice(0, max)
}

export const joinPath = (dir: string, name: string) => (dir === '.' ? name : `${dir.replace(/\/$/, '')}/${name}`)

/** Where the built-in handoff writes, when you have no /handoff command of your own. */
export function handoffTarget(now: number): string {
  const d = new Date(now)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `.claude/handoffs/${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.md`
}

export function handoffPrompt(path: string): string {
  return [
    `Write a handoff note to \`${path}\` so a fresh session can pick this work up cold.`,
    'Sections: Goal; Current state (what is done, what is half-done, with file paths); Decisions made and why;',
    'Open questions and risks; Next steps (an ordered checklist); How to verify (commands to run).',
    'Be concrete and brief. Do not change any other file. Reply with the path when done.',
  ].join(' ')
}

export function resumePrompt(path: string): string {
  return [
    `Read the handoff note \`${path}\` and pick the work up from it.`,
    'First restate the goal, the current state and the next steps in a few lines, and check the',
    'repository matches what the note says (git status, the files it names). Then continue with the first next step.',
  ].join(' ')
}

/** 5m ago, 3h ago, 2d ago. */
export function age(mtimeMs: number, now: number): string {
  const s = Math.max(0, Math.round((now - mtimeMs) / 1000))
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}
