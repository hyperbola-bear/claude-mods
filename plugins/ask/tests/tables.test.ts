import { expect, test } from 'claude-code/testing'

import { columnWidths, fittedTable, naturalWidth, plainCell, tableAsList, tableParts, widthOf, wrapCell } from '../hooks/tables.ts'

/** The table from a real answer that the pane wrapped into broken borders. */
const COUNTRIES = [
  'So far we know three countries:',
  '',
  '| Country | Host | Result | How we know |',
  '|---|---|---|---|',
  '| NO | `no.fd-api.com` | **Affected** | 1 of 6,000 UAT receipts obfuscated (jq0e-2644-fhww), plus 3 of 5,000 earlier |',
  '| AT | `mj.fd-api.com` | **Not affected** | support@foodora.at readable on all 20 recent AT receipts, no Cloudflare markup |',
  '| TR | `tr.fd-api.com` | **Inconclusive** | Stored TR receipts show readable addresses and no markup, but they are MJML output |',
  '',
  'TR needs a staging render.',
].join('\n')

test('an answer splits into its prose and its tables, a fenced block never read as one', () => {
  const parts = tableParts(COUNTRIES)
  expect(parts.map(p => p.kind)).toEqual(['markdown', 'table', 'markdown'])
  const table = parts[1]!
  if (table.kind !== 'table') throw new Error('not a table')
  expect(table.rows).toHaveLength(4)
  expect(table.rows[0]).toEqual(['Country', 'Host', 'Result', 'How we know'])
  expect(table.source.split('\n')).toHaveLength(5)
  const fenced = '```\n| a | b |\n|---|---|\n| 1 | 2 |\n```'
  expect(tableParts(fenced)).toEqual([{ kind: 'markdown', text: fenced }])
  // A row with a cell short is filled; an escaped bar stays in its cell.
  const ragged = tableParts('| a | b |\n|---|---|\n| x \\| y |')[0]!
  expect(ragged.kind === 'table' && ragged.rows[1]).toEqual(['x | y', ''])
})

test('cells read without the marks a drawn table cannot show', () => {
  expect(plainCell('**Affected** `no.fd-api.com` [docs](https://x.y) *maybe*')).toBe('Affected no.fd-api.com docs maybe')
  expect(plainCell('a<br>b')).toBe('a b')
  expect(widthOf('日本')).toBe(4)
})

test('a table wider than the pane is drawn with its cells wrapped, no line wider than the pane', () => {
  const table = tableParts(COUNTRIES)[1]!
  if (table.kind !== 'table') throw new Error('not a table')
  expect(naturalWidth(table.rows)).toBeGreaterThan(100)
  for (const width of [120, 100, 80]) {
    const drawn = fittedTable(table.rows, width)!
    const lines = [...drawn.header, ...drawn.body]
    for (const l of lines) expect(widthOf(l), `${width}: ${l}`).toBeLessThanOrEqual(width)
    // Every word of every cell is still there.
    const text = lines.join(' ').replace(/[│┌┐└┘├┤┬┴┼─]/g, ' ')
    for (const word of ['Inconclusive', 'tr.fd-api.com', 'jq0e-2644-fhww', 'markup']) expect(text, `${width}`).toContain(word)
    expect(drawn.header[0]).toMatch(/^┌─+┬/)
    expect(drawn.body.at(-1)).toMatch(/┘$/)
  }
  // The narrow columns keep their width; the long one takes the room left.
  expect(columnWidths(table.rows, 80)).toEqual([7, 13, 12, 35])
})

test('too narrow for its columns or rows to read, a table becomes one entry a row', () => {
  const table = tableParts(COUNTRIES)[1]!
  if (table.kind !== 'table') throw new Error('not a table')
  // At 60 the long column would wrap each row past six lines; at 40 a column would be under eight cells.
  expect(fittedTable(table.rows, 60)).toBe(null)
  expect(columnWidths(table.rows, 40)).toBe(null)
  expect(tableAsList(table.rows).split('\n').slice(0, 4)).toEqual(['**NO**', '- Host: `no.fd-api.com`', '- Result: **Affected**', expect.stringMatching(/^- How we know: 1 of 6,000/)])
})

test('a cell wraps at spaces, and mid-word only where a word is longer than its column', () => {
  expect(wrapCell('readable on all 20 recent receipts', 12)).toEqual(['readable on', 'all 20', 'recent', 'receipts'])
  expect(wrapCell('jq0e-2644-fhww', 6)).toEqual(['jq0e-2', '644-fh', 'ww'])
  expect(wrapCell('', 6)).toEqual([''])
})
