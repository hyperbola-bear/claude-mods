// What asks for a code reference, and the format the model is handed for one:
// an explanation of code on disk, or a review of a pull request. No `$` here.

/** How every code-reference reply links its prose to the code. */
const LINKS = [
  '- Link every place in the code you talk about, on the words that describe it: `[the retry loop](src/worker/retry.ts:40-62)`.',
  '  The target is the path relative to the repository root, then `:line` or `:start-end` in the file as it is now. Link the lines that matter, not whole files.',
  '- Name places in the order the reader should look at them. Never put a link inside a code block.',
  '- No severity tags, no numbered findings, no tables of files: plain prose the reader can follow, each place one click away.',
].join('\n')

/** The format of an explanation: prose in sections, every place it names linked. */
export function explainContext(root: string): string {
  return [
    'code-reference: answer in the code-reference format, so each place in the code you mention opens beside the reply.',
    `- First line, exactly: \`**Code reference:** ${root}\` (the repository root, absolute).`,
    '- Then plain markdown. When the answer has more than one part, give each a `##` heading that says what it covers; one or two short paragraphs each.',
    LINKS,
  ].join('\n')
}

/** The format of a review: a verdict sentence, then one section per issue. */
export function reviewContext(url: string, worktree?: string): string {
  return [
    `code-reference: this prompt asks for a review of ${url}. Read it with gh pr view and gh pr diff (or the GitHub MCP tools when gh is missing).`,
    ...(worktree
      ? [`The PR's files at its head are being checked out in ${worktree}: once it exists, read whole files there; link paths relative to it. Do not edit or commit there.`]
      : []),
    'Look for correctness, security, concurrency and data-loss risks first, then maintainability. Check claims against the code. Skip praise and nits a formatter would fix. Do not post comments, approve or push.',
    'Answer in the code-reference format:',
    `- First line, exactly: \`**Code reference:** ${url}\`.`,
    '- Then one plain sentence: whether it is ready to merge and why ("Not ready to merge: the IAM pattern stops the first deploy." / "Ready to merge.").',
    '- Then one or two sentences on what the PR does.',
    '- Then one `##` section per issue, most important first, the heading saying what is wrong in plain words. In it: what the code does, what goes wrong and for whom, and the fix; a ```diff block of at most 8 lines when it helps.',
    '- With nothing to fix: the verdict sentence and a short list of what you checked.',
    LINKS,
  ].join('\n')
}

/**
 * For `/code-reference` alone after a reply that names no files: the prompt
 * that asks for it again with links. It says the format itself, since a
 * plugin's own prompt carries no hidden context.
 */
export function rewritePrompt(root: string): string {
  return `Say your last reply again in the code-reference format (the code-reference:reply-format skill): first line **Code reference:** ${root}, then the same content, as briefly, with every place in the code linked on the words that describe it, like [the retry loop](src/worker/retry.ts:40-62). Read files first where you need the line numbers.`
}

/** What a prompt beginning with `/code-reference` asks for. */
export type Command =
  | { kind: 'last' }
  | { kind: 'pick'; n: number }
  | { kind: 'review'; url: string }
  | { kind: 'ask'; question: string }

const PR_URL = /https?:\/\/[^\s/]+\/[^\s/]+\/[^\s/]+\/pull\/\d+/i

export function parseCommand(text: string): Command | null {
  const m = /^\/(?:code-reference:)?code-reference(?:\s+([\s\S]*))?$/i.exec(text.trim())
  if (!m) return null
  const arg = (m[1] ?? '').trim()
  if (!arg) return { kind: 'last' }
  if (/^\d+$/.test(arg)) return { kind: 'pick', n: Number(arg) }
  const url = PR_URL.exec(arg)?.[0]
  if (url && arg.replace(PR_URL, '').replace(/\b(re-?view|this|the|pr|please)\b|[\s.,;:!?<>()]/gi, '') === '') return { kind: 'review', url }
  return { kind: 'ask', question: arg }
}

/** Whether a prompt asks for the format in passing: "…and use /code-reference". */
export const mentionsCommand = (text: string) => !text.trim().startsWith('/') && /(^|[\s(])\/code-reference\b/i.test(text)

/** What a typed prompt asks to have reviewed. */
export type ReviewAsk = { kind: 'url'; url: string } | { kind: 'number'; number: number } | { kind: 'branch' }

const REVIEW_WORD = /\b(?:re-?view\w*|cr|look\s+over|go\s+(?:over|through))\b/i
const PR_PHRASE = /\b(?:re-?view|cr)\s+(?:(?:the|this|my|that|a|our)\s+)?(?:pr|pull\s+request)\b(?:\s+(?:number\s+)?#?(\d+)\b)?|\b(?:pr|pull\s+request)\s+re-?view\b|\bre-?view\s+#(\d+)\b/i

/**
 * The review a typed prompt asks for: a GitHub pull request link with a word
 * like review (or the link alone), or a phrase like "review pr", "review pr
 * 418", "review #418" or "pr review" (this repository's PR by number, or the
 * current branch's). Slash commands and shell escapes are left alone.
 */
export function reviewRequest(text: string): ReviewAsk | null {
  const t = text.trim()
  if (t.startsWith('/') || t.startsWith('!')) return null
  const url = PR_URL.exec(t)?.[0]
  if (url) {
    const isAlone = t.replace(PR_URL, '').replace(/[\s.,;:!?<>()]/g, '') === ''
    return isAlone || REVIEW_WORD.test(t) ? { kind: 'url', url } : null
  }
  const m = PR_PHRASE.exec(t)
  if (!m) return null
  const n = Number(m[1] ?? m[2] ?? 0)
  return n > 0 ? { kind: 'number', number: n } : { kind: 'branch' }
}
