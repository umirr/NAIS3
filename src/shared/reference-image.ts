/** V5 Precise Reference buckets from novelai.net, deployment 7e293df (2026-11-25). */
const V5_REFERENCE_BUCKETS: readonly (readonly [number, number])[] = [
  [256, 4096],
  [256, 4032],
  [256, 3968],
  [256, 3904],
  [256, 3840],
  [256, 3776],
  [256, 3712],
  [256, 3648],
  [256, 3584],
  [256, 3520],
  [256, 3456],
  [256, 3392],
  [256, 3328],
  [320, 3264],
  [320, 3200],
  [320, 3136],
  [320, 3072],
  [320, 3008],
  [320, 2944],
  [320, 2880],
  [320, 2816],
  [320, 2752],
  [384, 2688],
  [384, 2624],
  [384, 2560],
  [384, 2496],
  [384, 2432],
  [384, 2368],
  [448, 2304],
  [448, 2240],
  [448, 2176],
  [448, 2112],
  [512, 2048],
  [512, 1984],
  [512, 1920],
  [512, 1856],
  [576, 1792],
  [576, 1728],
  [576, 1664],
  [640, 1600],
  [640, 1536],
  [704, 1472],
  [704, 1408],
  [768, 1344],
  [768, 1280],
  [832, 1216],
  [896, 1152],
  [960, 1088],
  [1024, 1024],
  [1088, 960],
  [1152, 896],
  [1216, 832],
  [1280, 768],
  [1344, 768],
  [1408, 704],
  [1472, 704],
  [1536, 640],
  [1600, 640],
  [1664, 576],
  [1728, 576],
  [1792, 576],
  [1856, 512],
  [1920, 512],
  [1984, 512],
  [2048, 512],
  [2112, 448],
  [2176, 448],
  [2240, 448],
  [2304, 448],
  [2368, 384],
  [2432, 384],
  [2496, 384],
  [2560, 384],
  [2624, 384],
  [2688, 384],
  [2752, 320],
  [2816, 320],
  [2880, 320],
  [2944, 320],
  [3008, 320],
  [3072, 320],
  [3136, 320],
  [3200, 320],
  [3264, 320],
  [3328, 256],
  [3392, 256],
  [3456, 256],
  [3520, 256],
  [3584, 256],
  [3648, 256],
  [3712, 256],
  [3776, 256],
  [3840, 256],
  [3904, 256],
  [3968, 256],
  [4032, 256],
  [4096, 256]
]

export function v5ReferenceSize(
  width: number,
  height: number
): {
  width: number
  height: number
  resizeWidth: number
  resizeHeight: number
  left: number
  top: number
} {
  const ratio = Math.log(Math.max(width, 1) / Math.max(height, 1))
  let best = V5_REFERENCE_BUCKETS[0]
  let distance = Math.abs(ratio - Math.log(best[0] / best[1]))
  for (const bucket of V5_REFERENCE_BUCKETS) {
    const next = Math.abs(ratio - Math.log(bucket[0] / bucket[1]))
    if (next < distance) {
      best = bucket
      distance = next
    }
  }
  const [w, h] = best
  const scale = Math.max(w / width, h / height)
  const resizeWidth = Math.max(Math.round(width * scale), w)
  const resizeHeight = Math.max(Math.round(height * scale), h)
  return {
    width: w,
    height: h,
    resizeWidth,
    resizeHeight,
    left: Math.floor((resizeWidth - w) / 2),
    top: Math.floor((resizeHeight - h) / 2)
  }
}
