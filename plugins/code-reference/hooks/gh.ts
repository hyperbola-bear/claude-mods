// Small helpers around the GitHub CLI output. No `$` here.

/** Strips control characters (escape sequences included) so GitHub text cannot restyle the terminal. */
export function clean(value: unknown, max = 500): string {
  const s = typeof value === 'string' ? value : value == null ? '' : String(value)
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '').slice(0, max)
}

/** A gh failure as one line the UI can show. */
export function ghError(stderr: string, exitCode: number): string {
  const first = clean(stderr.split('\n').find(l => l.trim()) ?? '', 200)
  if (/auth login|not logged|authentication/i.test(stderr)) return 'gh is not signed in: run `gh auth login` in a terminal.'
  if (/not a git repository|no git remotes|none of the git remotes/i.test(stderr)) return 'This folder is not a GitHub repository.'
  return first || `gh exited with ${exitCode}`
}
