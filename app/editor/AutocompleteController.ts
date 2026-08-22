import type { EditorAdaptor } from './EditorAdaptor'
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
  getAdaptor: () => EditorAdaptor | null
  insertElement: (element: EquationElement) => void
  commit: (adaptor: EditorAdaptor) => void
}

export class AutocompleteController {
  private command = ''
  private active = false

  constructor(private readonly options: AutocompleteOptions) {}

  trackKeydown(adaptor: EditorAdaptor, event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === '\\') {
      this.active = true
      this.command = ''
      return
    }
    if (!this.active) return
    if (adaptor.mode !== 'latex' && event.key !== 'Backspace') {
      this.reset()
      return
    }
    if (/^[a-zA-Z]$/.test(event.key)) this.command += event.key
    else if (event.key === 'Backspace') this.command = this.command.slice(0, -1)
    else if (event.key === 'Escape') this.reset()
  }

  completeCommand(adaptor: EditorAdaptor, event: KeyboardEvent): boolean {
    if (adaptor.mode !== 'latex') return false
    const name = this.command
    if (!name) return false

    const element = getElementByCommand(name)
    if (element) {
      this.rejectNativeCompletion(adaptor, event)
      this.options.insertElement(element)
      return true
    }
    if (DISABLED_LATEX_AUTOCOMPLETE_COMMANDS.has(name)) {
      this.rejectNativeCompletion(adaptor, event)
      return true
    }
    if (STYLE_SWITCH_COMMANDS.has(name)) {
      this.completeStyleSwitch(adaptor, name, event)
      return true
    }
    if (ROOT_ENVIRONMENT_COMMANDS.has(name)) {
      this.rejectNativeCompletion(adaptor, event)
      return true
    }
    return false
  }

  readonly onSuggestionClick = (event: MouseEvent): void => {
    const adaptor = this.options.getAdaptor()
    const name = adaptor?.suggestionCommandAt(event.target)
    if (!name || !DISABLED_LATEX_AUTOCOMPLETE_COMMANDS.has(name) || adaptor?.mode !== 'latex') return
    event.preventDefault()
    event.stopImmediatePropagation()
    adaptor.rejectCompletion()
    if (adaptor.value === '') adaptor.mode = 'math'
    this.reset()
  }

  private rejectNativeCompletion(adaptor: EditorAdaptor, event: Event): void {
    event.preventDefault()
    event.stopPropagation()
    adaptor.rejectCompletion()
    if (adaptor.value === '') adaptor.mode = 'math'
    this.reset()
  }

  private completeStyleSwitch(
    adaptor: EditorAdaptor,
    name: string,
    event: KeyboardEvent,
  ): void {
    this.rejectNativeCompletion(adaptor, event)
    const range = firstElementRangeAfter(adaptor)
    if (range) {
      adaptor.selection = { ranges: [range] }
      adaptor.insert(`\\${name}#@`, {
        insertionMode: 'replaceSelection',
        format: 'latex',
        mode: 'math',
        focus: true,
        scrollIntoView: true,
      })
    } else {
      adaptor.insert(`\\${name}{#0}`, {
        selectionMode: 'placeholder',
        format: 'latex',
        mode: 'math',
        focus: true,
        scrollIntoView: true,
      })
    }
    this.options.commit(adaptor)
  }

  private reset(): void {
    this.active = false
    this.command = ''
  }
}
