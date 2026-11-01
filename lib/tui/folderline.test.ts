import { describe, expect, test } from 'vitest'
// @ts-ignore plain .mjs module has no type declarations
import { renderLive } from './live.mjs'

const ESCAPE = String.fromCharCode(27)
const BELL = String.fromCharCode(7)

describe('the scanned folder on the live board', () => {
  const board = (folder: string, preset = 'full') => renderLive({ folder, preset, rows: [], events: [], started: 0, now: 1000, width: 110, height: 40, color: false }).join(String.fromCharCode(10))
  test('shows the full folder path under the title', () => {
    expect(board('C:/Users/me/code/app')).toContain('scanning C:/Users/me/code/app')
  })
  test('shows the real preset in the title', () => {
    expect(board('C:/x', 'security')).toContain('. security')
  })
  test('control and escape characters in the folder or preset never reach the terminal', () => {
    const text = board('C:/x' + ESCAPE + '[2J' + BELL + '/evil', 'ful' + ESCAPE + ']0;hacked' + BELL + 'l')
    expect(text).not.toContain(ESCAPE)
    expect(text).not.toContain(BELL)
  })
})
