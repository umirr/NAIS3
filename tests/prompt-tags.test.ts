import { expect, it } from 'vitest'
import { promptTags, stripDisabledTags, togglePromptTag } from '../src/shared/prompt-tags'
import { removeComments } from '../src/shared/nai-presets'

it('toggles one occurrence, preserves text and restores it exactly', () => {
  const text = 'blue eyes, blue eyes, 한글 태그'
  const tag = promptTags(text)[1]
  const off = togglePromptTag(text, tag.start, tag.end)
  expect(stripDisabledTags(off)).toBe('blue eyes, , 한글 태그')
  const disabled = promptTags(off)[1]
  expect(togglePromptTag(off, disabled.start, disabled.end)).toBe(text)
})
it('keeps weighting delimiters and excludes comments and fragment paths', () => {
  const text = '1.5::{blue eyes}, <folder/name>::\n# comment'
  expect(promptTags(text).map((r) => text.slice(r.start, r.end))).toEqual(['blue eyes'])
  const tag = promptTags(text)[0]
  expect(removeComments(togglePromptTag(text, tag.start, tag.end))).toBe('1.5::{}, <folder/name>::')
})
it('handles unicode and whitespace without losing enabled text', () => {
  const text = '  한글 😀, red hair'
  const tag = promptTags(text)[0]
  const off = togglePromptTag(text, tag.start, tag.end)
  expect(stripDisabledTags(off)).toBe('  , red hair')
  const r = promptTags(off)[0]
  expect(togglePromptTag(off, r.start, r.end)).toBe(text)
})
