export type ElementCategory =
  | 'basic'
  | 'fractions'
  | 'scripts'
  | 'roots'
  | 'delimiters'
  | 'large-ops'
  | 'functions'
  | 'greek'
  | 'logic'
  | 'sets'
  | 'arrows'
  | 'accents'
  | 'matrices'

export interface EquationElement {
  id: string
  label: string
  latex: string
  display: string
  category: ElementCategory
  keywords: string[]
}

export const ELEMENT_CATEGORY_LABELS: Record<ElementCategory, string> = {
  basic: 'Basic',
  fractions: 'Fractions',
  scripts: 'Powers & Indices',
  roots: 'Roots',
  delimiters: 'Brackets',
  'large-ops': 'Sums & Integrals',
  functions: 'Functions',
  greek: 'Greek Letters',
  logic: 'Logic',
  sets: 'Sets',
  arrows: 'Arrows',
  accents: 'Accents',
  matrices: 'Matrices',
}

export const ELEMENT_CATEGORY_ORDER: ElementCategory[] = [
  'basic',
  'fractions',
  'scripts',
  'roots',
  'delimiters',
  'large-ops',
  'functions',
  'greek',
  'logic',
  'sets',
  'arrows',
  'accents',
  'matrices',
]
