export interface SceneIdentity {
  id: number
  createdAt: string
}

export interface ExistingImageLink {
  id: number
  sceneId: number | null
}

/** Match PC restore semantics: identity is id + creation time, never display name. */
export function restoreImageSceneLinks<T extends ExistingImageLink>(
  existingImages: readonly T[],
  previousScenes: readonly SceneIdentity[],
  restoredScenes: readonly SceneIdentity[]
): T[] {
  const restored = new Map(restoredScenes.map((scene) => [scene.id, scene.createdAt]))
  const surviving = new Set(
    previousScenes
      .filter((scene) => restored.get(scene.id) === scene.createdAt)
      .map((scene) => scene.id)
  )
  return existingImages.map((image) => ({
    ...image,
    sceneId: image.sceneId !== null && surviving.has(image.sceneId) ? image.sceneId : null
  }))
}
