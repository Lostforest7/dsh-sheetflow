import { writeFile, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { Workspace } from './storage.ts'
import { readBook, sheetOf, fillTemplate } from './workbook.ts'
import { reconcile, planChanges, hash } from './engine.ts'
import { reportHtml } from './report.ts'
import {
  RecipeSchema,
  FlowError,
  columnName,
  type Preview,
  type FileDescription,
  type Recipe,
} from '../shared/model.ts'
const id = z.string().regex(/^[a-f0-9-]{36}$/),
  version = z.number().int().nonnegative()
export class SheetFlowService {
  private locks = new Map<string, Promise<unknown>>()
  async execute(
    root: string,
    session: string,
    op: string,
    raw: unknown = {},
    signal?: AbortSignal,
  ): Promise<unknown> {
    const key = root + '\0' + session,
      previous = this.locks.get(key) ?? Promise.resolve()
    const pending = previous
      .catch(() => {})
      .then(() => {
        signal?.throwIfAborted()
        return this.run(new Workspace(root), session, op, raw, signal)
      })
    this.locks.set(key, pending)
    try {
      return await pending
    } finally {
      if (this.locks.get(key) === pending) this.locks.delete(key)
    }
  }
  private prefix(session: string) {
    return hash(session).slice(0, 20)
  }
  private async run(
    ws: Workspace,
    session: string,
    op: string,
    raw: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    const prefix = this.prefix(session)
    if (op === 'validateRecipe') return RecipeSchema.parse(raw)
    if (op === 'listFiles') return ws.list()
    if (op === 'describe') {
      const args = z
          .object({ path: z.string(), headerRow: z.number().int().min(1).max(50).default(1) })
          .parse(raw),
        bytes = await ws.read(args.path),
        book = readBook(bytes, args.path)
      const result: FileDescription = {
        path: args.path,
        hash: hash(bytes),
        format: book.format,
        sheets: book.sheets.map((s) => ({
          name: s.name,
          rows: s.maxRow,
          columns: Array.from({ length: s.maxCol }, (_, i) => ({
            column: columnName(i + 1),
            header: s.cells[columnName(i + 1) + args.headerRow]?.value ?? '',
          })),
          sample: Array.from({ length: Math.min(5, Math.max(0, s.maxRow - args.headerRow)) }, (_, i) =>
            Array.from(
              { length: s.maxCol },
              (_, j) => s.cells[columnName(j + 1) + (i + args.headerRow + 1)]?.value ?? '',
            ),
          ),
        })),
      }
      return result
    }
    if (op === 'recipes')
      return (await ws.readJson<{ id: string; recipe: Recipe }[]>(prefix + '-recipes.json')) ?? []
    if (op === 'saveRecipe' || op === 'propose') {
      const recipe = RecipeSchema.parse(raw)
      if (op === 'propose') {
        await ws.writeJson(prefix + '-proposal.json', recipe)
        return { proposal: true, name: recipe.name }
      }
      const recipes = (await ws.readJson<{ id: string; recipe: Recipe }[]>(prefix + '-recipes.json')) ?? [],
        rid = hash(recipe.name).slice(0, 20),
        next = recipes.filter((x) => x.id !== rid)
      next.unshift({ id: rid, recipe })
      await ws.writeJson(prefix + '-recipes.json', next.slice(0, 50))
      return { id: rid }
    }
    if (op === 'proposal') return (await ws.readJson<Recipe>(prefix + '-proposal.json')) ?? null
    if (op === 'preview') {
      const recipe = RecipeSchema.parse(raw),
        inputHashes: Record<string, string> = {},
        books = new Map<string, ReturnType<typeof readBook>>()
      for (const file of new Set([recipe.orders.path, recipe.settlements.path, recipe.template.path])) {
        signal?.throwIfAborted()
        const bytes = await ws.read(file)
        inputHashes[file] = hash(bytes)
        books.set(file, readBook(bytes, file))
      }
      if (recipe.orders.path === recipe.settlements.path && recipe.orders.sheet === recipe.settlements.sheet)
        throw new FlowError('same-source', 'Orders and settlements must refer to different tables.')
      const result = reconcile(recipe, books.get(recipe.orders.path)!, books.get(recipe.settlements.path)!),
        changes = planChanges(books.get(recipe.template.path)!, recipe, result.rows)
      const p: Preview = {
        id: randomUUID(),
        createdAt: new Date().toISOString(),
        recipe,
        inputHashes,
        rows: result.rows,
        changes,
        summary: result.summary,
        warnings: [
          'Totals include only valid, unambiguous amounts; unresolved values are excluded.',
          'Exports retain original formulas and request recalculation in Excel. Cached formula values are not evidence of recalculation.',
        ],
        acknowledgements: [],
        version: 0,
      }
      await this.fresh(ws, p)
      await ws.writeJson(prefix + '-' + p.id + '.json', p)
      const history = (await ws.readJson<string[]>(prefix + '-history.json')) ?? []
      await ws.writeJson(prefix + '-history.json', [p.id, ...history].slice(0, 30))
      return p
    }
    if (op === 'history') {
      const list = (await ws.readJson<string[]>(prefix + '-history.json')) ?? []
      const out = []
      for (const rid of list) {
        const p = await ws.readJson<Preview>(prefix + '-' + id.parse(rid) + '.json')
        if (p)
          out.push({
            id: p.id,
            name: p.recipe.name,
            createdAt: p.createdAt,
            summary: p.summary,
            exported: p.exported,
          })
      }
      return out
    }
    if (['getPreview', 'acknowledge', 'export', 'report'].includes(op)) {
      const args = z
          .object({
            id,
            version: version.optional(),
            rowId: z.string().optional(),
            acknowledged: z.boolean().optional(),
          })
          .parse(raw),
        p = await ws.readJson<Preview>(prefix + '-' + args.id + '.json')
      if (!p) throw new FlowError('not-found', 'Preview not found in this session.')
      if (op === 'getPreview') return p
      if (op === 'report') return reportHtml(p)
      if (args.version !== p.version)
        throw new FlowError('stale-version', 'Review changed. Reload the preview before continuing.')
      if (op === 'acknowledge' && p.exported)
        throw new FlowError('already-exported', 'Exported reviews are immutable; generate a fresh preview.')
      await this.fresh(ws, p)
      if (op === 'acknowledge') {
        const row = p.rows.find((r) => r.id === args.rowId)
        if (!row || row.status === 'matched' || args.acknowledged === undefined)
          throw new FlowError('invalid-review', 'Choose a valid exception to acknowledge.')
        p.acknowledgements = p.acknowledgements.filter((x) => x !== args.rowId)
        if (args.acknowledged) p.acknowledgements.push(row.id)
        p.version++
        await ws.writeJson(prefix + '-' + p.id + '.json', p)
        return p
      }
      if (p.exported)
        throw new FlowError(
          'already-exported',
          'This reviewed preview was already exported; start a fresh preview for another output.',
        )
      const pending = p.rows.filter((r) => r.status !== 'matched' && !p.acknowledgements.includes(r.id))
      if (pending.length)
        throw new FlowError(
          'unreviewed-exceptions',
          'Acknowledge every exception before exporting the reviewed result.',
        )
      const template = readBook(await ws.read(p.recipe.template.path), p.recipe.template.path),
        bytes = fillTemplate(template, p.recipe.template.sheet, p.changes)
      // Independent readback proves the actual exported cell values, not only planned changes.
      const actual = sheetOf(readBook(bytes, 'result.xlsx'), p.recipe.template.sheet)
      for (const c of p.changes)
        if ((actual.cells[c.ref]?.value ?? null) !== c.after)
          throw new FlowError('export-readback', 'Exported value differs at ' + c.ref)
      await this.fresh(ws, p)
      signal?.throwIfAborted()
      const stem = 'sheetflow-' + p.id,
        file = stem + '.xlsx',
        report = stem + '.html',
        trace = stem + '.json',
        paths = await Promise.all([file, report, trace].map((x) => ws.file(x, true))),
        written: string[] = []
      try {
        for (const [i, data] of [bytes, reportHtml(p), JSON.stringify(p, null, 2)].entries()) {
          await writeFile(paths[i], data, { flag: 'wx' })
          written.push(paths[i])
        }
      } catch (e) {
        await Promise.all(written.map((x) => unlink(x).catch(() => {})))
        throw e
      }
      p.exported = { file, report, trace }
      p.version++
      await ws.writeJson(prefix + '-' + p.id + '.json', p)
      return p
    }
    throw new FlowError('unknown-operation', 'Unknown SheetFlow operation.')
  }
  private async fresh(ws: Workspace, p: Preview): Promise<void> {
    for (const [file, fingerprint] of Object.entries(p.inputHashes)) {
      if (hash(await ws.read(file)) !== fingerprint)
        throw new FlowError(
          'stale-input',
          'An input or template changed since preview. Generate a fresh preview and review again.',
        )
    }
  }
}
