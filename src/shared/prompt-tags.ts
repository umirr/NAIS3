// Combining strike is stored with the text, so presets and backups retain toggles.
const STRIKE = '\u0336'
export function promptTags(text: string): { start: number; end: number; disabled: boolean }[] {
  const tags: { start: number; end: number; disabled: boolean }[] = []
  const re = /[^,\n{}[\]<>:|]+/g
  for (const match of text.matchAll(re)) {
    const raw = match[0]
    const trimmed = raw.trim()
    const start = match.index! + raw.indexOf(trimmed)
    if (
      !trimmed ||
      (/^-?\d+(\.\d+)?$/.test(trimmed) &&
        text.slice(start + trimmed.length, start + trimmed.length + 2) === '::')
    )
      continue
    if (
      text
        .slice(text.lastIndexOf('\n', start - 1) + 1, start)
        .trimStart()
        .startsWith('#') ||
      trimmed.startsWith('#')
    )
      continue
    // Fragment paths are references, not literal tags.
    if (text.lastIndexOf('<', start) > text.lastIndexOf('>', start)) continue
    tags.push({ start, end: start + trimmed.length, disabled: trimmed.includes(STRIKE) })
  }
  return tags
}
export function togglePromptTag(text: string, start: number, end: number): string {
  const tag = text.slice(start, end)
  const replacement = tag.includes(STRIKE)
    ? tag.replaceAll(STRIKE, '')
    : Array.from(tag)
        .map((char) => char + STRIKE)
        .join('')
  return text.slice(0, start) + replacement + text.slice(end)
}
export function stripDisabledTags(text: string): string {
  for (const tag of promptTags(text).reverse()) {
    if (tag.disabled) text = text.slice(0, tag.start) + text.slice(tag.end)
  }
  return text
}
