import { describe, it, expect } from 'vitest'
import { readFile, writeFile, mkdir, symlink, readdir } from 'node:fs/promises'
import path from 'node:path'
import { SheetFlowService } from '../../src/core/service.ts'
import { Workspace, relativeFile } from '../../src/core/storage.ts'
import { readBook, sheetOf } from '../../src/core/workbook.ts'
import { hash } from '../../src/core/engine.ts'
import type { Preview } from '../../src/shared/model.ts'
import { workspace, fixture } from '../helpers.ts'

describe('reviewed local workflow', () => {
  it('reports absolute sample row numbers, including blank rows above an unfamiliar header', async () => {
    const root = await workspace()
    await writeFile(
      path.join(root, 'shifted.csv'),
      'Report title,,\n,,\nContract,Amount,Customer\nRV-01,1.25,Test\n',
    )
    const service = new SheetFlowService()
    const first = (await service.execute(root, 'a', 'describe', {
      path: 'shifted.csv',
    })) as import('../../src/shared/model.ts').FileDescription
    expect(first.sheets[0].headerRow).toBe(1)
    expect(first.sheets[0].sampleRows).toEqual([
      { row: 2, cells: ['', '', ''] },
      { row: 3, cells: ['Contract', 'Amount', 'Customer'] },
      { row: 4, cells: ['RV-01', '1.25', 'Test'] },
    ])
    const exact = (await service.execute(root, 'a', 'describe', {
      path: 'shifted.csv',
      headerRow: 3,
    })) as import('../../src/shared/model.ts').FileDescription
    expect(exact.sheets[0].columns[0].header).toBe('Contract')
    expect(exact.sheets[0].sampleRows[0].row).toBe(4)
  })
  it('requires exception review, exports three files, retains inputs and survives restart', async () => {
    const root = await workspace(),
      { recipe } = await fixture(),
      s = new SheetFlowService(),
      original = hash(await readFile(path.join(root, 'template.xlsx')))
    let p = (await s.execute(root, 'a', 'preview', recipe)) as Preview
    await expect(s.execute(root, 'a', 'export', { id: p.id, version: p.version })).rejects.toMatchObject({
      code: 'unreviewed-exceptions',
    })
    for (const row of p.rows.filter((r) => r.status !== 'matched'))
      p = (await s.execute(root, 'a', 'acknowledge', {
        id: p.id,
        version: p.version,
        rowId: row.id,
        acknowledged: true,
      })) as Preview
    p = (await s.execute(root, 'a', 'export', { id: p.id, version: p.version })) as Preview
    expect(p.exported).toBeDefined()
    const out = readBook(await readFile(path.join(root, p.exported!.file)), 'out.xlsx')
    expect(out.sheets[0].cells.A6.value).toBe('00001')
    expect(hash(await readFile(path.join(root, 'template.xlsx')))).toBe(original)
    expect(
      ((await new SheetFlowService().execute(root, 'a', 'getPreview', { id: p.id })) as Preview).exported,
    ).toEqual(p.exported)
    await expect(s.execute(root, 'a', 'export', { id: p.id, version: p.version })).rejects.toMatchObject({
      code: 'already-exported',
    })
    await expect(
      s.execute(root, 'a', 'acknowledge', {
        id: p.id,
        version: p.version,
        rowId: p.rows[1].id,
        acknowledged: false,
      }),
    ).rejects.toMatchObject({ code: 'already-exported' })
    const trace = JSON.parse(await readFile(path.join(root, p.exported!.trace), 'utf8'))
    expect(trace.changes).toHaveLength(p.changes.length)
  })
  it('invalidates reviews after any input change and does not create export files', async () => {
    const root = await workspace(),
      { recipe } = await fixture(),
      s = new SheetFlowService(),
      p = (await s.execute(root, 'a', 'preview', recipe)) as Preview
    await writeFile(path.join(root, 'orders.xlsx'), new Uint8Array([1, 2, 3]))
    await expect(
      s.execute(root, 'a', 'acknowledge', { id: p.id, version: 0, rowId: p.rows[1].id, acknowledged: true }),
    ).rejects.toMatchObject({ code: 'stale-input' })
    await expect(s.execute(root, 'a', 'export', { id: p.id, version: 0 })).rejects.toMatchObject({
      code: 'stale-input',
    })
    expect((await readdir(root)).filter((x) => x.startsWith('sheetflow-'))).toHaveLength(0)
  })
  it('rejects concurrent stale acknowledgements and isolates sessions', async () => {
    const root = await workspace(),
      { recipe } = await fixture(),
      s = new SheetFlowService(),
      p = (await s.execute(root, 'a', 'preview', recipe)) as Preview
    const a = { id: p.id, version: 0, rowId: p.rows[1].id, acknowledged: true },
      results = await Promise.allSettled([
        s.execute(root, 'a', 'acknowledge', a),
        s.execute(root, 'a', 'acknowledge', a),
      ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.code).toBe(
      'stale-version',
    )
    await expect(s.execute(root, 'b', 'getPreview', { id: p.id })).rejects.toMatchObject({
      code: 'not-found',
    })
    expect(await s.execute(root, 'b', 'history')).toEqual([])
  })
  it('saves reusable recipes and proposals without executing or modifying business files', async () => {
    const root = await workspace(),
      { recipe } = await fixture(),
      s = new SheetFlowService()
    await s.execute(root, 'a', 'saveRecipe', recipe)
    await s.execute(root, 'a', 'propose', recipe)
    expect(await s.execute(root, 'a', 'proposal')).toEqual(recipe)
    expect(await s.execute(root, 'a', 'history')).toEqual([])
    expect(await s.execute(root, 'b', 'proposal')).toBeNull()
    expect(await s.execute(root, 'a', 'recipes')).toHaveLength(1)
    expect((await readdir(root)).filter((x) => x.startsWith('sheetflow-'))).toHaveLength(0)
  })
  it('escapes workbook data in self-contained review reports', async () => {
    const root = await workspace(),
      { recipe } = await fixture(),
      s = new SheetFlowService(),
      p = (await s.execute(root, 'a', 'preview', recipe)) as Preview
    p.rows[0].label = '<script>alert(1)</script>'
    const { reportHtml } = await import('../../src/core/report.ts'),
      report = reportHtml(p)
    expect(report).not.toContain('<script>')
    expect(report).toContain('&lt;script&gt;')
    expect(report).toContain("default-src 'none'")
  })
  it('exports exact split-payment amounts with no exceptions', async () => {
    const root = await workspace('next-month'),
      { recipe } = await fixture('next-month'),
      s = new SheetFlowService(),
      p = (await s.execute(root, 'a', 'preview', recipe)) as Preview
    const out = (await s.execute(root, 'a', 'export', { id: p.id, version: 0 })) as Preview
    expect(
      sheetOf(
        readBook(await readFile(path.join(root, out.exported!.file)), 'out.xlsx'),
        recipe.template.sheet,
      ).cells.D6.value,
    ).toBe('0.30')
  })
})

describe('workspace file boundary', () => {
  it('rejects traversal, absolute paths and credential filenames', () => {
    for (const p of [
      '../orders.xlsx',
      'C:\\secret.xlsx',
      '/secret.xlsx',
      '.git/config',
      '.credentials.yaml',
      '.env',
      'sub/../orders.xlsx',
    ])
      expect(() => relativeFile(p)).toThrow()
  })
  it('rejects links outside the workspace and existing export destinations', async () => {
    const root = await workspace(),
      outside = await workspace(),
      ws = new Workspace(root)
    await symlink(outside, path.join(root, 'linked'), 'junction')
    await expect(ws.read('linked/orders.xlsx')).rejects.toMatchObject({ code: 'outside-workspace' })
    await expect(ws.file('orders.xlsx', true)).rejects.toMatchObject({ code: 'already-exists' })
  })
})
