export interface MathJaxLike {
  startup: { promise: Promise<void>; adaptor: any }
  tex2svgPromise: (math: string, options?: Record<string, unknown>) => Promise<SVGElement>
}

declare global {
  interface Window {
    MathJax?: MathJaxLike
  }
}

let loadPromise: Promise<MathJaxLike> | null = null

function loadMathJax(): Promise<MathJaxLike> {
  const existing = window.MathJax
  if (existing?.startup?.promise) {
    return existing.startup.promise.then(() => existing)
  }
  window.MathJax = {
    // Dynamic glyph data loads as <fonts-path> + /mathjax-newcm-font/svg/dynamic/*.js
    // from the bundled copy in public/mathjax-newcm-font; an empty base keeps the
    // leading slash root-relative.
    loader: { paths: { fonts: '' } },
    options: { enableMenu: false },
    svg: { fontCache: 'local', blacker: 3, useXlink: true },
    tex: {
      // MathLive serializes its differential as `\differentialD`; MathJax has
      // no such command, so map it to the standard upright differential.
      macros: { differentialD: '\\mathrm{d}' },
    },
  } as unknown as MathJaxLike
  const attempt = new Promise<MathJaxLike>((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/mathjax/tex-svg.js'
    script.async = true
    script.onload = () => {
      const mathjax = window.MathJax
      if (!mathjax?.startup?.promise) {
        reject(new Error('MathJax failed to initialize'))
        return
      }
      mathjax.startup.promise.then(() => resolve(mathjax), reject)
    }
    script.onerror = () => {
      script.remove()
      reject(new Error('Failed to load the bundled MathJax component'))
    }
    document.head.appendChild(script)
  })
  // Allow a transient failure (e.g. an interrupted asset load) to be retried.
  return attempt.catch((error) => {
    loadPromise = null
    throw error
  })
}

export function ensureMathJax(): Promise<MathJaxLike> {
  if (!loadPromise) {
    loadPromise = loadMathJax()
  }
  return loadPromise
}
