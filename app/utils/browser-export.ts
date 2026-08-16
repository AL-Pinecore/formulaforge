import type { ExportFormat } from '~/types/export'

// Mirrors the Rust exporter's MAX_DIMENSION guard so absurd inputs fail fast
// instead of exhausting the browser's canvas/image memory.
const MAX_DIMENSION = 16384

const RASTER_MIME: Partial<Record<ExportFormat, string>> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

function assertSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('The SVG has no usable dimensions.')
  }
  if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
    throw new Error(`The exported image is too large (max ${MAX_DIMENSION}px per side).`)
  }
}

function loadSvgImage(svg: string): Promise<{ image: HTMLImageElement; url: string }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }))
    const image = new Image()
    image.onload = () => resolve({ image, url })
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Failed to load the SVG for export.'))
    }
    image.src = url
  })
}

export function rasterMime(format: ExportFormat): string {
  const mime = RASTER_MIME[format]
  if (!mime) {
    throw new Error(`Unsupported raster format: ${format}`)
  }
  return mime
}

export async function svgToRasterBlob(
  svg: string,
  width: number,
  height: number,
  format: ExportFormat,
  jpegQuality = 90,
): Promise<Blob> {
  assertSize(width, height)
  const mime = rasterMime(format)
  const { image, url } = await loadSvgImage(svg)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(width)
    canvas.height = Math.ceil(height)
    const context = canvas.getContext('2d')
    if (!context) {
      throw new Error('Failed to create a canvas context for export.')
    }
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    const quality = format === 'jpeg' ? jpegQuality / 100 : undefined
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Failed to encode the image.'))),
        mime,
        quality,
      )
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

export async function svgToPdfBlob(svg: string, width: number, height: number): Promise<Blob> {
  assertSize(width, height)
  const { jsPDF } = await import('jspdf')
  const { svg2pdf } = await import('svg2pdf.js')

  const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement
  if (!element || element.nodeName.toLowerCase() !== 'svg') {
    throw new Error('Failed to parse the SVG for PDF export.')
  }

  // svg2pdf reads `getComputedStyle`, which is unreliable for detached nodes.
  // Attach off-screen for the duration of the conversion, then remove.
  const host = document.createElement('div')
  host.style.position = 'absolute'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = '0'
  host.style.height = '0'
  host.style.overflow = 'hidden'
  document.body.appendChild(host)
  host.appendChild(element)

  try {
    const pdf = new jsPDF(width > height ? 'l' : 'p', 'pt', [width, height])
    await svg2pdf(element, pdf, { x: 0, y: 0, width, height })
    return pdf.output('blob')
  } finally {
    host.remove()
  }
}
