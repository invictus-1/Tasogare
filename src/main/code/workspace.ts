import { app, shell } from 'electron'
import { spawn } from 'node:child_process'
import { existsSync, promises as fs, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path'
import { HIDDEN_NOTE, hiddenCharacters, secretFile, stripHidden } from '@shared/code'
import { POWERSHELL, TASKKILL } from '../winTools'

// Everything the agent does to files goes through here, and nothing here reaches outside the
// session's folder: every path is resolved and checked against the folder's real location
// (links, short names and odd spellings included). Before anything is changed, the original is
// copied into a snapshot, so each step can be undone; deleting sends to the Recycle Bin rather
// than erasing. What the agent reads comes back with invisible characters taken out, and files
// that hold keys are left out of searches.

const SKIP = new Set(['node_modules', '.git', 'dist', 'out', 'build', 'release', '.next', '.venv', 'venv', '__pycache__', '.cache', 'coverage', 'target'])
const MAX_READ = 2 * 1024 * 1024
const MAX_OUTPUT = 30_000

export class OutsideFolder extends Error {}

/**
 * Where a path really is: links followed, and on Windows the name as the disk spells it, so a
 * short name (PROGRA~1) or another case can't stand in for a folder that is checked by name.
 */
export function real(path: string): string {
  try {
    return realpathSync.native(path)
  } catch {
    // Some drives (RAM disks, mapped ones) refuse the native call.
    return realpathSync(path)
  }
}

const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)(\s*\..*)?$/i

/**
 * Names Windows reads as something other than what is written: a colon names a hidden stream of a
 * file (notes.txt:other), a trailing dot or space is dropped (".git." is ".git"), and CON, NUL and
 * the like are devices wherever they appear. A drive letter at the front and ".." are left for the
 * folder check below.
 */
function refuseOddNames(rel: string): void {
  if (stripHidden(rel) !== rel) throw new Error(`${stripHidden(rel)} holds invisible characters, so it can't be shown as it is written. The agent can't use that name.`)
  rel.split(/[\\/]/).forEach((part, i) => {
    if (!part || part === '.' || part === '..' || (i === 0 && /^[a-z]:$/i.test(part))) return
    if (/[<>:"|?*\u0000-\u001f]/.test(part) || /[. ]$/.test(part)) throw new Error(`${stripHidden(rel)} isn't a name Windows keeps as written, so the agent can't use it.`)
    if (DEVICE.test(part)) throw new Error(`${stripHidden(rel)} names a Windows device, not a file.`)
  })
}

/** A path inside the folder, or an error that says it isn't. */
export function inside(root: string, rel: string): string {
  refuseOddNames(rel)
  const realRoot = real(root)
  const full = resolve(realRoot, rel || '.')
  // The deepest part that exists decides, so a link inside can't lead out.
  let probe = full
  while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe)
  const settled = resolve(real(probe), relative(probe, full))
  // Windows reads C:\Work and c:\work as one folder.
  const base = (realRoot.endsWith(sep) ? realRoot : realRoot + sep).toLowerCase()
  if (settled.toLowerCase() !== realRoot.toLowerCase() && !settled.toLowerCase().startsWith(base)) throw new OutsideFolder(`${stripHidden(rel)} is outside the folder this session works in.`)
  return settled
}

/** The same path, written relative to the folder with forward slashes. */
export const shown = (root: string, full: string): string => relative(real(root), full).split(sep).join('/') || '.'

/** Writes inside .git would let the agent rewrite history behind your back. */
function refuseGitInternals(root: string, full: string): void {
  // Windows reads .GIT and .git as the same folder.
  if (shown(root, full).toLowerCase().split('/').includes('.git')) throw new Error("Tasogare's agent doesn't change files inside .git. Use a git command instead, which asks first.")
}

/** A name as the agent is shown it: nothing invisible in it, and a word when something was. */
const named = (name: string): string => (hiddenCharacters(name) ? `${stripHidden(name)} (its name holds invisible characters)` : name)

export async function listFiles(root: string, rel = '.', depth = 2): Promise<string> {
  const start = inside(root, rel)
  const lines: string[] = []
  const walk = async (dir: string, level: number, indent: string): Promise<void> => {
    if (lines.length >= 400) return
    const entries = (await fs.readdir(dir, { withFileTypes: true })).sort((x, y) => Number(y.isDirectory()) - Number(x.isDirectory()) || x.name.localeCompare(y.name))
    for (const e of entries) {
      if (lines.length >= 400) {
        lines.push(`${indent}… (more not shown)`)
        return
      }
      // A link is named but never opened: where it leads is decided when something reads it.
      if (e.isSymbolicLink()) lines.push(`${indent}${named(e.name)} (link)`)
      else if (e.isDirectory()) {
        if (SKIP.has(e.name)) {
          lines.push(`${indent}${named(e.name)}/ (skipped)`)
          continue
        }
        lines.push(`${indent}${named(e.name)}/`)
        if (level < depth) await walk(join(dir, e.name), level + 1, `${indent}  `)
      } else lines.push(`${indent}${named(e.name)}`)
    }
  }
  await walk(start, 1, '')
  return lines.join('\n') || '(empty folder)'
}

export async function readFile(root: string, rel: string, offset = 1, limit = 2000): Promise<string> {
  const full = inside(root, rel)
  const info = await fs.stat(full)
  if (info.isDirectory()) throw new Error(`${rel} is a folder; list it instead.`)
  if (info.size > MAX_READ) throw new Error(`${rel} is ${(info.size / 1024 / 1024).toFixed(1)} MB, too big to read whole. Search it instead.`)
  const text = (await fs.readFile(full, 'utf8')).replace(/^\ufeff/, '')
  if (text.includes('\u0000')) throw new Error(`${rel} isn't a text file.`)
  const lines = text.split('\n')
  const from = Math.max(1, offset)
  const slice = lines.slice(from - 1, from - 1 + limit)
  // Invisible characters can carry whole sentences no editor shows. The agent gets the text
  // without them, and is told, so nothing reaches it that you could not have read yourself.
  const hidden = slice.some((l) => hiddenCharacters(l) > 0)
  const body = slice.map((l, i) => `${String(from + i).padStart(5)}  ${hidden ? stripHidden(l) : l}`).join('\n')
  const more = from - 1 + limit < lines.length ? `\n… ${lines.length - (from - 1 + limit)} more lines (read on with offset ${from + limit})` : ''
  return `${hidden ? `${HIDDEN_NOTE} Lines that held them will not match in edit_file as shown here.\n` : ''}${body}${more}`
}

/** Raw text of a file, or null if it doesn't exist (for diffs and snapshots). */
export async function currentText(root: string, rel: string): Promise<string | null> {
  const full = inside(root, rel)
  try {
    return await fs.readFile(full, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw err
  }
}

export async function searchFiles(root: string, pattern: string, rel = '.', glob?: string): Promise<string> {
  let re: RegExp
  try {
    re = new RegExp(pattern, 'i')
  } catch {
    re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
  }
  const ext = glob ? new RegExp(`^${glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`, 'i') : null
  const hits: string[] = []
  const base = real(root)
  const walk = async (dir: string): Promise<void> => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      if (hits.length >= 200) return
      // A link can lead anywhere on the disk, so a search never follows one.
      if (e.isSymbolicLink()) continue
      const full = join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP.has(e.name) && !e.name.startsWith('.')) await walk(full)
        continue
      }
      if (ext && !ext.test(e.name)) continue
      const name = relative(base, full).split(sep).join('/')
      // Files that hold keys are read one at a time, when you allow it, never swept up by a search.
      if (secretFile(name)) continue
      const info = await fs.stat(full)
      if (info.size > MAX_READ) continue
      const text = await fs.readFile(full, 'utf8').catch(() => '')
      if (text.includes('\u0000')) continue
      text.split('\n').forEach((line, i) => {
        if (hits.length < 200 && re.test(line)) hits.push(`${stripHidden(name)}:${i + 1}: ${stripHidden(line).trim().slice(0, 200)}`)
      })
    }
  }
  await walk(inside(root, rel))
  return hits.length ? hits.join('\n') + (hits.length >= 200 ? '\n… stopped at 200 matches; narrow the search' : '') : 'No matches.'
}

// ——— Snapshots ———

interface SnapshotFile {
  path: string
  /** Null when the file didn't exist before (undo removes it again). */
  backup: string | null
}

const snapshotDir = (sessionId: string, n: number): string => join(app.getPath('userData'), 'code-snapshots', sessionId, String(n))

/** Copies the files a step is about to change, before it changes them. */
export async function snapshot(sessionId: string, n: number, root: string, rels: string[]): Promise<void> {
  const dir = snapshotDir(sessionId, n)
  await fs.mkdir(dir, { recursive: true })
  const files: SnapshotFile[] = []
  for (const [i, rel] of rels.entries()) {
    const full = inside(root, rel)
    if (existsSync(full)) {
      const backup = join(dir, `${i}-${basename(full)}`)
      await fs.copyFile(full, backup)
      files.push({ path: rel, backup })
    } else files.push({ path: rel, backup: null })
  }
  await fs.writeFile(join(dir, 'snapshot.json'), JSON.stringify(files))
}

/** Puts a step's files back as they were. A file the step created goes to the Recycle Bin. */
export async function restore(sessionId: string, n: number, root: string): Promise<string[]> {
  const dir = snapshotDir(sessionId, n)
  const files = JSON.parse(await fs.readFile(join(dir, 'snapshot.json'), 'utf8')) as SnapshotFile[]
  for (const f of files) {
    const full = inside(root, f.path)
    if (f.backup) {
      await fs.mkdir(dirname(full), { recursive: true })
      await fs.copyFile(f.backup, full)
    } else if (existsSync(full)) await toRecycleBin(full)
  }
  return files.map((f) => f.path)
}

// ——— Changes ———

/** Sends a file to the Recycle Bin (in test runs, to a folder in the throwaway profile). */
export async function toRecycleBin(full: string): Promise<void> {
  if (process.env.TWILIGHT_E2E) {
    const bin = join(app.getPath('userData'), 'e2e-recycled')
    await fs.mkdir(bin, { recursive: true })
    await fs.rename(full, join(bin, `${Date.now()}-${basename(full)}`))
  } else await shell.trashItem(full)
}

export async function writeText(root: string, rel: string, text: string): Promise<void> {
  const full = inside(root, rel)
  refuseGitInternals(root, full)
  await fs.mkdir(dirname(full), { recursive: true })
  // A hard link shares its contents with a file somewhere else, perhaps outside the folder or in a
  // package manager's store, and writing through it would change that one too. The name is given
  // a file of its own instead; the snapshot already holds the old text.
  const info = await fs.stat(full).catch(() => null)
  if (info?.isFile() && info.nlink > 1) await fs.unlink(full)
  await fs.writeFile(full, text, 'utf8')
}

export async function removeFile(root: string, rel: string): Promise<void> {
  const full = inside(root, rel)
  refuseGitInternals(root, full)
  const info = await fs.stat(full)
  if (info.isDirectory()) throw new Error(`${rel} is a folder. The agent removes files one at a time, so each is snapshotted.`)
  await toRecycleBin(full)
}

/** The edited text: old_text must appear exactly (once, unless replacing every one). */
export function applyEdit(text: string, oldText: string, newText: string, all: boolean): string {
  if (!oldText) throw new Error('old_text is empty. To write a whole file, use write_file.')
  const count = text.split(oldText).length - 1
  if (count === 0) throw new Error("old_text wasn't found in the file. Read the file again and copy the text exactly, spaces and line breaks included.")
  if (count > 1 && !all) throw new Error(`old_text appears ${count} times. Include more surrounding lines so it's unique, or set replace_all.`)
  return all ? text.split(oldText).join(newText) : text.replace(oldText, () => newText)
}

// ——— Commands ———

const running = new Map<string, () => void>()

/** Stops a session's running command (and everything it started). */
export function stopCommand(sessionId: string): void {
  running.get(sessionId)?.()
}

/** Stops every running command: Tasogare is closing, and nothing it started should outlive it. */
export function stopAll(): void {
  for (const kill of [...running.values()]) kill()
}

// Environment values a command has no business seeing by default: Tasogare's own switches, and
// anything named like a key, a token or a password. A build or a test rarely needs them, and a
// command talked into printing its environment would otherwise hand them to the model.
const KEPT_FROM_COMMANDS = /^TWILIGHT_|^ELECTRON_RUN_AS_NODE$|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|(^|_)(KEY|PASS|DSN|PAT)(_|$)|(^|_)AUTH$|DATABASE_URL|CONNECTION_?STRING/i

/** Your environment as a command gets it. */
export function commandEnv(from: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(from)) if (!KEPT_FROM_COMMANDS.test(name)) env[name] = value
  return env
}

// Colour codes and cursor moves a terminal would obey; here they are only noise, or a way to draw
// over what was printed.
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(\u0007|\u001b\\)|\u001b[@-Z\\-_]/g

/** A command's output as the agent and you read it: plain text, nothing invisible. */
export function plainOutput(output: string): string {
  const plain = output.replace(ANSI, '').replace(/[\u0000-\u0008\u000b\u000e-\u001f\u007f]/g, '')
  return hiddenCharacters(plain) ? `${HIDDEN_NOTE}\n${stripHidden(plain)}` : plain
}

const GIT_RUNS_PROGRAM = /^\s*(fsmonitor\s*=\s*(?!(true|false|yes|no|on|off|0|1)\s*$)\S|(sshcommand|pager|editor|askpass|external|textconv|clean|smudge|process|helper|program|driver|cmd|command)\s*=)|^\s*\[\s*(include|includeif|alias)\b/im
const GIT_RUNS_HOOKS = /\bgit\b.*\b(commit|merge|rebase|checkout|switch|push|pull|am|cherry-pick|revert|gc|worktree|clone|fetch|apply|stash)\b/i

/**
 * A folder that was downloaded rather than cloned can bring its own .git, and git obeys what is in
 * it: settings that name a program to run (a file watcher, a filter, a pager), and hooks. So even
 * "git status" can run code there. Says why a git command deserves a second look in this folder,
 * or null.
 */
export function gitTraps(root: string, command: string): string | null {
  if (!/\bgit\b/i.test(command)) return null
  try {
    const git = join(real(root), '.git')
    if (!statSync(git).isDirectory()) return null
    const config = existsSync(join(git, 'config')) ? readFileSync(join(git, 'config'), 'utf8') : ''
    if (GIT_RUNS_PROGRAM.test(config)) return "this folder's git settings name a program that git runs by itself"
    if (!GIT_RUNS_HOOKS.test(command)) return null
    const hooks = existsSync(join(git, 'hooks')) ? readdirSync(join(git, 'hooks')).filter((name) => !name.endsWith('.sample')) : []
    return hooks.length || /^\s*hookspath\s*=/im.test(config) ? 'this folder has git hooks, which run by themselves' : null
  } catch {
    return null
  }
}

/** Whether the project has its own copy of a tool, so "npx <tool>" runs that rather than fetching one. */
export function hasTool(root: string, tool: string): boolean {
  try {
    return existsSync(join(real(root), 'node_modules', '.bin', `${tool}.cmd`))
  } catch {
    return false
  }
}

/** Runs one PowerShell command in the folder, with a time limit; returns its exit code and output. */
export function runCommand(sessionId: string, root: string, command: string, timeoutSeconds = 120): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  return new Promise((done) => {
    // PowerShell by its full path: a bare name is looked for in the working folder first, and the
    // working folder is the project.
    const child = spawn(POWERSHELL, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: real(root), windowsHide: true, env: commandEnv() })
    let output = ''
    let timedOut = false
    const add = (chunk: Buffer): void => {
      output += chunk.toString('utf8')
      // Keep the start and the end of very long output; the middle is rarely what matters.
      if (output.length > MAX_OUTPUT * 2) output = `${output.slice(0, MAX_OUTPUT / 2)}\n… (output trimmed) …\n${output.slice(-MAX_OUTPUT / 2)}`
    }
    child.stdout.on('data', add)
    child.stderr.on('data', add)
    const kill = (): void => {
      if (child.pid) spawn(TASKKILL, ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
    }
    running.set(sessionId, kill)
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, Math.min(600, Math.max(5, timeoutSeconds)) * 1000)
    child.on('close', (code) => {
      clearTimeout(timer)
      running.delete(sessionId)
      const plain = plainOutput(output)
      const trimmed = plain.length > MAX_OUTPUT ? `${plain.slice(0, MAX_OUTPUT / 2)}\n… (output trimmed) …\n${plain.slice(-MAX_OUTPUT / 2)}` : plain
      done({ code, output: trimmed.trimEnd(), timedOut })
    })
    child.on('error', (err) => {
      clearTimeout(timer)
      running.delete(sessionId)
      done({ code: null, output: String(err), timedOut: false })
    })
  })
}

export const extOf = (rel: string): string => extname(rel).slice(1).toLowerCase()
