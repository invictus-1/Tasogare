import { app } from 'electron'
import { createReadStream, createWriteStream, existsSync, mkdirSync, promises as fs, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'

// Where Tasogare keeps its data. The standard place is %APPDATA%\Twilight (the name it had before
// 1.6, kept so existing data stays where it is: the database holds full paths into it); you can choose another
// (a bigger drive, a synced folder). A small pointer file in the standard place says where the
// data is. A move is done on the next start, before anything opens the data: everything is
// copied to the new folder, checked, and only then used. The old copy stays where it was until
// you remove it, so a move never loses anything. A start that has a move to do, or whose moved
// folder isn't there, is settled with a window on screen first (settle.ts).

const POINTER = 'location.json'
/** The app's name before 1.6, which its data folder keeps. */
const LEGACY_NAME = 'Twilight'

interface Pointer {
  /** The folder in use, when it isn't the standard one. */
  path?: string
  /** A move to do on the next start. */
  pendingMove?: string
  /** What the last start did, for Settings to show. */
  last?: { kind: 'moved' | 'move-failed'; detail: string; at: number }
}

/** Chromium's caches are rebuilt on their own; copying them would only slow a move. */
const SKIP = new Set(['Cache', 'Code Cache', 'GPUCache', 'DawnGraphiteCache', 'DawnWebGPUCache', 'GPUPersistentCache', 'GrShaderCache', 'ShaderCache', 'blob_storage', POINTER])

export const standardFolder = (): string => join(app.getPath('appData'), LEGACY_NAME)

function read(standard: string): Pointer {
  try {
    return JSON.parse(readFileSync(join(standard, POINTER), 'utf8')) as Pointer
  } catch {
    return {}
  }
}

function write(standard: string, pointer: Pointer): void {
  mkdirSync(standard, { recursive: true })
  writeFileSync(join(standard, POINTER), JSON.stringify(pointer, null, 2))
}

/** A folder you can move to: new, or empty (the standard place may still hold the old copy). */
export function checkTarget(target: string, current: string, standard = standardFolder()): string | null {
  if (!target.trim()) return 'Choose a folder.'
  const norm = (p: string): string => p.replace(/[\\/]+$/, '').toLowerCase()
  if (norm(target) === norm(current)) return 'Tasogare already keeps its data there.'
  if (norm(target).startsWith(`${norm(current)}\\`) || norm(target).startsWith(`${norm(current)}/`)) return "That folder is inside the current data folder; choose one outside it."
  if (norm(target) !== norm(standard) && existsSync(target) && readdirSync(target).length) return 'Choose an empty folder (or a new one), so nothing in it is mixed with Tasogare\'s data.'
  return null
}

/** Sets up a move for the next start. */
export function stageMove(target: string, standard = standardFolder()): void {
  write(standard, { ...read(standard), pendingMove: target })
}

/** What a start finds: the folder to use, and anything to settle before it is opened. */
export interface StartFolder {
  folder: string
  /** The data was moved to this folder and it isn't there now (a drive not connected, a folder renamed). */
  missing?: string
  /** A move to do before anything opens the data. */
  move?: string
}

/** Runs before the app is ready and changes nothing: where the data is, and what has to happen first. */
export function startFolder(standard = standardFolder()): StartFolder {
  const pointer = read(standard)
  const start: StartFolder = { folder: pointer.path ?? standard }
  // Starting in the standard folder instead would look like every chat had gone, and would begin
  // a second set of data beside the first; so the start asks.
  if (pointer.path && !existsSync(pointer.path)) start.missing = pointer.path
  if (pointer.pendingMove) start.move = pointer.pendingMove
  return start
}

/** Goes back to the standard folder after a moved one could not be found; a move staged from it goes too. */
export function forgetMoved(standard = standardFolder()): void {
  const pointer = read(standard)
  if (!pointer.path) return
  write(standard, { last: { kind: 'move-failed', detail: `${pointer.path} could not be found, so Tasogare went back to its standard folder.`, at: Date.now() } })
}

export interface MoveProgress {
  /** Bytes copied so far, and in all. */
  done: number
  total: number
  /** The file being copied, as a path inside the data folder. */
  file: string
}

/** Files this big are copied in pieces, so the progress keeps moving through a model of many gigabytes. */
const IN_PIECES = 64 * 1024 * 1024

/**
 * Does a staged move and returns the folder to use: the new one, or the old one when the move
 * failed (the reason is kept for Settings, and `failed` holds it). Every file is checked by size
 * as it lands, and the new folder is used only once all of them have. Never throws.
 */
export async function moveData(standard = standardFolder(), onProgress?: (p: MoveProgress) => void): Promise<{ folder: string; failed?: string }> {
  const pointer = read(standard)
  const current = pointer.path ?? standard
  const target = pointer.pendingMove
  if (!target) return { folder: current }
  delete pointer.pendingMove
  try {
    if (!existsSync(current)) throw new Error(`${current} could not be found.`)
    await fs.mkdir(target, { recursive: true })
    const files = await listData(current)
    const total = files.reduce((sum, f) => sum + f.size, 0)
    const room = await freeSpace(target)
    if (room !== null && room < total) throw new Error(`There isn't room there: the data is ${sizeLabel(total)} and the drive has ${sizeLabel(room)} free.`)
    let done = 0
    for (const f of files) {
      const from = join(current, f.rel)
      const to = join(target, f.rel)
      onProgress?.({ done, total, file: f.rel })
      await fs.mkdir(dirname(to), { recursive: true })
      if (f.size < IN_PIECES) await fs.copyFile(from, to)
      else {
        const base = done
        let within = 0
        await pipeline(
          createReadStream(from, { highWaterMark: 4 * 1024 * 1024 }).on('data', (chunk) => {
            within += chunk.length
            onProgress?.({ done: base + within, total, file: f.rel })
          }),
          createWriteStream(to)
        )
      }
      // Check the copy before trusting it.
      if ((await fs.stat(to)).size !== f.size) throw new Error(`${f.rel} didn't copy whole.`)
      done += f.size
    }
    onProgress?.({ done: total, total, file: '' })
    // Back to the standard place: the pointer simply goes.
    const usingStandard = target.replace(/[\\/]+$/, '').toLowerCase() === standard.replace(/[\\/]+$/, '').toLowerCase()
    write(standard, { ...pointer, path: usingStandard ? undefined : target, last: { kind: 'moved', detail: `${files.length} files from ${current}`, at: Date.now() } })
    return { folder: target }
  } catch (err) {
    const failed = (err as Error).message
    write(standard, { ...pointer, last: { kind: 'move-failed', detail: failed, at: Date.now() } })
    return { folder: current, failed }
  }
}

/** Every file to copy, as paths inside the folder; the caches at the top are left behind. */
async function listData(from: string): Promise<{ rel: string; size: number }[]> {
  const files: { rel: string; size: number }[] = []
  const walk = async (rel: string): Promise<void> => {
    for (const e of await fs.readdir(join(from, rel), { withFileTypes: true })) {
      if (!rel && SKIP.has(e.name)) continue
      const at = rel ? join(rel, e.name) : e.name
      if (e.isDirectory()) await walk(at)
      else if (e.isFile()) files.push({ rel: at, size: (await fs.stat(join(from, at))).size })
    }
  }
  await walk('')
  return files
}

/** Free room on the drive a folder is on, or null when it can't be told. */
async function freeSpace(folder: string): Promise<number | null> {
  try {
    const s = await fs.statfs(folder)
    return s.bavail * s.bsize
  } catch {
    return null
  }
}

const sizeLabel = (bytes: number): string => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`)

/** A folder in Documents: the one by the app's old name when only that exists, else the new name. */
export function documentsFolder(name: string, legacy: string): string {
  const documents = app.getPath('documents')
  return !existsSync(join(documents, name)) && existsSync(join(documents, legacy)) ? join(documents, legacy) : join(documents, name)
}

export function lastLocationChange(standard = standardFolder()): Pointer['last'] | null {
  return read(standard).last ?? null
}

export function isMoved(standard = standardFolder()): boolean {
  return !!read(standard).path
}
