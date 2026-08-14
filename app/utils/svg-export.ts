import { ensureMathJax } from './mathjax-loader'
import type { SvgRenderResult } from '~/types/export'

export interface EquationRenderOptions {
  display?: boolean
  color?: string
  background?: string | null
  padding?: number
  scale?: number
}

const SVG_CSS = [
  'svg a{fill:blue;stroke:blue}',
  '[data-mml-node="merror"]>g{fill:red;stroke:red}',
  '[data-mml-node="merror"]>rect[data-background]{fill:yellow;stroke:none}',
  '[data-frame],[data-line]{stroke-width:70px;fill:none}',
  '.mjx-dashed{stroke-dasharray:140}',
  '.mjx-dotted{stroke-linecap:round;stroke-dasharray:0,140}',
  'use[data-c]{stroke-width:3px}',
].join('')

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const XLINK_NAMESPACE = 'http://www.w3.org/1999/xlink'
const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>'
const EX_PIXELS = 8

export function sanitizeColor(value: string | null | undefined): string | null {
  if (!value) {
    return null
  }
  const match = value.trim().match(/^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/)
  return match ? match[0].toLowerCase() : null
}

export function stripXmlDeclaration(svg: string): string {
  if (svg.startsWith('<?xml')) {
    const end = svg.indexOf('?>')
    if (end !== -1) {
      return svg.slice(end + 2).trimStart()
    }
  }
  return svg
}

export function parseExSize(value: string | null | undefined): number | null {
  if (!value) {
    return null
  }
  const match = value.trim().match(/^(-?\d+(?:\.\d+)?)ex$/)
  return match ? Number(match[1]) : null
}

function parseViewBoxEx(value: string | null | undefined): { width: number; height: number } | null {
  if (!value) {
    return null
  }
  const parts = value.trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some(Number.isNaN)) {
    return null
  }
  return { width: parts[2]!, height: parts[3]! }
}

export function composeStandaloneSvg(params: {
  innerSvg: string
  widthPx: number
  heightPx: number
  padding: number
  color: string
  background: string | null
}): { svg: string; width: number; height: number } {
  const rawPadding = Number.isFinite(params.padding) ? params.padding : 0
  const padding = Math.max(0, Math.round(rawPadding))
  const width = Math.ceil(params.widthPx) + padding * 2
  const height = Math.ceil(params.heightPx) + padding * 2
  const color = sanitizeColor(params.color) ?? '#000000'
  const background = sanitizeColor(params.background)
  const backgroundRect = background
    ? `<rect x="0" y="0" width="${width}" height="${height}" fill="${background}"/>`
    : ''
  const svg = `${XML_DECLARATION}\n` +
    `<svg xmlns="${SVG_NAMESPACE}" xmlns:xlink="${XLINK_NAMESPACE}" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    backgroundRect +
    `<g transform="translate(${padding},${padding})" fill="${color}" stroke="${color}">${params.innerSvg}</g>` +
    `</svg>`
  return { svg, width, height }
}

export async function renderEquationSvg(
  latex: string,
  options: EquationRenderOptions = {},
): Promise<SvgRenderResult> {
  const MathJax = await ensureMathJax()
  const scale = Number.isFinite(options.scale) && (options.scale as number) > 0 ? (options.scale as number) : 1
  const padding = options.padding ?? 8
  const color = sanitizeColor(options.color) ?? '#000000'
  const background = options.background ? sanitizeColor(options.background) : null
  const ex = EX_PIXELS

  const node = await MathJax.tex2svgPromise(latex, {
    display: options.display ?? false,
    em: 16,
    ex,
    containerWidth: 80 * ex,
    scale: 1,
  })
  const adaptor = MathJax.startup.adaptor
  const svgEl = adaptor.tags(node, 'svg')[0] as SVGSVGElement | undefined
  if (!svgEl) {
    throw new Error('MathJax did not produce an SVG element')
  }

  const defs =
    adaptor.tags(svgEl, 'defs')[0] ||
    adaptor.append(svgEl, adaptor.create('defs', { namespace: SVG_NAMESPACE }))
  adaptor.append(defs, adaptor.node('style', {}, [adaptor.text(SVG_CSS)], SVG_NAMESPACE))

  const mathGroup = adaptor.tags(svgEl, 'g')[0] as SVGElement | undefined
  if (mathGroup) {
    adaptor.setAttribute(mathGroup, 'fill', color)
    adaptor.setAttribute(mathGroup, 'stroke', color)
  }

  const viewBox = parseViewBoxEx(svgEl.getAttribute('viewBox'))
  const widthEx = parseExSize(svgEl.getAttribute('width')) ?? (viewBox?.width ?? 0) / 1000
  const heightEx = parseExSize(svgEl.getAttribute('height')) ?? (viewBox?.height ?? 0) / 1000
  const widthPx = widthEx * ex * scale
  const heightPx = heightEx * ex * scale
  svgEl.setAttribute('width', `${widthPx}`)
  svgEl.setAttribute('height', `${heightPx}`)

  const hasErrors = node.querySelector('[data-mml-node="merror"]') !== null
  const innerSvg = adaptor.serializeXML ? adaptor.serializeXML(svgEl) : svgEl.outerHTML

  const composed = composeStandaloneSvg({
    innerSvg,
    widthPx,
    heightPx,
    padding,
    color,
    background,
  })
  return { svg: composed.svg, width: composed.width, height: composed.height, hasErrors }
}
