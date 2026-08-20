import type { MathfieldElement } from 'mathlive'
import { getElementByCommand } from '~/data/equation-elements'
import type { EquationElement } from '~/types/equation'
import { DISABLED_LATEX_AUTOCOMPLETE_COMMANDS } from '~/utils/latex-autocomplete'
import { firstElementRangeAfter, typedCommandName } from './MathLiveAdapter'

const STYLE_SWITCH_COMMANDS = new Set([
  'displaystyle',
  'textstyle',
  'scriptstyle',
  'scriptscriptstyle',
])

const ROOT_ENVIRONMENT_COMMANDS = new Set(['displaylines'])

type AutocompleteOptions = {
  getMathfield: () => MathfieldElement | null
  insertElement: (element: EquationElement) => void
  commit: (mf: MathfieldElement) => void
}

export class AutocompleteController {
  constructor(private readonly options: AutocompleteOptions) {}

  completeCommand(mf: MathfieldElement, event: KeyboardEvent): boolean {
    if (mf.mode !== 'latex') return false
    const name = typedCommandName(mf)
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
  }

  private rejectNativeCompletion(mf: MathfieldElement, event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    mf.executeCommand(['complete', 'reject'])
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
}
