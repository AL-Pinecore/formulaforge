import { describe, expect, it } from 'vitest'
import { rasterMime, svgToPdfBlob, svgToRasterBlob } from '../../app/utils/browser-export'

describe('rasterMime', () => {
  it('maps raster formats to browser MIME types', () => {
    expect(rasterMime('png')).toBe('image/png')
    expect(rasterMime('jpeg')).toBe('image/jpeg')
    expect(rasterMime('webp')).toBe('image/webp')
  })

  it('rejects non-raster formats', () => {
    expect(() => rasterMime('svg')).toThrow('Unsupported raster format')
    expect(() => rasterMime('pdf')).toThrow('Unsupported raster format')
  })
})

describe('size guards', () => {
  it('rejects empty dimensions before touching the DOM', async () => {
    await expect(svgToRasterBlob('<svg/>', 0, 10, 'png')).rejects.toThrow(
      'The SVG has no usable dimensions.',
    )
    await expect(svgToPdfBlob('<svg/>', 10, -1)).rejects.toThrow(
      'The SVG has no usable dimensions.',
    )
  })

  it('rejects oversized dimensions', async () => {
    await expect(svgToRasterBlob('<svg/>', 20000, 10, 'png')).rejects.toThrow(
      'too large',
    )
    await expect(svgToPdfBlob('<svg/>', 10, 20000)).rejects.toThrow('too large')
  })
})
