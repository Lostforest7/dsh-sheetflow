import { createHash } from 'node:crypto'
import {
  RecipeSchema,
  FlowError,
  cents,
  money,
  type Recipe,
  type Book,
  type Sheet,
  type Evidence,
  type ResultRow,
  type CellChange,
} from '../shared/model.ts'
import { sheetOf, inRange } from './workbook.ts'
export const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')
type RecordRow = {
  row: number
  key: string
  label: string
  amount: bigint | null
  issues: string[]
  evidence: Evidence
}
function records(book: Book, source: Recipe['orders'], match: Recipe['match']): RecordRow[] {
  const sheet = sheetOf(book, source.sheet)
  for (const role of ['key', 'amount', 'label'] as const) {
    const col = source[role]
    if (!col) continue
    const expected = source.headers[role]
    if (!expected || sheet.cells[col + source.headerRow]?.value?.trim() !== expected.trim())
      throw new FlowError(
        'header-changed',
        'Header changed for ' +
          source.path +
          ' / ' +
          source.sheet +
          ' / ' +
          col +
          '. Reinspect and confirm the mapping.',
      )
  }
  const out: RecordRow[] = []
  for (let row = source.headerRow + 1; row <= sheet.maxRow; row++) {
    const keyCell = sheet.cells[source.key + row],
      amountCell = sheet.cells[source.amount + row],
      labelCell = source.label ? sheet.cells[source.label + row] : undefined
    if ([keyCell, amountCell, labelCell].every((c) => !c?.value?.trim() && c?.formula === undefined)) continue
    let key = keyCell?.value ?? '',
      amount: bigint | null = null,
      issues: string[] = []
    if (match.trim) key = key.trim()
    if (!match.caseSensitive) key = key.toLocaleUpperCase('en-US')
    if (!key) issues.push('blank-key')
    if (
      keyCell?.formula !== undefined ||
      amountCell?.formula !== undefined ||
      labelCell?.formula !== undefined
    )
      issues.push('source-formula')
    if ([keyCell, amountCell, labelCell].some((c) => c?.kind === 'error')) issues.push('source-error')
    if (keyCell?.kind === 'boolean' || amountCell?.kind === 'boolean') issues.push('source-type')
    if (
      [source.key, source.amount, source.label]
        .filter(Boolean)
        .some((col) => sheet.merges.some((range) => inRange(col! + row, range)))
    )
      issues.push('source-merge')
    if (keyCell?.kind === 'number' && !/^\d{1,15}$/.test(keyCell.value ?? ''))
      issues.push('numeric-key-precision')
    try {
      amount = cents(amountCell?.value ?? null)
    } catch {
      issues.push('invalid-amount')
    }
    out.push({
      row,
      key,
      label: labelCell?.value ?? '',
      amount,
      issues,
      evidence: {
        file: source.path,
        sheet: source.sheet,
        row,
        cells: [source.key + row, source.amount + row, ...(source.label ? [source.label + row] : [])],
        values: [
          keyCell?.value ?? '',
          amountCell?.value ?? '',
          ...(source.label ? [labelCell?.value ?? ''] : []),
        ],
        rule:
          'Exact key match; ' +
          (match.trim ? 'trim whitespace; ' : '') +
          (match.caseSensitive ? 'case-sensitive' : 'case-insensitive'),
      },
    })
  }
  if (out.length > 10000)
    throw new FlowError('row-limit', 'A source table may contain at most 10,000 data rows.')
  return out
}
export function reconcile(
  raw: unknown,
  ordersBook: Book,
  settlementsBook: Book,
): {
  recipe: Recipe
  rows: ResultRow[]
  summary: {
    rows: number
    matched: number
    exceptions: number
    expected: string
    actual: string
    difference: string
  }
} {
  const recipe = RecipeSchema.parse(raw),
    orders = records(ordersBook, recipe.orders, recipe.match),
    settlements = records(settlementsBook, recipe.settlements, recipe.match)
  const group = (list: RecordRow[], side: string) => {
    const m = new Map<string, RecordRow[]>()
    for (const r of list) {
      const k = r.key ? 'key:' + r.key : 'blank:' + side + ':' + r.row
      m.set(k, [...(m.get(k) ?? []), r])
    }
    return m
  }
  const left = group(orders, 'orders'),
    right = group(settlements, 'settlements'),
    keys = new Set([...left.keys(), ...right.keys()]),
    rows: ResultRow[] = []
  let expectedTotal = 0n,
    actualTotal = 0n
  for (const key of keys) {
    const a = left.get(key) ?? [],
      b = right.get(key) ?? [],
      issues = [...new Set([...a, ...b].flatMap((r) => r.issues))]
    if (a.length > 1) issues.push('duplicate-order')
    if (b.length > 1 && recipe.match.settlementDuplicates === 'reject') issues.push('duplicate-settlement')
    if (!a.length) issues.push('missing-order')
    if (!b.length) issues.push('missing-settlement')
    const invalid = (list: RecordRow[]) => list.some((r) => r.amount === null || r.issues.length)
    const expected = a.length === 1 && !invalid(a) ? a[0].amount : null
    const actual =
      b.length && !invalid(b) && (b.length === 1 || recipe.match.settlementDuplicates === 'sum')
        ? b.reduce((s, r) => s + r.amount!, 0n)
        : null
    const difference = expected !== null && actual !== null ? actual - expected : null
    if (difference !== null && (difference < 0n ? -difference : difference) > cents(recipe.match.tolerance))
      issues.push('amount-difference')
    let status: ResultRow['status'] = 'matched'
    if (issues.length)
      status = issues.some((x) =>
        [
          'blank-key',
          'invalid-amount',
          'source-formula',
          'source-error',
          'source-type',
          'source-merge',
          'numeric-key-precision',
        ].includes(x),
      )
        ? 'invalid-input'
        : issues.includes('duplicate-order')
          ? 'duplicate-order'
          : issues.includes('duplicate-settlement')
            ? 'duplicate-settlement'
            : issues.includes('missing-order')
              ? 'missing-order'
              : issues.includes('missing-settlement')
                ? 'missing-settlement'
                : 'amount-difference'
    if (expected !== null) expectedTotal += expected
    if (actual !== null) actualTotal += actual
    const evidence = [...a, ...b].map((r) => ({
      ...r.evidence,
      rule:
        r.evidence.rule +
        (b.length > 1 && recipe.match.settlementDuplicates === 'sum'
          ? '; sum settlement rows by confirmed rule'
          : ''),
    }))
    rows.push({
      id: hash(JSON.stringify({ key, a: a.map((x) => x.row), b: b.map((x) => x.row) })).slice(0, 20),
      key: a[0]?.key ?? b[0]?.key ?? '',
      label: a[0]?.label ?? b[0]?.label ?? '',
      expected: expected === null ? null : money(expected),
      actual: actual === null ? null : money(actual),
      difference: difference === null ? null : money(difference),
      status,
      issues,
      evidence,
    })
  }
  return {
    recipe,
    rows,
    summary: {
      rows: rows.length,
      matched: rows.filter((r) => r.status === 'matched').length,
      exceptions: rows.filter((r) => r.status !== 'matched').length,
      expected: money(expectedTotal),
      actual: money(actualTotal),
      difference: money(actualTotal - expectedTotal),
    },
  }
}
export function planChanges(template: Book, recipe: Recipe, rows: ResultRow[]): CellChange[] {
  const target = recipe.template,
    sheet = sheetOf(template, target.sheet)
  if (template.format !== 'xlsx') throw new FlowError('template-format', 'The template must be .xlsx.')
  if (sheet.protected) throw new FlowError('protected-sheet', 'Target worksheet is protected.')
  if (rows.length > target.endRow - target.startRow + 1)
    throw new FlowError(
      'template-capacity',
      'Template has insufficient reserved rows; expand the approved region first.',
    )
  const changes: CellChange[] = []
  for (let i = 0; i <= target.endRow - target.startRow; i++)
    for (const [role, col] of Object.entries(target.columns)) {
      const ref = col + (target.startRow + i),
        before = sheet.cells[ref],
        row = rows[i]
      if (before?.formula !== undefined || sheet.merges.some((r) => inRange(ref, r)))
        throw new FlowError(
          'protected-cell',
          'Target region contains a formula or merge at ' + ref + '. Choose writable columns only.',
        )
      const after = row ? (role === 'status' ? row.status : ((row as any)[role] as string | null)) : null
      if (after !== null && ['expected', 'actual', 'difference'].includes(role)) cents(after) // Bound exported numbers to 15 significant decimal digits.
      if ((before?.value ?? null) !== after)
        changes.push({
          ref,
          before: before?.value ?? null,
          after,
          kind: ['expected', 'actual', 'difference'].includes(role) ? 'number' : 'text',
          rowId: row?.id ?? 'clear-unused',
          evidence: row?.evidence ?? [],
        })
    }
  return changes
}
