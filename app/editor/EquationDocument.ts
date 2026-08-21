import { EditorHistory, type HistoryEntry } from './EditorHistory'

type Listener = () => void

// FormulaForge's own copy of the formula being edited: public LaTeX plus the
// caret position and the semantic undo/redo history. The editing backend is
// never the source of truth — it only renders the LaTeX this document hands it
// and reports edits back. Plain class, no Vue, no backend dependency.
export class EquationDocument {
  private latexValue = ''
  private errorsValue: string[] = []
  private positionValue = 0
  private readonly history = new EditorHistory()
  private readonly listeners = new Set<Listener>()

  get latex(): string {
    return this.latexValue
  }

  get errors(): string[] {
    return this.errorsValue
  }

  get position(): number {
    return this.positionValue
  }

  get canUndo(): boolean {
    return this.history.canUndo
  }

  get canRedo(): boolean {
    return this.history.canRedo
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  // Record an edit into history and publish the new state.
  commit(latex: string, position: number, errors: string[]): void {
    this.latexValue = latex
    this.errorsValue = errors
    this.positionValue = position
    this.history.record({ latex, position })
    this.notify()
  }

  // Publish state without creating a history entry (undo/redo round-trips).
  restore(latex: string, position: number, errors: string[]): void {
    this.latexValue = latex
    this.errorsValue = errors
    this.positionValue = position
    this.notify()
  }

  undo(): HistoryEntry | null {
    const entry = this.history.undo()
    this.notify()
    return entry
  }

  redo(): HistoryEntry | null {
    const entry = this.history.redo()
    this.notify()
    return entry
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }
}
