// Pure guesses logic: the `assumption` tool Claude calls with the guesses it acts on, and the list the
// person marks right or wrong.
import type { Guess } from '../types'

export const ASSUME_TOOL = 'assumption'

/** The name the model calls it by. */
export const ASSUME_TOOL_ID = `mcp__user-hud__${ASSUME_TOOL}`

export const MAX_GUESS_CHARS = 140

export const MAX_GUESSES = 5

export const ASSUME_SPEC = {
  name: ASSUME_TOOL,
  description:
    'Shows the person the guesses you are about to act on, so they can mark each right or wrong. Call it whenever you pick one reading of an ambiguous request, fill in a detail the person did not give, or rely on a fact you have not checked: one short line per guess, before you act on it. Then carry on without waiting; a wrong guess comes back in their next prompt.',
  inputSchema: {
    type: 'object',
    properties: {
      guesses: {
        type: 'array',
        description: `One short line per guess, at most ${MAX_GUESS_CHARS} characters each.`,
        items: { type: 'string', maxLength: MAX_GUESS_CHARS },
        minItems: 1,
        maxItems: MAX_GUESSES,
      },
    },
    required: ['guesses'],
  },
  isDeferred: false,
} as const

export const ASSUME_SECTION = {
  id: 'user-hud:assumption',
  scope: 'session',
  text: `You have an \`${ASSUME_TOOL_ID}\` tool that shows the person the guesses you act on, and they mark each right or wrong. Call it with one short line per guess whenever you pick one reading of an ambiguous request, fill in a detail the person did not give, or rely on a fact you have not checked, before you act on it.`,
} as const

/** The tool's input as guesses to show, or why it is refused. */
export function parseGuesses(input: unknown): { guesses: string[] } | { refusal: string } {
  const list = (input as { guesses?: unknown } | null)?.guesses
  if (!Array.isArray(list) || list.length === 0) return { refusal: 'Pass `guesses`: a list of one to five short lines.' }
  if (list.length > MAX_GUESSES) return { refusal: `At most ${MAX_GUESSES} guesses a call; send the rest in another call.` }
  const guesses = list.map(g => (typeof g === 'string' ? g.trim() : ''))
  if (guesses.some(g => g === '')) return { refusal: 'Each guess is a line of text.' }
  if (guesses.some(g => g.length > MAX_GUESS_CHARS)) return { refusal: `Keep each guess to ${MAX_GUESS_CHARS} characters.` }
  return { guesses }
}

export function added(list: readonly Guess[], texts: readonly string[], at: number): Guess[] {
  return [...list, ...texts.map((text, i) => ({ id: `${at.toString(36)}-${list.length + i}`, text, status: 'open' as const, at }))]
}

export const openGuesses = (list: readonly Guess[]) => list.filter(g => g.status === 'open')

export const marked = (list: readonly Guess[], id: string, status: 'right' | 'wrong'): Guess[] => list.map(g => (g.id === id ? { ...g, status } : g))

/** What ✗ puts in the prompt box, for the person to finish. */
export const correction = (g: Pick<Guess, 'text'>) => `Not quite: "${g.text}". `

/** What the model reads back. */
export const shownText = (n: number) =>
  `Shown to the person: ${n === 1 ? 'one guess' : `${n} guesses`} to mark right or wrong. Carry on; a wrong one comes back in their next prompt.`
