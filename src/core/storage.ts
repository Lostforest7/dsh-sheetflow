import { readFile, writeFile, realpath, mkdir, lstat, rename, readdir } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { FlowError } from '../shared/model.ts'
export function relativeFile(file: string): string {
  if (
    !file ||
    file.length > 260 ||
    path.isAbsolute(file) ||
    /^[A-Za-z]:|[\u0000-\u001F]/.test(file) ||
    file.split(/[\\/]/).some((x) => x === '..' || x === '.git' || x === '.credentials.yaml' || x === '.env')
  )
    throw new FlowError('invalid-path', 'Choose a relative workspace file path.')
  return file.replaceAll('\\', '/')
}
export class Workspace {
  constructor(public root: string) {}
  async file(file: string, create = false): Promise<string> {
    const rel = relativeFile(file),
      root = await realpath(this.root),
      full = path.resolve(root, rel),
      resolved = create
        ? path.join(await realpath(path.dirname(full)), path.basename(full))
        : await realpath(full)
    const back = path.relative(root, resolved)
    if (back.startsWith('..') || path.isAbsolute(back))
      throw new FlowError('outside-workspace', 'File is outside the current workspace.')
    if (create) {
      const info = await lstat(full).catch(() => undefined)
      if (info) throw new FlowError('already-exists', 'Export never overwrites an existing file.')
    }
    return resolved
  }
  async read(file: string): Promise<Uint8Array> {
    const full = await this.file(file),
      info = await lstat(full)
    if (!info.isFile() || info.size > 20 * 1024 * 1024)
      throw new FlowError('file-limit', 'Use a regular file of at most 20 MiB.')
    return readFile(full)
  }
  async privateDir(): Promise<string> {
    const root = await realpath(this.root),
      p = path.join(root, '.dsh-sheetflow')
    await mkdir(p, { recursive: true })
    const actual = await realpath(p),
      back = path.relative(root, actual)
    if (back.startsWith('..') || path.isAbsolute(back))
      throw new FlowError('outside-workspace', 'Private storage must remain in this workspace.')
    return actual
  }
  async readJson<T>(name: string): Promise<T | undefined> {
    const dir = await this.privateDir()
    try {
      return JSON.parse(await readFile(path.join(dir, name), 'utf8'))
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw e
    }
  }
  async writeJson(name: string, value: unknown): Promise<void> {
    const dir = await this.privateDir(),
      dest = path.join(dir, name),
      temp = path.join(dir, randomUUID() + '.tmp')
    await writeFile(temp, JSON.stringify(value, null, 2), { flag: 'wx' })
    await rename(temp, dest)
  }
  async list(): Promise<string[]> {
    const root = await realpath(this.root),
      out: string[] = []
    const walk = async (dir: string, depth: number) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (out.length >= 200) return
        if (
          e.name.startsWith('.') ||
          ['node_modules', 'work', 'lib', 'test-results', 'playwright-report'].includes(e.name) ||
          e.isSymbolicLink()
        )
          continue
        const p = path.join(dir, e.name)
        if (e.isDirectory() && depth < 3) await walk(p, depth + 1)
        else if (e.isFile() && /\.(xlsx|csv)$/i.test(e.name))
          out.push(path.relative(root, p).replaceAll('\\', '/'))
        if (out.length >= 200) return
      }
    }
    await walk(root, 0)
    return out.sort()
  }
}
