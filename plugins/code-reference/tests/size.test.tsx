import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { parseDoc } from '../hooks/doc.ts'
import { BUDGET, planRows } from '../hooks/draw.tsx'
import { replyRows } from '../hooks/layout.ts'
import type { Row } from '../hooks/layout.ts'

/** A review of `sections` issues, each with prose, three places, a diff and a code fence of `fenceLines`. */
function review(sections: number, fenceLines: number): string {
  const out = ['**Code reference:** https://github.com/acme/billing/pull/12', '', 'Not ready to merge: the consumer drops messages when hydration fails.', '', 'Wires the vendor cancellation fee from the SNS topic through SQS into the billing engine aggregator.']
  for (let s = 1; s <= sections; s++) {
    out.push(
      '',
      `## Issue ${s}: the retry path loses the original message attributes`,
      '',
      `[The consumer loop](src/consumer/loop${s}.ts:${10 * s}-${10 * s + 12}) reads a batch and hands each record to [the hydrator](src/hydrate/fee${s}.ts:${20 + s}-${40 + s}), but when hydration throws it calls [the retry helper](src/retry/backoff.ts:${5 + s}) with a fresh envelope, so the vendor id and the order timestamp are gone by the second attempt and the billing order is written with defaults.`,
      '',
      'Keep the original attributes on the retry envelope and assert on them in the test that covers the poison-message path, otherwise the next refactor brings this back without anyone noticing.',
      '',
      '```diff',
      '-    await retry(() => hydrate(record.body), { attempts: 3 })',
      '+    await retry(() => hydrate(record.body, record.attributes), { attempts: 3, keep: record.attributes })',
      '```',
    )
    if (fenceLines > 0) out.push('', '```ts', ...Array.from({ length: fenceLines }, (_, i) => `  const value${i} = await client.send(new GetItemCommand({ TableName: "fees", Key: { id: { S: vendorId } } })) // line ${i}`), '```')
  }
  return out.join('\n')
}

const VIEW = { columns: 120, rows: 50, isFullscreen: true }

function world(on: On) {
  on('session.root', () => ({ value: '/work' }))
  on('ui.panes', () => ({ value: [] }))
  // The engine's own drawing of a reply the plugin leaves alone.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.text}</Text>
  })
}

const rowsOf = (text: string): Row[] => {
  const doc = parseDoc(text, '/work')
  if (!doc) throw new Error('no doc')
  return replyRows({ key: 'k', doc, current: null, inline: null, cols: VIEW.columns }, VIEW.columns, null)
}
const plainOf = (r: { runs: (string | { t: string })[] }) => r.runs.map(x => (typeof x === 'string' ? x : x.t)).join('')

test('a long review draws whole in its region, under the 100,000 characters a Client tree is held to', async ($, on) => {
  world(on)
  const text = review(8, 14)
  const msg = await $.ui.mount({ plugin: 'code-reference', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: VIEW })
  expect(await msg.find({ type: 'Client', key: 'reply' })).toBeTruthy()
  const drawn = JSON.stringify(await msg.drawn({ in: 'reply' }))
  expect(drawn.length).toBeLessThan(100000)
  expect(await msg.find({ type: 'Text', text: 'Issue 8: the retry path', in: 'reply' })).toBeTruthy()
  // The diffs keep their backgrounds where the syntax colours give way.
  expect(drawn).toContain('"backgroundColor":"diffAdded"')
})

test('a review of the usual size keeps every syntax colour', async ($, on) => {
  world(on)
  const text = review(5, 0)
  expect(planRows(rowsOf(text)).isCoarse).toBe(false)
  const msg = await $.ui.mount({ plugin: 'code-reference', surface: 'desktop', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: VIEW })
  const drawn = JSON.stringify(await msg.drawn({ in: 'reply' }))
  expect(drawn).toContain('"color":"merged"')
  expect(drawn).toContain('"underline":true')
})

test('a reply too long to draw whole even plain is left to the engine\'s own drawing', async ($, on) => {
  world(on)
  const text = review(25, 40)
  const msg = await $.ui.mount({ plugin: 'code-reference', surface: 'terminal', component: 'AssistantMessage', props: { text, isFirstOfReply: true }, viewport: VIEW })
  expect(await msg.find({ type: 'Client' })).toBe(undefined)
  expect(await msg.find({ type: 'Text', text: 'Issue 1: the retry path' })).toBeTruthy()
})

test('planning rows keeps every character, puts one look on the row, and never passes the budget', () => {
  const rows = rowsOf(review(8, 14))
  const fine = planRows(rows, Infinity)
  expect(fine.isCoarse).toBe(false)
  fine.rows.forEach((r, i) => {
    const text = (rows[i] ?? []).map(s => s.t).join('')
    expect(plainOf(r)).toBe(text === '' ? ' ' : text)
  })
  // A code line: its commonest colour on the row, the rest each a Text.
  const code = fine.rows.find(r => plainOf(r).includes('const value1 ='))
  expect(code?.look.color).toBe('text')
  expect(code?.runs.filter(x => typeof x !== 'string').length).toBe(5)

  const tight = planRows(rows, 40000)
  expect(tight.cost).toBeLessThanOrEqual(40000)
  expect(tight.left).toBeGreaterThan(0)
  expect(plainOf(tight.rows[tight.rows.length - 1] ?? { runs: [] })).toContain(`${tight.left} more rows`)
  expect(planRows(rows).cost).toBeLessThanOrEqual(BUDGET)
})
