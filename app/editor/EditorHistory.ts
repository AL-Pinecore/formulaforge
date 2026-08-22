import type { CaretBookmark } from './EditorAdaptor'

export interface HistoryEntry {
  latex: string
  caret: CaretBookmark
}

export class EditorHistory {
  private readonly entries: HistoryEntry[] = []
  private index = -1

  constructor(private readonly limit = 1000) {}

  get canUndo(): boolean {
    return this.index > 0
  }

  get canRedo(): boolean {
    return this.index >= 0 && this.index < this.entries.length - 1
  }

  record(entry: HistoryEntry): void {
    if (this.entries[this.index]?.latex === entry.latex) {
      this.entries[this.index] = entry
      return
    }
    this.entries.splice(this.index + 1)
    this.entries.push(entry)
    if (this.entries.length > this.limit) this.entries.shift()
    this.index = this.entries.length - 1
  }

  undo(): HistoryEntry | null {
    return this.canUndo ? this.entries[--this.index]! : null
  }

  redo(): HistoryEntry | null {
    return this.canRedo ? this.entries[++this.index]! : null
  }
}
