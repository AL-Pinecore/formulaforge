import { describe, expect, it } from 'vitest'
import { EditorHistory } from '../../app/editor/EditorHistory'

describe('EditorHistory', () => {
  it('undoes, redoes, and replaces a redo branch', () => {
    const history = new EditorHistory()
    history.record({ latex: 'a', caret: { latexOffset: 1 } })
    history.record({ latex: 'ab', caret: { latexOffset: 2 } })
    history.record({ latex: 'abc', caret: { latexOffset: 3 } })

    expect(history.undo()).toEqual({ latex: 'ab', caret: { latexOffset: 2 } })
    expect(history.redo()).toEqual({ latex: 'abc', caret: { latexOffset: 3 } })
    expect(history.undo()).toEqual({ latex: 'ab', caret: { latexOffset: 2 } })

    history.record({ latex: 'abd', caret: { latexOffset: 3 } })
    expect(history.canRedo).toBe(false)
    expect(history.undo()).toEqual({ latex: 'ab', caret: { latexOffset: 2 } })
  })

  it('updates the caret without adding a duplicate snapshot and respects the limit', () => {
    const history = new EditorHistory(2)
    history.record({ latex: 'a', caret: { latexOffset: 0 } })
    history.record({ latex: 'a', caret: { latexOffset: 1 } })
    history.record({ latex: 'ab', caret: { latexOffset: 2 } })
    history.record({ latex: 'abc', caret: { latexOffset: 3 } })

    expect(history.undo()).toEqual({ latex: 'ab', caret: { latexOffset: 2 } })
    expect(history.undo()).toBeNull()
  })
})
