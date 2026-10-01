import type { Preview } from '../shared/model.ts'
const esc = (v: unknown) =>
  String(v ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
export function reportHtml(p: Preview): string {
  const rows = p.rows
    .map(
      (r) =>
        '<tr><td>' +
        esc(r.key) +
        '</td><td>' +
        esc(r.label) +
        '</td><td>' +
        esc(r.expected ?? 'unavailable') +
        '</td><td>' +
        esc(r.actual ?? 'unavailable') +
        '</td><td>' +
        esc(r.difference ?? 'unavailable') +
        '</td><td>' +
        esc(r.status) +
        '</td><td>' +
        esc(r.issues.join(', ')) +
        '<br>' +
        (r.status === 'matched'
          ? '—'
          : p.acknowledgements.includes(r.id)
            ? '已核对 / Acknowledged'
            : '待核对 / Pending') +
        '</td><td>' +
        r.evidence
          .map(
            (e) =>
              esc(e.file) +
              ' / ' +
              esc(e.sheet) +
              ' / row ' +
              e.row +
              ' / ' +
              esc(e.cells.join(', ')) +
              '<br>' +
              esc(e.values.join(' · ')) +
              '<br>' +
              esc(e.rule),
          )
          .join('<hr>') +
        '</td></tr>',
    )
    .join('')
  const changes = p.changes
    .map(
      (c) =>
        '<tr><td>' +
        esc(c.ref) +
        '</td><td>' +
        esc(c.before ?? '∅') +
        '</td><td>' +
        esc(c.after ?? '∅') +
        '</td><td>' +
        esc(c.rowId) +
        '</td></tr>',
    )
    .join('')
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SheetFlow review</title>
 <style>body{font:14px system-ui;max-width:1500px;margin:40px auto;padding:24px;color:#172434}h1{font-size:28px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}th{background:#e9f0f4}small{color:#536579}pre{white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow-x:auto}</style>
 <h1>${esc(p.recipe.name)}</h1><p>DSH SheetFlow · ${esc(p.createdAt)} · ${esc(p.recipe.currency)}</p>
 <p>${p.summary.rows} records / 记录 · ${p.summary.exceptions} exceptions / 异常 · ${p.acknowledgements.length} acknowledged / 已核对</p>
 <p>应收 / Expected: ${esc(p.summary.expected)} · 到账 / Actual: ${esc(p.summary.actual)} · 差额 / Difference: ${esc(p.summary.difference)}</p>
 <p>合计仅含有效且无歧义金额。核对记录不表示异常已经解决。Totals include only valid, unambiguous amounts. Missing or invalid values stay unavailable. Acknowledgement records review; it does not resolve an exception.</p>
 ${p.warnings.map((w) => '<p>' + esc(w) + '</p>').join('')}
 <div class="scroll"><table><thead><tr><th>编号 / Key</th><th>名称 / Label</th><th>应收 / Expected</th><th>到账 / Actual</th><th>差额 / Difference</th><th>状态 / Status</th><th>异常与核对 / Issues & review</th><th>来源 / Evidence</th></tr></thead><tbody>${rows}</tbody></table></div>
 <h2>完整写入差异 / All cell changes (${p.changes.length})</h2><table><thead><tr><th>Cell</th><th>Before</th><th>After</th><th>Record ID</th></tr></thead><tbody>${changes}</tbody></table>
 <h2>输入指纹 / Input fingerprints</h2><pre>${esc(JSON.stringify(p.inputHashes, null, 2))}</pre>
 <h2>规则 / Recipe</h2><pre>${esc(JSON.stringify(p.recipe, null, 2))}</pre>
 <small>Independent community plugin. XLSX formulas are preserved and request recalculation when opened; SheetFlow does not calculate Excel formulas. 保留公式并请求 Excel 重算；插件自身不计算公式。</small></html>`
}
