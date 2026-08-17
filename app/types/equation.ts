export type ElementCategory =
  | 'basic'
  | 'fractions'
  | 'scripts'
  | 'roots'
  | 'delimiters'
  | 'large-ops'
  | 'functions'
  | 'text'
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
  basic: 'category.basic',
  fractions: 'category.fractions',
  scripts: 'category.scripts',
  roots: 'category.roots',
  delimiters: 'category.delimiters',
  'large-ops': 'category.largeOps',
  functions: 'category.functions',
  text: 'category.text',
  greek: 'category.greek',
  logic: 'category.logic',
  sets: 'category.sets',
  arrows: 'category.arrows',
  accents: 'category.accents',
  matrices: 'category.matrices',
}

export const ELEMENT_CATEGORY_ORDER: ElementCategory[] = [
  'basic',
  'fractions',
  'scripts',
  'roots',
  'delimiters',
  'large-ops',
  'functions',
  'text',
  'greek',
  'logic',
  'sets',
  'arrows',
  'accents',
  'matrices',
]
