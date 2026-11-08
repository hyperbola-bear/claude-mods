import { expect, test } from 'claude-code/testing'

import { SLACK, clampOffset, inView, markdownRows, scrolled, svgRows, textRows, wrappedRows } from '../hooks/layout.ts'

test('text wraps at spaces, a word longer than the line breaks mid-word, and a blank line is a row', () => {
  expect(textRows('short', 20)).toBe(1)
  expect(textRows('one two three four five six', 10)).toBe(3)
  expect(textRows('x'.repeat(25), 10)).toBe(3)
  expect(textRows('a\n\nb', 10)).toBe(3)
})

test('markdown counts what it draws: marks dropped, code a row a line, blank runs one row', () => {
  expect(markdownRows('# Title\n\n**bold** and `code` and [a link](https://example.com/very/long/path)', 40)).toBe(3)
  expect(markdownRows('```\nlet a = 1\nlet b = 2\n```', 40)).toBe(2)
  expect(markdownRows('a\n\n\n\nb', 40)).toBe(3)
  // A list is drawn tight, and an item wraps under its text, not under its number.
  expect(markdownRows('Facts:\n\n1. one\n\n2. two\n\n3. three', 40)).toBe(5)
  expect(markdownRows('1. ' + 'word '.repeat(8).trim(), 20)).toBe(3)
})

test('an SVG takes its height in rows, scaled down to the pane when wider', () => {
  expect(svgRows('<svg viewBox="0 0 400 200">', 100)).toBe(10)
  expect(svgRows('<svg viewBox="0 0 840 400">', 50)).toBe(10)
  expect(svgRows('<svg>', 50)).toBe(12)
})

test('a bar of commands wraps onto the rows it needs', () => {
  expect(wrappedRows([5, 5, 5], 20, 2)).toBe(1)
  expect(wrappedRows([8, 8, 8], 20, 2)).toBe(2)
})

const M = { total: 100, visible: 20, starts: new Map([[1, 0], [2, 50]]) }
const E = { bodyRows: 24, contentRows: 26 }

test('a scroll stays between the top and a little past the end; a page key moves a page of answers; Home and End jump', () => {
  expect(clampOffset(-5, M)).toBe(0)
  expect(clampOffset(500, M)).toBe(100 - 20 + SLACK)
  expect(scrolled(10, 3, E, M)).toBe(13)
  expect(scrolled(10, 24, E, M)).toBe(28)
  expect(scrolled(40, -24, E, M)).toBe(22)
  expect(scrolled(40, -26, E, M)).toBe(0)
  expect(scrolled(0, 26, E, M)).toBe(100 - 20 + SLACK)
})

test('an exchange in view stays put; one out of view comes to the top', () => {
  expect(inView(45, 50, M)).toBe(45)
  expect(inView(0, 50, M)).toBe(50)
  expect(inView(60, 0, M)).toBe(0)
  expect(inView(7, undefined, M)).toBe(7)
})
