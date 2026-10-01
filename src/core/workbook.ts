import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import path from 'node:path'
import {
  FlowError,
  columnNumber,
  columnName,
  type Book,
  type Sheet,
  type Cell,
  type CellChange,
} from '../shared/model.ts'
const MAX_FILE = 20 * 1024 * 1024,
  MAX_EXPANDED = 80 * 1024 * 1024
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  trimValues: false,
  processEntities: true,
})
const array = (v: any): any[] => (v === undefined ? [] : Array.isArray(v) ? v : [v])
function xml(text: string): any {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true)
    throw new FlowError('invalid-xml', 'Unsupported or invalid workbook XML')
  return parser.parse(text)
}
const txt = (v: any): string =>
  typeof v === 'string' ? v : typeof v === 'number' ? String(v) : (v?.['#text'] ?? '')
function rich(v: any): string {
  return array(v?.r).length
    ? array(v.r)
        .map((x) => txt(x.t))
        .join('')
    : txt(v?.t)
}
export function readBook(bytes: Uint8Array, name: string): Book {
  if (bytes.length > MAX_FILE) throw new FlowError('file-limit', 'Input exceeds 20 MiB.')
  if (name.toLowerCase().endsWith('.csv')) return readCsv(bytes, name)
  if (!name.toLowerCase().endsWith('.xlsx'))
    throw new FlowError('unsupported-format', 'Use ordinary .xlsx or UTF-8 comma-separated .csv files.')
  let expanded = 0,
    count = 0,
    entries: Record<string, Uint8Array>
  const names = new Set<string>()
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        expanded += f.originalSize
        count++
        if (
          expanded > MAX_EXPANDED ||
          count > 2000 ||
          names.has(f.name) ||
          /^(\/|[A-Za-z]:)|\\|(?:^|\/)\.\.(?:\/|$)/.test(f.name)
        )
          throw new FlowError('zip-limit', 'Workbook ZIP exceeds supported bounds.')
        names.add(f.name)
        return true
      },
    })
  } catch (e) {
    if (e instanceof FlowError) throw e
    throw new FlowError('invalid-xlsx', 'Unable to read XLSX archive.')
  }
  if (Object.keys(entries).some((n) => /vbaProject|externalLinks|_xmlsignatures/i.test(n)))
    throw new FlowError(
      'unsupported-workbook',
      'Macros, external workbook links and digitally signed files are outside this preview.',
    )
  const get = (n: string) => {
    if (!entries[n]) throw new FlowError('invalid-xlsx', 'Missing XLSX part: ' + n)
    return xml(strFromU8(entries[n]))
  }
  const root = get('xl/workbook.xml').workbook
  const rels = array(get('xl/_rels/workbook.xml.rels').Relationships.Relationship)
  const strings = entries['xl/sharedStrings.xml'] ? array(get('xl/sharedStrings.xml').sst.si).map(rich) : []
  const sheets: Sheet[] = array(root.sheets?.sheet).map((s: any) => {
    const rel = rels.find((r) => r['@Id'] === s['@id'])
    if (!rel || rel['@TargetMode'] === 'External')
      throw new FlowError('invalid-xlsx', 'Invalid worksheet relationship.')
    const target = String(rel['@Target']),
      part = target.startsWith('/') ? target.slice(1) : path.posix.normalize('xl/' + target)
    if (!part.startsWith('xl/worksheets/'))
      throw new FlowError('unsupported-sheet', 'Only standard worksheets are supported.')
    const doc = get(part).worksheet,
      cells: Record<string, Cell> = {},
      sheet: Sheet = {
        name: String(s['@name']),
        path: part,
        cells,
        maxRow: 0,
        maxCol: 0,
        merges: array(doc.mergeCells?.mergeCell).map((m) => String(m['@ref'])),
        protected: doc.sheetProtection !== undefined,
      }
    for (const row of array(doc.sheetData?.row))
      for (const c of array(row.c)) {
        const ref = String(c['@r']),
          m = /^([A-Z]{1,3})(\d+)$/.exec(ref)
        if (!m) throw new FlowError('invalid-cell', 'Invalid cell reference.')
        const rn = Number(m[2]),
          cn = columnNumber(m[1])
        if (rn < 1 || rn > 10050 || cn > 100 || cells[ref])
          throw new FlowError(
            'sheet-limit',
            'Supported worksheet bounds: 10,050 rows and 100 columns; duplicate cell addresses are rejected.',
          )
        const type = c['@t']
        let value: string | null = c.v === undefined ? null : txt(c.v),
          kind: Cell['kind'] = 'number'
        if (type === 's') {
          value = strings[Number(value)] ?? null
          kind = 'text'
        } else if (type === 'inlineStr') {
          value = rich(c.is)
          kind = 'text'
        } else if (type === 'str' || type === 'd') {
          kind = 'text'
        } else if (type === 'e') {
          kind = 'error'
        } else if (type === 'b') {
          kind = 'boolean'
        } else if (value === null) {
          kind = 'blank'
        }
        cells[ref] = {
          ref,
          value,
          kind,
          ...(c.f !== undefined ? { formula: txt(c.f) } : {}),
          ...(c['@s'] !== undefined ? { style: c['@s'] } : {}),
        }
        sheet.maxRow = Math.max(sheet.maxRow, rn)
        sheet.maxCol = Math.max(sheet.maxCol, cn)
      }
    return sheet
  })
  if (!sheets.length || sheets.length > 20)
    throw new FlowError('sheet-limit', 'Use a workbook with 1–20 sheets.')
  return { name, format: 'xlsx', sheets, entries }
}
function readCsv(bytes: Uint8Array, name: string): Book {
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^\uFEFF/, '')
  } catch {
    throw new FlowError('csv-encoding', 'CSV must use UTF-8.')
  }
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false,
    closed = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          quoted = false
          closed = true
        }
      } else field += c
    } else if (c === '"') {
      if (field || closed) throw new FlowError('csv-syntax', 'Unexpected CSV quote.')
      quoted = true
    } else if (c === ',' || c === '\n' || c === '\r') {
      row.push(field)
      field = ''
      closed = false
      if (c !== ',') {
        if (c === '\r' && text[i + 1] === '\n') i++
        rows.push(row)
        row = []
      }
    } else {
      if (closed) throw new FlowError('csv-syntax', 'Unexpected characters after quoted field.')
      field += c
    }
    if (field.length > 10000 || row.length > 100 || rows.length > 10001)
      throw new FlowError('csv-limit', 'CSV exceeds supported bounds.')
  }
  if (quoted) throw new FlowError('csv-syntax', 'Unclosed CSV quote.')
  if (field || row.length || closed) {
    row.push(field)
    rows.push(row)
  }
  if (rows.length > 10001 || rows.some((r) => r.length > 100))
    throw new FlowError('csv-limit', 'CSV exceeds supported bounds.')
  const cells: Record<string, Cell> = {}
  rows.forEach((r, i) =>
    r.forEach((v, j) => {
      const ref = columnName(j + 1) + (i + 1)
      cells[ref] = { ref, value: v, kind: 'text' }
    }),
  )
  return {
    name,
    format: 'csv',
    sheets: [
      {
        name: 'CSV',
        path: '',
        cells,
        maxRow: rows.length,
        maxCol: Math.max(0, ...rows.map((r) => r.length)),
        merges: [],
        protected: false,
      },
    ],
  }
}
export function sheetOf(book: Book, name: string): Sheet {
  const s = book.sheets.find((s) => s.name === name)
  if (!s) throw new FlowError('missing-sheet', 'Worksheet not found: ' + name)
  return s
}
export function inRange(ref: string, range: string): boolean {
  const p = /^([A-Z]+)(\d+)$/.exec(ref)!,
    r = range.split(':').map((x) => /^([A-Z]+)(\d+)$/.exec(x)!)
  return (
    columnNumber(p[1]) >= columnNumber(r[0][1]) &&
    columnNumber(p[1]) <= columnNumber(r.at(-1)![1]) &&
    Number(p[2]) >= Number(r[0][2]) &&
    Number(p[2]) <= Number(r.at(-1)![2])
  )
}
export const escapeXml = (s: string) =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
const regexEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
function prefixOf(xml: string, root: string): string {
  const m = new RegExp('<([A-Za-z_][\\w.-]*:)?' + root + '\\b').exec(xml)
  if (!m) throw new FlowError('invalid-xml', 'Missing ' + root + ' XML root.')
  return m[1] ?? ''
}
function removeFormulaCaches(xml: string): string {
  const q = regexEscape(prefixOf(xml, 'worksheet'))
  return xml.replace(new RegExp('<' + q + 'c\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + q + 'c>)', 'g'), (c) =>
    new RegExp('<' + q + 'f\\b').test(c)
      ? c.replace(new RegExp('<' + q + 'v\\b[^>]*>[\\s\\S]*?<\\/' + q + 'v>', 'g'), '')
      : c,
  )
}
export function fillTemplate(book: Book, sheetName: string, changes: CellChange[]): Uint8Array {
  if (!book.entries) throw new FlowError('template-format', 'Template must be an XLSX workbook.')
  const sheet = sheetOf(book, sheetName)
  if (sheet.protected) throw new FlowError('protected-sheet', 'Target worksheet is protected.')
  let doc = strFromU8(book.entries[sheet.path])
  const prefix = prefixOf(doc, 'worksheet'),
    q = regexEscape(prefix),
    tag = (n: string) => prefix + n
  const entries = { ...book.entries }
  for (const change of changes) {
    const old = sheet.cells[change.ref]
    if (old?.formula !== undefined || sheet.merges.some((r) => inRange(change.ref, r)))
      throw new FlowError(
        'protected-cell',
        'Writable cells must not contain formulas or overlap merged cells: ' + change.ref,
      )
    if (change.after !== null && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(change.after))
      throw new FlowError('invalid-text', 'Output contains invalid XML text.')
    const value =
      change.after === null
        ? ''
        : change.kind === 'number'
          ? '<' + tag('v') + '>' + change.after + '</' + tag('v') + '>'
          : '<' +
            tag('is') +
            '><' +
            tag('t') +
            ' xml:space="preserve">' +
            escapeXml(change.after) +
            '</' +
            tag('t') +
            '></' +
            tag('is') +
            '>'
    const cell =
      '<' +
      tag('c') +
      ' r="' +
      change.ref +
      '"' +
      (old?.style !== undefined ? ' s="' + old.style + '"' : '') +
      (change.kind === 'text' && change.after !== null ? ' t="inlineStr"' : '') +
      '>' +
      value +
      '</' +
      tag('c') +
      '>'
    const existing = new RegExp(
      '<' + q + 'c\\b(?=[^>]*\\br=["\']' + change.ref + '["\'])[^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + q + 'c>)',
    )
    if (existing.test(doc)) doc = doc.replace(existing, () => cell)
    else {
      const rowNumber = Number(/\d+$/.exec(change.ref)![0]),
        rowRe = new RegExp(
          '<' +
            q +
            'row\\b(?=[^>]*\\br=["\']' +
            rowNumber +
            '["\'])[^>]*?(?:\\/>|>[\\s\\S]*?<\\/' +
            q +
            'row>)',
        )
      const rowMatch = doc.match(rowRe)
      if (rowMatch) {
        let rowXml = rowMatch[0]
        if (rowXml.endsWith('/>')) rowXml = rowXml.slice(0, -2) + '>' + cell + '</' + tag('row') + '>'
        else {
          let inserted = false
          rowXml = rowXml.replace(
            new RegExp(
              '<' + q + 'c\\b[^>]*\\br=["\']([A-Z]+)\\d+["\'][^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + q + 'c>)',
              'g',
            ),
            (s, c) => {
              if (!inserted && columnNumber(c) > columnNumber(change.ref.replace(/\d+$/, ''))) {
                inserted = true
                return cell + s
              }
              return s
            },
          )
          if (!inserted) rowXml = rowXml.replace('</' + tag('row') + '>', cell + '</' + tag('row') + '>')
        }
        doc = doc.replace(rowRe, () => rowXml)
      } else {
        const newRow = '<' + tag('row') + ' r="' + rowNumber + '">' + cell + '</' + tag('row') + '>'
        let inserted = false
        doc = doc.replace(
          new RegExp(
            '<' + q + 'row\\b[^>]*\\br=["\'](\\d+)["\'][^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + q + 'row>)',
            'g',
          ),
          (s, r) => {
            if (!inserted && Number(r) > rowNumber) {
              inserted = true
              return newRow + s
            }
            return s
          },
        )
        if (!inserted)
          doc = doc.replace('</' + tag('sheetData') + '>', newRow + '</' + tag('sheetData') + '>')
      }
    }
  }
  // Cached formula results may now be stale. Remove cache values while preserving every formula.
  doc = removeFormulaCaches(doc)
  entries[sheet.path] = strToU8(doc)
  // Formulas on other sheets may reference changed cells too: invalidate their caches as well.
  for (const other of book.sheets)
    if (other.path !== sheet.path)
      entries[other.path] = strToU8(removeFormulaCaches(strFromU8(entries[other.path])))
  let wb = strFromU8(entries['xl/workbook.xml'])
  const wp = prefixOf(wb, 'workbook'),
    calc = new RegExp(
      '<' + regexEscape(wp) + 'calcPr\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/' + regexEscape(wp) + 'calcPr>)',
    ),
    replacement = '<' + wp + 'calcPr fullCalcOnLoad="1" forceFullCalc="1"/>'
  wb = calc.test(wb)
    ? wb.replace(calc, replacement)
    : wb.replace('</' + wp + 'workbook>', replacement + '</' + wp + 'workbook>')
  entries['xl/workbook.xml'] = strToU8(wb)
  return zipSync(entries, { level: 6 })
}
