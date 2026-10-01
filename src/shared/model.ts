import { z } from 'zod'
export class FlowError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
  }
}
const col = z
  .string()
  .regex(/^[A-Z]{1,3}$/)
  .refine((s) => columnNumber(s) <= 100, 'Supported columns are A through CV (100 columns).')
export const SourceSchema = z
  .object({
    path: z.string().min(1).max(260),
    sheet: z.string().min(1).max(100),
    headerRow: z.number().int().min(1).max(50),
    key: col,
    amount: col,
    label: col.optional(),
    headers: z
      .object({ key: z.string().min(1), amount: z.string().min(1), label: z.string().optional() })
      .strict(),
  })
  .strict()
export const RecipeSchema = z
  .object({
    schemaVersion: z.literal(1),
    name: z.string().trim().min(1).max(80),
    currency: z.string().regex(/^[A-Z]{3}$/),
    orders: SourceSchema,
    settlements: SourceSchema,
    match: z
      .object({
        trim: z.boolean(),
        caseSensitive: z.boolean(),
        settlementDuplicates: z.enum(['reject', 'sum']),
        tolerance: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/),
      })
      .strict(),
    template: z
      .object({
        path: z.string().min(1).max(260),
        sheet: z.string().min(1).max(100),
        startRow: z.number().int().min(1).max(10000),
        endRow: z.number().int().min(1).max(10000),
        columns: z
          .object({
            key: col,
            label: col.optional(),
            expected: col,
            actual: col,
            difference: col,
            status: col,
          })
          .strict(),
      })
      .strict(),
  })
  .strict()
  .superRefine((r, ctx) => {
    if (r.template.endRow < r.template.startRow)
      ctx.addIssue({ code: 'custom', message: 'Template endRow precedes startRow' })
    const cols = Object.values(r.template.columns)
    if (new Set(cols).size !== cols.length)
      ctx.addIssue({ code: 'custom', message: 'Output columns must be distinct' })
  })
export type Recipe = z.infer<typeof RecipeSchema>
export type Value = string | null
export type Cell = {
  ref: string
  value: Value
  kind: 'text' | 'number' | 'boolean' | 'error' | 'blank'
  formula?: string
  style?: string
}
export type Sheet = {
  name: string
  path: string
  cells: Record<string, Cell>
  maxRow: number
  maxCol: number
  merges: string[]
  protected: boolean
}
export type Book = {
  name: string
  format: 'xlsx' | 'csv'
  sheets: Sheet[]
  entries?: Record<string, Uint8Array>
}
export type FileDescription = {
  path: string
  hash: string
  format: string
  sheets: {
    name: string
    rows: number
    headerRow: number
    columns: { column: string; header: string }[]
    sample: string[][]
    sampleRows: { row: number; cells: string[] }[]
  }[]
}
export type Evidence = {
  file: string
  sheet: string
  row: number
  cells: string[]
  values: string[]
  rule: string
}
export type ResultRow = {
  id: string
  key: string
  label: string
  expected: string | null
  actual: string | null
  difference: string | null
  status:
    | 'matched'
    | 'amount-difference'
    | 'missing-settlement'
    | 'missing-order'
    | 'duplicate-order'
    | 'duplicate-settlement'
    | 'invalid-input'
  issues: string[]
  evidence: Evidence[]
}
export type CellChange = {
  ref: string
  before: string | null
  after: string | null
  kind: 'text' | 'number'
  rowId: string
  evidence: Evidence[]
}
export type Preview = {
  id: string
  createdAt: string
  recipe: Recipe
  inputHashes: Record<string, string>
  rows: ResultRow[]
  changes: CellChange[]
  warnings: string[]
  summary: {
    rows: number
    matched: number
    exceptions: number
    expected: string
    actual: string
    difference: string
  }
  acknowledgements: string[]
  version: number
  exported?: { file: string; report: string; trace: string }
}
export interface FlowApi {
  call<T>(operation: string, args?: unknown): Promise<T>
  send?(text: string): Promise<void>
}
export function columnNumber(s: string): number {
  return [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0)
}
export function columnName(n: number): string {
  let s = ''
  while (n > 0) {
    n--
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26)
  }
  return s
}
export function cents(value: string | null): bigint {
  if (value === null || !/^-?\d{1,13}(\.\d{1,2})?$/.test(value.trim()))
    throw new FlowError(
      'invalid-amount',
      'Amount must be a plain decimal with at most two decimal places; blank is not zero.',
    )
  const s = value.trim(),
    negative = s.startsWith('-'),
    [whole, frac = ''] = s.replace(/^-/, '').split('.')
  return (BigInt(whole) * 100n + BigInt(frac.padEnd(2, '0'))) * (negative ? -1n : 1n)
}
export function money(n: bigint): string {
  const a = n < 0n ? -n : n
  return (n < 0n ? '-' : '') + a / 100n + '.' + (a % 100n).toString().padStart(2, '0')
}
