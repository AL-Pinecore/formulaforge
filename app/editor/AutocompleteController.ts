import type { MathfieldElement } from 'mathlive'
import { getElementByCommand } from '~/data/equation-elements'
import type { EquationElement } from '~/types/equation'
import { DISABLED_LATEX_AUTOCOMPLETE_COMMANDS } from '~/utils/latex-autocomplete'
import { firstElementRangeAfter } from './SelectionController'

const STYLE_SWITCH_COMMANDS = new Set([
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
])

const ROOT_ENVIRONMENT_COMMANDS = new Set(['displayline', 'displaylines'])

type AutocompleteOptions = {
  getMathfield: () => MathfieldElement | null
  insertElement: (element: EquationElement) => void
  commit: (mf: MathfieldElement) => void
}

export class AutocompleteController {
  private command = ''
  private active = false

  constructor(private readonly options: AutocompleteOptions) {}

  trackKeydown(mf: MathfieldElement, event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === '\\') {
      this.active = true
      this.command = ''
      return
    }
    if (!this.active) return
    if (mf.mode !== 'latex' && event.key !== 'Backspace') {
      this.reset()
      return
    }
    if (/^[a-zA-Z]$/.test(event.key)) this.command += event.key
    else if (event.key === 'Backspace') this.command = this.command.slice(0, -1)
    else if (event.key === 'Escape') this.reset()
  }

  completeCommand(mf: MathfieldElement, event: KeyboardEvent): boolean {
    if (mf.mode !== 'latex') return false
    const name = this.command
    if (!name) return false

    const element = getElementByCommand(name)
    if (element) {
      this.rejectNativeCompletion(mf, event)
      this.options.insertElement(element)
      return true
    }
    if (DISABLED_LATEX_AUTOCOMPLETE_COMMANDS.has(name)) {
      this.rejectNativeCompletion(mf, event)
      return true
    }
    if (STYLE_SWITCH_COMMANDS.has(name)) {
      this.completeStyleSwitch(mf, name, event)
      return true
    }
    if (ROOT_ENVIRONMENT_COMMANDS.has(name)) {
      this.rejectNativeCompletion(mf, event)
      return true
    }
    return false
  }

  readonly onSuggestionClick = (event: MouseEvent): void => {
    const item = (event.target as Element | null)?.closest<HTMLElement>(
      '#mathlive-suggestion-popover [data-command]',
    )
    const name = item?.dataset.command?.match(/^\\([a-zA-Z]+)/)?.[1]
    const mf = this.options.getMathfield()
    if (!name || !DISABLED_LATEX_AUTOCOMPLETE_COMMANDS.has(name) || mf?.mode !== 'latex') return
    event.preventDefault()
    event.stopImmediatePropagation()
    mf.executeCommand(['complete', 'reject'])
    if (mf.value === '') mf.mode = 'math'
    this.reset()
  }

  private rejectNativeCompletion(mf: MathfieldElement, event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    mf.executeCommand(['complete', 'reject'])
    if (mf.value === '') mf.mode = 'math'
    this.reset()
  }

  private completeStyleSwitch(
    mf: MathfieldElement,
    name: string,
    event: KeyboardEvent,
  ): void {
    this.rejectNativeCompletion(mf, event)
    const range = firstElementRangeAfter(mf)
    if (range) {
      mf.selection = { ranges: [range] }
      mf.insert(`\\${name}#@`, {
        insertionMode: 'replaceSelection',
        format: 'latex',
        mode: 'math',
        focus: true,
        scrollIntoView: true,
      })
    } else {
      mf.insert(`\\${name}{#0}`, {
        selectionMode: 'placeholder',
        format: 'latex',
        mode: 'math',
        focus: true,
        scrollIntoView: true,
      })
    }
    this.options.commit(mf)
  }

  private reset(): void {
    this.active = false
    this.command = ''
  }
}
