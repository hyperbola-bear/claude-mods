// The agents' characters: pixel art 8 pixels wide and 6 tall, two frames each, drawn in cells of two
// pixels stacked so the terminal and the desktop paint the same picture.
import type { Role } from '../types'
import { put } from './cells.ts'
import type { Run } from './cells.ts'

/** A pixel's colour by its letter in a frame; `.` is no pixel. */
export const PAL: Record<string, string> = {
  o: '#d97757',
  k: '#1b1b1f',
  h: '#c9b07a',
  g: '#56805a',
  d: '#626a7a',
  b: '#7aa2f7',
  y: '#e2b341',
  u: '#4f7fd0',
  K: '#55617f',
  t: '#e2b341',
  n: '#9a6537',
  m: '#a9cbe0',
  W: '#ffffff',
}

const HEAD = '.okooko.'
const CLAW = 'oooooooo'
const BODY = '.oooooo.'
const LEG_A = 'o.o..o.o'
const LEG_B = '.o.oo.o.'

type Frame = readonly [string, string, string, string, string, string]

/** Each role's two frames, row by row from the top. */
export const CHARS: Record<Role, readonly [Frame, Frame]> = {
  explorer: [
    ['..hhhh..', 'hhgggghh', HEAD, CLAW, BODY, LEG_A],
    ['..hhhh..', 'hhgggghh', '.kookoo.', CLAW, BODY, LEG_B],
  ],
  developer: [
    ['..dddd..', '.d....d.', 'dokookod', CLAW, BODY, LEG_A],
    ['..dddd..', '.d....d.', 'bokookob', CLAW, BODY, LEG_A],
  ],
  architect: [
    ['..yyyy..', '.yyyyyy.', HEAD, 'oooooouu', BODY, LEG_A],
    ['..yyyy..', '.yyyyyy.', HEAD, 'ooooooou', BODY, LEG_B],
  ],
  researcher: [
    ['.KKKKKK.', '..KKKK.t', HEAD, CLAW, BODY, LEG_A],
    ['.KKKKKK.', '..KKKKt.', HEAD, CLAW, BODY, LEG_A],
  ],
  reviewer: [
    ['..nnnn..', '.nnnnnn.', '.okookom', 'ooooooon', BODY, LEG_A],
    ['..nnnn..', '.nnnnnn.', '.okookoW', 'ooooooon', BODY, LEG_B],
  ],
  clawd: [
    ['........', '........', HEAD, CLAW, BODY, LEG_A],
    ['........', '........', HEAD, CLAW, BODY, LEG_B],
  ],
}

export const SPRITE_WIDTH = 8

const pixel = (letter: string | undefined): string | null => (letter === undefined || letter === '.' ? null : (PAL[letter] ?? null))

/** One cell's look from its two pixels: a half block in the colour that is there, both colours on a split. */
function cell(top: string | null, bottom: string | null): { text: string; color: string; bg: string } {
  if (top === null) return bottom === null ? { text: ' ', color: '', bg: '' } : { text: '▄', color: bottom, bg: '' }
  if (bottom === null) return { text: '▀', color: top, bg: '' }
  if (top === bottom) return { text: '█', color: top, bg: '' }
  return { text: '▀', color: top, bg: bottom }
}

/** The character as 3 rows of 8 cells, frame 0 or 1 (any number counts round the two). */
export function spriteRows(role: Role, frame: number): Run[][] {
  const f = CHARS[role][Math.abs(frame) % 2]!
  const rows: Run[][] = []
  for (let y = 0; y < 6; y += 2) {
    const row: Run[] = []
    for (let x = 0; x < SPRITE_WIDTH; x++) {
      const c = cell(pixel(f[y]?.[x]), pixel(f[y + 1]?.[x]))
      put(row, c.text, { color: c.color, bg: c.bg })
    }
    rows.push(row)
  }
  return rows
}

const REVIEWING = /review|audit|secur|sicko/i

export function roleOf(type: string, description: string): Role {
  if (REVIEWING.test(type) || REVIEWING.test(description)) return 'reviewer'
  if (type === 'Explore') return 'explorer'
  if (type === 'Plan') return 'architect'
  if (type === 'claude-code-guide') return 'researcher'
  if (type === 'general-purpose' || type === 'claude' || type.endsWith('poteto-agent')) return 'developer'
  return 'clawd'
}
