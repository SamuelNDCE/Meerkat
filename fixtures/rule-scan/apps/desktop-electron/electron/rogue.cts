import { ipcMain } from 'electron'
ipcMain.handle('nv:rogue', async (_e, p: unknown) => p)
const w = { webPreferences: { nodeIntegration: true } }
