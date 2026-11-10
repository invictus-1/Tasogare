import { app, BrowserWindow, dialog } from 'electron'
import { existsSync } from 'node:fs'
import { forgetMoved, moveData, standardFolder, startFolder, type MoveProgress } from './location'

// A start that can't open the data yet: it was moved to a folder that isn't there now, or a move
// you asked for has to be done first. Both are settled here, with something on screen, before
// anything opens the data; then Tasogare starts again in the folder that was settled on. While
// this runs the app keeps its own files in a temporary folder, so nothing is written to either
// data folder by the window itself.

/** What you chose when the data folder couldn't be found. */
export type MissingChoice = 'again' | 'standard' | 'quit'

function askMissing(missing: string, standard: string): MissingChoice {
  const choice = dialog.showMessageBoxSync({
    type: 'warning',
    title: 'Tasogare',
    message: "Tasogare can't find its data folder",
    detail: `${missing}\n\nIf it is on a drive that isn't connected, connect it and try again. The standard folder (${standard}) holds whatever was there before the move; nothing in the missing folder is changed either way.`,
    buttons: ['Try again', 'Use the standard folder', 'Quit'],
    defaultId: 0,
    cancelId: 2,
    noLink: true
  })
  return choice === 0 ? 'again' : choice === 1 ? 'standard' : 'quit'
}

const gb = (bytes: number): string => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`)

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html, body { margin: 0; height: 100%; }
  body { box-sizing: border-box; padding: 22px 24px; background: #0b0d1c; color: #eceefe; font: 13px/1.5 'Segoe UI', system-ui, sans-serif; user-select: none; cursor: default; }
  h1 { margin: 0 0 2px; font-size: 15px; font-weight: 600; }
  p { margin: 0; color: #a6abd8; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar { height: 6px; margin: 16px 0 8px; border-radius: 3px; background: #272c5a; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; border-radius: 3px; background: linear-gradient(90deg, #9497ff, #c4a0ff 55%, #ffb48a); transition: width 0.15s linear; }
  .row { display: flex; justify-content: space-between; gap: 16px; }
  #file { flex: 1; min-width: 0; }
</style></head><body>
<h1>Moving your data</h1>
<p id="to"></p>
<div class="bar"><i id="fill"></i></div>
<div class="row"><p id="file"></p><p id="count"></p></div>
<script>
  window.show = (to, file, count, part) => {
    document.getElementById('to').textContent = to
    document.getElementById('file').textContent = file
    document.getElementById('count').textContent = count
    document.getElementById('fill').style.width = (part * 100).toFixed(1) + '%'
  }
</script></body></html>`

/** The small window a move shows while it copies. It can't be closed: stopping halfway would leave half a copy. */
export async function moveWindow(target: string): Promise<{ win: BrowserWindow; show: (p: MoveProgress) => void }> {
  const win = new BrowserWindow({
    width: 460,
    height: 168,
    useContentSize: true,
    resizable: false,
    minimizable: true,
    maximizable: false,
    closable: false,
    fullscreenable: false,
    title: 'Tasogare',
    backgroundColor: '#0b0d1c',
    autoHideMenuBar: true,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false }
  })
  win.setMenu(null)
  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(PAGE)}`)
  let last = 0
  const show = (p: MoveProgress): void => {
    // A few times a second is plenty, and the last word always lands.
    const now = Date.now()
    if (p.done < p.total && now - last < 120) return
    last = now
    if (win.isDestroyed()) return
    const part = p.total ? p.done / p.total : 0
    win.setProgressBar(part)
    void win.webContents.executeJavaScript(`show(${JSON.stringify(`To ${target}`)}, ${JSON.stringify(p.file)}, ${JSON.stringify(p.total ? `${gb(p.done)} of ${gb(p.total)}` : 'Getting ready')}, ${part})`).catch(() => undefined)
  }
  show({ done: 0, total: 0, file: '' })
  return { win, show }
}

export interface SettleOptions {
  standard?: string
  /** Asks what to do about a missing folder (the tests answer for themselves). */
  ask?: (missing: string, standard: string) => MissingChoice
  /** Says a move failed. */
  tell?: (message: string, detail: string) => void
  /** What happens once the folder is settled: Tasogare starts again. */
  finish?: (outcome: 'start' | 'quit') => void
}

/** Settles where the data is, then starts Tasogare again (or quits, when you chose to). */
export async function settle(options: SettleOptions = {}): Promise<void> {
  const standard = options.standard ?? standardFolder()
  const ask = options.ask ?? askMissing
  const tell = options.tell ?? ((message, detail) => void dialog.showMessageBoxSync({ type: 'error', title: 'Tasogare', message, detail, buttons: ['OK'], noLink: true }))
  const finish =
    options.finish ??
    ((outcome) => {
      if (outcome === 'start') app.relaunch()
      app.exit(0)
    })
  let start = startFolder(standard)
  while (start.missing) {
    const choice = ask(start.missing, standard)
    if (choice === 'quit') return finish('quit')
    if (choice === 'standard') forgetMoved(standard)
    else if (!existsSync(start.missing)) continue
    start = startFolder(standard)
  }
  if (start.move) {
    const { win, show } = await moveWindow(start.move)
    const moved = await moveData(standard, show)
    if (moved.failed) tell("Your data wasn't moved", `${moved.failed}\n\nNothing was changed. Tasogare goes on using ${moved.folder}.`)
    // Leaving ends the window in the app itself; this is for a run that goes on (the tests).
    finish('start')
    if (!win.isDestroyed()) win.destroy()
    return
  }
  finish('start')
}
