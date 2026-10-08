import { expect, test } from 'claude-code/testing'

import { asEffort, footerRule, lifeBar, modelAlias, modelLabel, nextWarn, sectionRule } from '../hooks/hud.ts'

test('models are recognised however /model or a request spells them', () => {
  expect(modelAlias('claude-sonnet-5-5')).toBe('sonnet')
  expect(modelAlias('opus[1m]')).toBe('opus')
  expect(modelAlias('claude-haiku-4-5-20251001')).toBe('haiku')
  expect(modelAlias('Fable 5.1')).toBe('fable')
  expect(modelAlias('gpt-9')).toBe(null)
  expect(modelAlias(null)).toBe(null)
  expect(modelLabel('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelLabel('some-other-model')).toBe('some-other-model')
  expect(modelLabel(null)).toBe(null)
})

test('effort levels', () => {
  expect(asEffort('xhigh')).toBe('xhigh')
  expect(asEffort('auto')).toBe(null)
  expect(asEffort(32_000)).toBe(null)
})

test('the cycling pills step through their values and wrap', () => {
  expect([nextWarn(60), nextWarn(120), nextWarn(300)]).toEqual([120, 300, 60])
  expect(nextWarn(45)).toBe(120)
})

test('rules fill the panel width exactly', () => {
  expect(sectionRule('CACHE', 20)).toBe('── C A C H E ───────')
  expect(sectionRule('CACHE', 20)).toHaveLength(20)
  expect(footerRule('user-hud', 20)).toBe('──────────── user-hud ─'.slice(-20))
  expect(footerRule('user-hud', 20)).toHaveLength(20)
})

test('the life bar fills with the time left', () => {
  expect(lifeBar(300_000, 300_000)).toEqual({ on: '▰▰▰▰▰▰▰▰▰▰', off: '' })
  expect(lifeBar(150_000, 300_000)).toEqual({ on: '▰▰▰▰▰', off: '▱▱▱▱▱' })
  expect(lifeBar(-5, 300_000)).toEqual({ on: '', off: '▱▱▱▱▱▱▱▱▱▱' })
})
