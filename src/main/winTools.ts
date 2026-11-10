import { join } from 'node:path'

// Windows' own tools, by full path. A bare name such as "powershell.exe" is looked for in the
// working folder before anywhere else, so a project folder (or a download) that holds a file of
// that name would have it run in place of the real one.
const win = process.platform === 'win32'
const SYSTEM32 = join(process.env.SystemRoot || process.env.windir || 'C:\\Windows', 'System32')

export const POWERSHELL = win ? join(SYSTEM32, 'WindowsPowerShell', 'v1.0', 'powershell.exe') : 'pwsh'
export const TASKKILL = win ? join(SYSTEM32, 'taskkill.exe') : 'taskkill'
export const REG = win ? join(SYSTEM32, 'reg.exe') : 'reg'
export const TAR = win ? join(SYSTEM32, 'tar.exe') : 'tar'
