import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

describe('tauri window configuration', () => {
  it('disables native drag/drop interception so HTML5 drag/drop reaches the webview', () => {
    const config = JSON.parse(readFileSync(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'))
    const window = config.app.windows[0]
    expect(window.dragDropEnabled).toBe(false)
  })
})

describe('tauri capabilities', () => {
  it('does not grant broad dialog permissions to the webview', () => {
    const capabilities = JSON.parse(
      readFileSync(path.join(root, 'src-tauri/capabilities/default.json'), 'utf8'),
    )
    expect(capabilities.permissions).toEqual(['core:default'])
  })
})
