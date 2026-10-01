# 0.1.0 validation / 验证记录

Date: 2026-10-01. All business data in fixtures are synthetic.

## Tested result

`npm run check` covers strict host/client TypeScript checks, 26 core tests, and production builds. All 26 passed. Three browser tests passed: actual local-file workflow/export/reload, invalid-rule import/mobile layout, and pagination with a synthetic UI response. A preview-server regression also verifies dynamic free ports, bearer authorization and Origin checks. A new regression verifies absolute inspection row numbers across blank rows. See `tests/unit` and `tests/e2e` for reproducible checks.

| Fixture | Confirmed rule | Result |
| --- | --- | --- |
| month-end | Duplicate settlements rejected | 8 records, 2 matched, 6 exceptions; expected 555.50, actual 430.00; unavailable sides excluded |
| month-end | Explicit split-payment sum | `00004`: 70.00 + 50.00 = 120.00; remaining exceptions stay visible |
| next-month | Reused header/column mapping, split sum | 4 matched; both totals 600.29; 0.10 + 0.20 = 0.30 |
| alternate-template | Another sheet, start row 8, end row 27 | 3 records, 2 matched, 1 difference; preview shows old `OLD01` replaced by `S001` |

Regression checks cover blank keys, changed headers, leading zero identifiers, source formulas and merges, capacity overflow, formula/merge/protection boundaries, stale inputs, concurrent review versions, cross-session isolation, original-file preservation, cleared old cells, literal `=HYPERLINK(...)` text, report escaping, and resolved path fencing. Every existing template formula is checked after export, with its cache removed. Untouched ZIP parts are byte-compared.

Samples were authored and rendered independently with the bundled spreadsheet artifact tooling. All nine original input workbooks were visually inspected. All three exported templates were then independently imported using that tooling: text identifiers, formula expressions, recalculated totals and formula-error scans passed. Results are in [fixture-results.json](fixture-results.json). These checks use the artifact tool's formula engine, not Microsoft Excel. The separate blind dataset and desktop-application check are documented below. Fixtures are committed so plugin development does not require that authoring tool.

`npm audit --omit=dev` reported zero known production dependency advisories on this machine on 2026-10-01; this is not a security guarantee.

## Real DSH integration, simulated model

An isolated DSH Web **0.2.0-rc.2** host loaded the plugin. The launcher selected the current workspace/session, submitted instructions through the normal DSH prompt queue, and the real DSH tool runner executed `sheetflow_inspect` and `sheetflow_propose_recipe`. A user-side workbench loaded the proposal, generated a preview, reviewed six exceptions and exported all three files. No browser runtime errors were recorded.

The model endpoint was a **local scripted Messages server** producing known tool arguments over three requests. No real DeepSeek API call or fee was incurred. This proves transport, registration, lifecycle and workflow integration. It provides **no evidence of model reasoning, mapping quality, model latency or success on unfamiliar workbooks**.

The test used a separately installed DSH runtime. The plugin's `.npmrc` intentionally uses legacy peer resolution for development; its local development CLI dependency alone is not a validated complete DSH installation. Install DSH separately using its official instructions.

The built `.tgz` was also installed into a second, fresh isolated DSH profile, without a junction back to the source directory. The same scripted tool/review/export workflow passed. Package registration alone was not treated as proof of runtime compatibility.

`scripts/dsh-smoke.mjs` reproduces the scripted integration using an isolated `work/dsh-home` profile registered with the plugin. Set `SHEETFLOW_DSH_CLI` to an installed DSH `lib/bin.js` when necessary. `work/` logs and launch tokens are private and excluded from delivery.

## Before public release

1. **Real model review completed:** one newly authored synthetic dataset, real `deepseek-v4-pro` / `max`, 34.660-second recorded turn. Columns and template region were correct; two source header rows needed correction. The original proposal was rejected by the header guard. After reviewer corrections, 8 records (4 matched / 4 exceptions), totals 2,794.40 / 2,529.51 and difference -264.89 passed independent checks. [Full evidence, proposed mappings, corrections and tokens](real-model-validation.md).
2. **Native Excel check passed, user release confirmation pending:** the user subsequently explicitly delegated the [five-point check](manual-excel-check.md) to Codex through Computer Use. Microsoft Excel desktop 16.0.20326.20158 recalculated the export with `Ctrl+Alt+F9`: E4 2,794.40, G4 2,529.51, I4 -264.89. Temporarily changing E10 from 980.50 to 981.50 changed the live D10 formula from -5.00 to -6.00; `Ctrl+Z` restored the original values. All eight rows, three merged regions, formatting, fixed note and footer passed native UI inspection. The workbook was closed without saving; its disk hash is unchanged. [Seven unmodified native screenshots and cell comparisons](evidence/2026-10-01/excel-verification.json). This is Codex-operated application validation, not a human manual sign-off. No add-in was used. The data is synthetic; representative real business workbooks remain untested.
3. **Inspection improvement tested locally:** descriptions now include requested header rows and absolute sample row numbers, and model instructions require source-header reinspection. All 26 unit and 3 browser tests pass. This change has not been tested with another paid model call; the blind model evidence predates it.
4. README financial disclaimers and synthetic-data screenshot captions are present in both languages. [About, release body and publication plan](releases/release-plan.json) are prepared locally. Only after the user explicitly replies **“Excel 检查通过”**: create the `dsh-sheetflow` GitHub repository, set topic `dsh-plugin`, push main and publish **v0.1.0-pre as a Pre-release**. Do not publish npm. Do not describe scripted footage or artifact-tool rendering as real model or Excel evidence.

当前交付可用于本地试用与产品评审。PM 已附条件通过现有证据；未重复调用真实模型或重跑既有自动测试。按用户后续委托完成原生 Excel 五项检查，明确记录为 Codex 代操作。真实业务兼容性未验证，不据此宣称可用于正式财务交付。等待用户明确确认检查结果并放行发布，尚未上传 GitHub；本次不发布 npm。
