import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import sharp from '../src/main/sharp'
import { directorReferenceBucket as v5ReferenceSize } from '../src/shared/precise-reference'
import { prepareReferenceImage } from '../src/main/refs/reference-image'

const refs = vi.hoisted(() => ({
  rows: [] as { filePath: string; refType: string; strength: number; fidelity: number }[]
}))
vi.mock('../src/main/refs/repo', () => ({
  charRefRowsByIds: () => refs.rows,
  enabledCharRefRows: () => refs.rows,
  enabledVibeRows: () => [],
  vibeRowsByIds: () => [],
  saveVibeEncoding: vi.fn()
}))
vi.mock('../src/main/i18n', () => ({ t: (id: string) => id }))
const { prepareCharRefs } = await import('../src/main/refs/prepare')
const dir = mkdtempSync(join(tmpdir(), 'nais3-reference-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('V5 reference image preprocessing', () => {
  it.each([
    [1024, 1024],
    [832, 1216],
    [1216, 832],
    [256, 4096]
  ])('preserves the official %sx%s bucket', (width, height) => {
    expect(v5ReferenceSize(width, height)).toMatchObject({
      width,
      height,
      resizeWidth: width,
      resizeHeight: height,
      left: 0,
      top: 0
    })
  })
  it('selects the nearest log-aspect bucket and center-crops instead of padding', () => {
    expect(v5ReferenceSize(1000, 1500)).toMatchObject({
      width: 832,
      height: 1216,
      resizeWidth: 832,
      resizeHeight: 1248,
      left: 0,
      top: 16
    })
  })
  it('produces a V5 bucket PNG while retaining V4.5 padded preprocessing', async () => {
    const file = join(dir, 'reference.png')
    writeFileSync(
      file,
      await sharp({
        create: {
          width: 100,
          height: 150,
          channels: 4,
          background: { r: 255, g: 0, b: 0, alpha: 1 }
        }
      })
        .png()
        .toBuffer()
    )
    const v5 = Buffer.from(
      await prepareReferenceImage(sharp, readFileSync(file), 'bucket'),
      'base64'
    )
    expect(await sharp(v5).metadata()).toMatchObject({ width: 832, height: 1216, format: 'png' })
    const pixel = await sharp(v5).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer()
    expect([...pixel].slice(0, 3)).toEqual([255, 0, 0])
    const v4 = Buffer.from(
      await prepareReferenceImage(sharp, readFileSync(file), 'canvas'),
      'base64'
    )
    expect(await sharp(v4).metadata()).toMatchObject({ width: 1024, height: 1536, format: 'png' })
    refs.rows = [{ filePath: file, refType: 'costume', strength: 3, fidelity: 0.6 }]
    expect(await prepareCharRefs('nai-diffusion-5-full')).toHaveLength(1)
    expect(await prepareCharRefs('nai-diffusion-4-5-full')).toEqual([])
  })
})
