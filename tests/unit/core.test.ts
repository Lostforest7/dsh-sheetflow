import { describe, it, expect } from 'vitest'
import { strToU8, strFromU8 } from 'fflate'
import { cents, money, RecipeSchema, type Book } from '../../src/shared/model.ts'
import { readBook, fillTemplate, sheetOf } from '../../src/core/workbook.ts'
import { reconcile, planChanges } from '../../src/core/engine.ts'
import { fixture } from '../helpers.ts'

describe('exact comparison and explainable mapping', () => {
  it('adds split payments exactly and distinguishes blank from zero', () => {
    expect(money(cents('0.10') + cents('0.20'))).toBe('0.30')
    expect(cents('0')).toBe(0n)
    for (const amount of [null, '', '1.001', '1,000', '1e3', 'Infinity'])
      expect(() => cents(amount)).toThrow()
    expect(money(cents('-12.01'))).toBe('-12.01')
  })
  it('preserves leading zero keys and reports six distinct month-end exceptions', async () => {
    const f = await fixture(),
      r = reconcile(f.recipe, f.orders, f.settlements)
    expect(r.summary).toEqual({
      rows: 8,
      matched: 2,
      exceptions: 6,
      expected: '555.50',
      actual: '430.00',
      difference: '-125.50',
    })
    expect(r.rows.find((r) => r.key === '00002')).toMatchObject({
      status: 'amount-difference',
      difference: '-10.00',
    })
    expect(r.rows.find((r) => r.key === '00005')).toMatchObject({ status: 'duplicate-order', expected: null })
    expect(r.rows.find((r) => r.key === '00006')).toMatchObject({ status: 'invalid-input', expected: null })
    expect(r.rows.find((r) => r.key === '00008')!.evidence[0]).toMatchObject({
      file: 'settlements.xlsx',
      sheet: 'Settlements',
      row: 7,
      cells: ['A7', 'B7'],
    })
  })
  it('requires an explicit split-payment rule and reuses it for next month', async () => {
    const f = await fixture(),
      r = reconcile(
        { ...f.recipe, match: { ...f.recipe.match, settlementDuplicates: 'sum' } },
        f.orders,
        f.settlements,
      )
    expect(r.rows.find((r) => r.key === '00004')).toMatchObject({
      status: 'matched',
      actual: '120.00',
      difference: '0.00',
    })
    const next = await fixture('next-month'),
      n = reconcile(
        { ...f.recipe, match: { ...f.recipe.match, settlementDuplicates: 'sum' } },
        next.orders,
        next.settlements,
      )
    expect(n.summary).toEqual({
      rows: 4,
      matched: 4,
      exceptions: 0,
      expected: '600.29',
      actual: '600.29',
      difference: '0.00',
    })
  })
  it('never matches two blank identifiers, or hides an identifier beginning __blank__', async () => {
    const f = await fixture()
    f.orders.sheets[0].cells.A2.value = ''
    f.settlements.sheets[0].cells.A2.value = ''
    f.orders.sheets[0].cells.A3.value = '__blank__real'
    f.settlements.sheets[0].cells.A3.value = '__blank__real'
    const r = reconcile(f.recipe, f.orders, f.settlements)
    expect(r.rows.filter((r) => r.key === '')).toHaveLength(2)
    for (const b of r.rows.filter((r) => !r.key)) {
      expect(b.status).toBe('invalid-input')
      expect(b.evidence).toHaveLength(1)
    }
    expect(r.rows.some((r) => r.key === '__blank__real')).toBe(true)
  })
  it('rejects changed headers instead of silently reusing old mappings', async () => {
    const f = await fixture()
    f.orders.sheets[0].cells.A1.value = 'Invoice ID'
    expect(() => reconcile(f.recipe, f.orders, f.settlements)).toThrow(/Header changed/)
  })
  it('flags cached source formulas and merged source cells as invalid', async () => {
    const f = await fixture()
    f.orders.sheets[0].cells.C2.formula = '50+50'
    f.orders.sheets[0].merges.push('A3:A4')
    const r = reconcile(f.recipe, f.orders, f.settlements)
    expect(r.rows.find((r) => r.key === '00001')).toMatchObject({ status: 'invalid-input', expected: null })
    expect(r.rows.find((r) => r.key === '00002')!.issues).toContain('source-merge')
  })
  it('applies tolerance and case/whitespace rules only when selected', async () => {
    const f = await fixture()
    f.orders.sheets[0].cells.A2.value = ' ab '
    f.settlements.sheets[0].cells.A2.value = 'AB'
    f.settlements.sheets[0].cells.B2.value = '99.99'
    const r = reconcile(
      { ...f.recipe, match: { ...f.recipe.match, caseSensitive: false, tolerance: '0.01' } },
      f.orders,
      f.settlements,
    )
    expect(r.rows.find((r) => r.key === 'AB')).toMatchObject({ status: 'matched', difference: '-0.01' })
    expect(reconcile(f.recipe, f.orders, f.settlements).rows.find((r) => r.key === 'ab')?.status).toBe(
      'missing-settlement',
    )
  })
  it('does not treat boolean cells as monetary values', async () => {
    const f = await fixture()
    f.orders.sheets[0].cells.C2 = { ref: 'C2', kind: 'boolean', value: '1' }
    expect(reconcile(f.recipe, f.orders, f.settlements).rows[0]).toMatchObject({
      status: 'invalid-input',
      expected: null,
      issues: ['source-type'],
    })
  })
  it('rejects duplicate output columns and columns beyond the supported bounds', async () => {
    const f = await fixture()
    expect(() =>
      RecipeSchema.parse({
        ...f.recipe,
        template: { ...f.recipe.template, columns: { ...f.recipe.template.columns, status: 'A' } },
      }),
    ).toThrow()
    expect(() => RecipeSchema.parse({ ...f.recipe, orders: { ...f.recipe.orders, key: 'XFD' } })).toThrow()
  })
})

describe('template copy preserves data and rejects unsafe mappings', () => {
  it('reads actual XLSX headers, text IDs, formulas and style IDs', async () => {
    const f = await fixture()
    expect(f.orders.sheets[0].cells.A2.value).toBe('00001')
    expect(f.template.sheets[0].cells.G6.formula).toContain('ISNUMBER')
    expect(f.template.sheets[0].cells.C6.style).toBeDefined()
  })
  it('reads UTF-8 quoted CSV including embedded newlines without coercing IDs', () => {
    const b = readBook(strToU8('\uFEFFID,Amount,Label\r\n0001,0.30,"A, B\nC"\r\n'), 'test.csv')
    expect(b.sheets[0].cells.A2.value).toBe('0001')
    expect(b.sheets[0].cells.C2.value).toBe('A, B\nC')
    expect(() => readBook(strToU8('a\n"unclosed'), 'a.csv')).toThrow(/Unclosed/)
    expect(() => readBook(Uint8Array.from([0xff]), 'a.csv')).toThrow(/UTF-8/)
  })
  it('exports reviewed values and literal =text, preserving formulas and untouched ZIP parts', async () => {
    const f = await fixture(),
      r = reconcile(f.recipe, f.orders, f.settlements),
      changes = planChanges(f.template, f.recipe, r.rows),
      out = readBook(fillTemplate(f.template, f.recipe.template.sheet, changes), 'result.xlsx')
    for (const c of changes) expect(out.sheets[0].cells[c.ref]?.value ?? null).toBe(c.after)
    const literalRef = 'B' + (f.recipe.template.startRow + r.rows.findIndex((r) => r.key === '00007'))
    expect(out.sheets[0].cells[literalRef].value).toMatch(/^=HYPERLINK/)
    expect(out.sheets[0].cells[literalRef].formula).toBeUndefined()
    expect(out.sheets[0].cells.G6.formula).toBe(f.template.sheets[0].cells.G6.formula)
    expect(out.sheets[0].cells.G6.value).toBeNull()
    for (const [ref, c] of Object.entries(f.template.sheets[0].cells))
      if (c.formula !== undefined) {
        expect(out.sheets[0].cells[ref]?.formula).toBe(c.formula)
        expect(out.sheets[0].cells[ref]?.value).toBeNull()
      }
    expect(out.sheets[0].cells.C6.style).toBe(f.template.sheets[0].cells.C6.style)
    for (const [part, bytes] of Object.entries(f.template.entries!))
      if (![f.template.sheets[0].path, 'xl/workbook.xml'].includes(part))
        expect(out.entries![part]).toEqual(bytes)
    expect(strFromU8(out.entries!['xl/workbook.xml'])).toContain('fullCalcOnLoad="1"')
  })
  it('clears unused text/number cells while retaining their styles', async () => {
    const f = await fixture()
    const s = f.template.sheets[0]
    // Seed a previous run through the same export writer, then run with fewer records.
    const prior = readBook(
      fillTemplate(f.template, s.name, [
        { ref: 'A30', before: null, after: 'OLD', kind: 'text', rowId: 'old', evidence: [] },
        { ref: 'C30', before: null, after: '123.00', kind: 'number', rowId: 'old', evidence: [] },
      ]),
      'prior.xlsx',
    )
    const changes = planChanges(prior, f.recipe, reconcile(f.recipe, f.orders, f.settlements).rows)
    expect(changes.filter((c) => c.ref.endsWith('30'))).toMatchObject([
      { ref: 'A30', before: 'OLD', after: null },
      { ref: 'C30', before: '123.00', after: null },
    ])
    const out = readBook(fillTemplate(prior, s.name, changes), 'out.xlsx')
    expect(out.sheets[0].cells.A30.value).toBeNull()
    expect(out.sheets[0].cells.C30.style).toBe(s.cells.C30.style)
  })
  it('refuses capacity overflow, formula cells, merges and protected sheets', async () => {
    const f = await fixture(),
      rows = reconcile(f.recipe, f.orders, f.settlements).rows
    expect(() =>
      planChanges(f.template, { ...f.recipe, template: { ...f.recipe.template, endRow: 6 } }, rows),
    ).toThrow(/insufficient/)
    expect(() =>
      planChanges(
        f.template,
        {
          ...f.recipe,
          template: { ...f.recipe.template, columns: { ...f.recipe.template.columns, status: 'G' } },
        },
        rows,
      ),
    ).toThrow(/formula or merge/)
    f.template.sheets[0].merges.push('A6:A7')
    expect(() => planChanges(f.template, f.recipe, rows)).toThrow(/merge/)
    f.template.sheets[0].protected = true
    expect(() => planChanges(f.template, f.recipe, rows)).toThrow(/protected/)
  })
  it('supports a second template with different sheet and writable rows', async () => {
    const f = await fixture('alternate-template'),
      r = reconcile(f.recipe, f.orders, f.settlements),
      changes = planChanges(f.template, f.recipe, r.rows)
    expect(r.summary).toMatchObject({ matched: 2, exceptions: 1, difference: '-10.00' })
    expect(changes.find((c) => c.ref === 'A8')).toMatchObject({ before: 'OLD01', after: 'S001' })
    const out = readBook(fillTemplate(f.template, f.recipe.template.sheet, changes), 'out.xlsx')
    expect(sheetOf(out, 'Supplier settlement').cells.A8.value).toBe('S001')
  })
  it('rejects aggregate values beyond safe Excel precision', async () => {
    const f = await fixture(),
      rows = reconcile(f.recipe, f.orders, f.settlements).rows
    rows[0].actual = '10000000000000.00'
    expect(() => planChanges(f.template, f.recipe, rows)).toThrow(/plain decimal/)
  })
})
