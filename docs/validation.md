# 0.1.0 validation / 验证记录

Date: 2026-10-01. All business data in fixtures are synthetic.

## Tested result

`npm run check` covers strict host/client TypeScript checks, 25 core tests, and production builds. All 25 passed. Three browser tests passed: actual local-file workflow/export/reload, invalid-rule import/mobile layout, and pagination with a synthetic UI response. A preview-server regression also verifies dynamic free ports, bearer authorization and Origin checks. See `tests/unit` and `tests/e2e` for reproducible checks.

| Fixture | Confirmed rule | Result |
| --- | --- | --- |
| month-end | Duplicate settlements rejected | 8 records, 2 matched, 6 exceptions; expected 555.50, actual 430.00; unavailable sides excluded |
| month-end | Explicit split-payment sum | `00004`: 70.00 + 50.00 = 120.00; remaining exceptions stay visible |
| next-month | Reused header/column mapping, split sum | 4 matched; both totals 600.29; 0.10 + 0.20 = 0.30 |
| alternate-template | Another sheet, start row 8, end row 27 | 3 records, 2 matched, 1 difference; preview shows old `OLD01` replaced by `S001` |

Regression checks cover blank keys, changed headers, leading zero identifiers, source formulas and merges, capacity overflow, formula/merge/protection boundaries, stale inputs, concurrent review versions, cross-session isolation, original-file preservation, cleared old cells, literal `=HYPERLINK(...)` text, report escaping, and resolved path fencing. Every existing template formula is checked after export, with its cache removed. Untouched ZIP parts are byte-compared.

Samples were authored and rendered independently with the bundled spreadsheet artifact tooling. All nine input workbooks were visually inspected. All three exported templates were then independently imported using that tooling: text identifiers, formula expressions, recalculated totals and formula-error scans passed. Results are in [fixture-results.json](fixture-results.json). This uses the artifact tool's formula engine, not Microsoft Excel; no Excel application calculation has been tested. Fixtures are committed so plugin development does not require that authoring tool.

`npm audit --omit=dev` reported zero known production dependency advisories on this machine on 2026-10-01; this is not a security guarantee.

## Real DSH integration, simulated model

An isolated DSH Web **0.2.0-rc.2** host loaded the plugin. The launcher selected the current workspace/session, submitted instructions through the normal DSH prompt queue, and the real DSH tool runner executed `sheetflow_inspect` and `sheetflow_propose_recipe`. A user-side workbench loaded the proposal, generated a preview, reviewed six exceptions and exported all three files. No browser runtime errors were recorded.

The model endpoint was a **local scripted Messages server** producing known tool arguments over three requests. No real DeepSeek API call or fee was incurred. This proves transport, registration, lifecycle and workflow integration. It provides **no evidence of model reasoning, mapping quality, model latency or success on unfamiliar workbooks**.

The test used a separately installed DSH runtime. The plugin's `.npmrc` intentionally uses legacy peer resolution for development; its local development CLI dependency alone is not a validated complete DSH installation. Install DSH separately using its official instructions.

The built `.tgz` was also installed into a second, fresh isolated DSH profile, without a junction back to the source directory. The same scripted tool/review/export workflow passed. Package registration alone was not treated as proof of runtime compatibility.

`scripts/dsh-smoke.mjs` reproduces the scripted integration using an isolated `work/dsh-home` profile registered with the plugin. Set `SHEETFLOW_DSH_CLI` to an installed DSH `lib/bin.js` when necessary. `work/` logs and launch tokens are private and excluded from delivery.

## Before public release

1. Run the real configured DeepSeek model against an unfamiliar table/template pair; record proposed mappings, any correction, outcome and latency. This is a separate paid test requiring authorization.
2. Verify at least one representative real business workbook, especially formulas and formatting in an installed Excel application.
3. Package as a pre-release with a clearly captioned demo and this compatibility matrix. Do not describe scripted model footage as a real model demonstration.

当前交付可用于本地试用与产品评审。真实模型质量和真实业务兼容性尚未完成验证，不据此宣称已经可用于正式财务交付。
