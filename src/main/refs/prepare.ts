import { readFileSync } from 'fs'
import sharp from '../sharp'
import type { CharacterReferenceOptions, VibeOptions } from '../nai/payload'
import { ENDPOINTS } from '../nai/endpoints'
import { t } from '../i18n'
import { isV5Model } from '../../shared/nai-models'
import { v5ReferenceSize } from '../../shared/reference-image'
import {
  charRefRowsByIds,
  enabledCharRefRows,
  enabledVibeRows,
  saveVibeEncoding,
  vibeRowsByIds
} from './repo'
import { getVibeEncoding, putVibeEncoding } from './vibe-encoding-cache'

/** 생성 직전 바이브 준비 — 미인코딩/ie 변경분만 encode-vibe (2 Anlas) 후 캐시.
 *  newlyEncoded: 이번에 새로 인코딩된 바이브 id (카드 표시 갱신 통지용) */
export async function prepareVibes(
  token: string,
  model: string,
  ids?: number[]
): Promise<{ vibes: VibeOptions[]; newlyEncoded: number[] }> {
  // ids 지정 시 그 바이브들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? vibeRowsByIds(ids) : enabledVibeRows()
  const vibes: VibeOptions[] = []
  const newlyEncoded: number[] = []
  for (const row of rows) {
    let encoded = getVibeEncoding(row.encoded, row.encodedIe, model, row.infoExtracted)
    if (!encoded) {
      const res = await fetch(ENDPOINTS.encodeVibe, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image: readFileSync(row.filePath).toString('base64'),
          information_extracted: row.infoExtracted,
          model
        })
      })
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(t('ui.vibeEncodingFailedValueValue', res.status, text.slice(0, 200)))
      }
      encoded = Buffer.from(await res.arrayBuffer()).toString('base64')
      const packed = putVibeEncoding(row.encoded, row.encodedIe, model, row.infoExtracted, encoded)
      saveVibeEncoding(row.id, packed, row.infoExtracted)
      newlyEncoded.push(row.id)
    }
    vibes.push({ strength: row.strength, encodedVibeBase64: encoded })
  }
  return { vibes, newlyEncoded }
}

/**
 * V5는 약 1MP 버킷으로 중앙 크롭. V4.5는 기존 3가지 캔버스에 검정 패딩.
 */
export async function processCharRefImage(filePath: string, model: string): Promise<string> {
  const buf = readFileSync(filePath)
  const meta = await sharp(buf).metadata()
  const w = meta.width ?? 1
  const h = meta.height ?? 1
  if (isV5Model(model)) {
    // Official V5 client uses a ~1MP aspect-ratio bucket and a centered crop.
    const size = v5ReferenceSize(w, h)
    const png = await sharp(buf)
      .resize(size.resizeWidth, size.resizeHeight, { fit: 'fill' })
      .extract({ left: size.left, top: size.top, width: size.width, height: size.height })
      .png()
      .toBuffer()
    return png.toString('base64')
  }
  const ratio = w / h
  const canvas =
    ratio > 1.2
      ? { w: 1536, h: 1024 }
      : ratio < 1 / 1.2
        ? { w: 1024, h: 1536 }
        : { w: 1472, h: 1472 }

  const png = await sharp(buf)
    .resize(canvas.w, canvas.h, { fit: 'contain', background: { r: 0, g: 0, b: 0 } })
    .png()
    .toBuffer()
  return png.toString('base64')
}

export async function prepareCharRefs(
  ids: number[] | undefined,
  model: string
): Promise<CharacterReferenceOptions[]> {
  // ids 지정 시 그 캐릭레퍼들(enabled 무시 — 출연 예약), 미지정 시 enabled 항목
  const rows = ids ? charRefRowsByIds(ids) : enabledCharRefRows()
  const result: CharacterReferenceOptions[] = []
  for (const row of rows) {
    if (!isV5Model(model) && row.refType === 'costume') continue
    result.push({
      referenceType: row.refType as CharacterReferenceOptions['referenceType'],
      strength: row.strength,
      fidelity: row.fidelity,
      imageBase64: await processCharRefImage(row.filePath, model)
    })
  }
  return result
}
