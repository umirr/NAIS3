import { expect, it } from 'vitest'
import { restoreImageSceneLinks } from '../src/shared/scene-restore-links'

it('preserves image files and links only scenes with the same identity after configuration restore', () => {
  const previous = [
    { id: 1, createdAt: '2026-01-01' },
    { id: 2, createdAt: '2026-02-01' }
  ]
  const images = [
    { id: 11, sceneId: 1, filePath: 'content://images/11', favorite: true },
    { id: 12, sceneId: 2, filePath: 'content://images/12', favorite: false },
    { id: 13, sceneId: null, filePath: 'content://images/13', favorite: false }
  ]
  const result = restoreImageSceneLinks(images, previous, [
    previous[0],
    { id: 2, createdAt: '2026-03-01' }
  ])
  expect(result.map((image) => image.sceneId)).toEqual([1, null, null])
  expect(result.map((image) => image.filePath)).toEqual(images.map((image) => image.filePath))
  expect(result[0].favorite).toBe(true)
  expect(images[1].sceneId).toBe(2)
})

it('leaves preserved images unlinked when their scenes are absent from the backup', () => {
  const images = [{ id: 1, sceneId: 7 }]
  expect(restoreImageSceneLinks(images, [{ id: 7, createdAt: 'original' }], [])).toEqual([
    { id: 1, sceneId: null }
  ])
})
