# DSH SheetFlow

**Fill recurring Excel templates, review reconciliation exceptions, and trace every value to its source.**

> **Financial disclaimer:** SheetFlow assists with data preparation and reconciliation review. It does not provide accounting, tax or financial advice and is not an accounting system. AI mappings and all exported amounts, formulas and exceptions require independent review before business use. Acknowledging an exception does not resolve it or approve a payment.

**0.1.0 local preview:** tested on Windows with Node 24.19.0 and DSH Web 0.2.0-rc.2. Chinese / English workbench. Three examples plus one newly created synthetic blind dataset verified. A real `deepseek-v4-pro` / `max` run proposed the correct columns but needed **two source-header-row corrections** before export. This is one assisted success, not proof of unattended mapping or production workbook compatibility. See the [real model review](docs/real-model-validation.md). No GitHub or npm release yet.

[中文](README.zh-CN.md) · [Compatibility](docs/compatibility.md) · [Validation evidence](docs/validation.md) · [Recipe format](docs/recipes.md)

The blind export also passed a delegated native Microsoft Excel UI check: forced recalculation, a live formula edit/undo, all eight rows and three merged regions. [Screenshots and results](docs/evidence/2026-10-01/excel-verification.json). This was operated by Codex on synthetic data, not a human accounting sign-off.

![Synthetic example data: reviewed month-end records, exceptions and evidence](docs/assets/review-workbench.png)

*Demo screenshot: synthetic example data.*

An independent community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Start with an orders table, a settlements table, and an existing business template. Confirm the mapping once, preview every write, review every exception, and export a new template copy with an HTML report and JSON trace.

- **Explicit mappings:** file, sheet, header row, match key, amount, and reserved template cells.
- **Exact decimal comparison:** two-decimal amounts, optional tolerance, explicit split-payment aggregation. Blank amounts remain unavailable.
- **Explainable exceptions:** missing records, duplicate keys, invalid inputs, and amount differences retain source file / sheet / row / cell evidence.
- **Template copies:** retains original ZIP parts and cell styles, protects formula cells and merges, and previews clearing old unused rows.
- **Repeatable recipes:** save/import/export rules; changed headers stop a reused rule. Local histories are isolated by workspace and DSH session.
- **Human review:** every exception must be acknowledged before export. Changed inputs invalidate a review. Acknowledgement records inspection, not resolution.
- **DSH tools:** AI can inspect bounded samples and submit a proposed recipe. Execution, acknowledgement, and export remain workbench actions.

## Try locally in three steps

Use Node 24, or Node 22.19+ within the 22.x line. No Microsoft Excel or model API key is needed for this local sample.

```sh
# Run in the extracted source folder
npm ci --cache .cache/npm
npm run build
npm run dev
```

Open the local URL printed in the terminal. Choose **Load sample mapping**, confirm the mapping, then **Generate preview**. The sample has eight records: two matched and six exceptions. Review evidence and acknowledge all exceptions to export. New `.xlsx`, `.html`, and `.json` files are saved alongside the inputs in `examples/month-end/`.

The standalone preview verifies rule execution. AI proposals are available inside DSH.

## Use in DSH

1. Install and configure DSH using its [official instructions](https://github.com/deepseek-ai/deepseek-harness). Build this source folder using the commands above, then register the plugin:

   ```sh
   dsh plugin --profile web add /absolute/path/to/dsh-sheetflow
   # A built .tgz can be registered with the same command.
   dsh web
   ```

2. In DSH, select a workspace containing the two source tables and template. To try the example, select the plugin's `examples/month-end` folder. Click **SheetFlow 填表台** and switch to English if desired.
3. Confirm mappings and the writable region, generate a preview, inspect exceptions, and export a new copy. For AI help, send mapping instructions, wait for the current DSH session to finish, then choose **Load proposal** and confirm it.

Add `.dsh-sheetflow/` and generated `sheetflow-*.xlsx`, `sheetflow-*.html`, `sheetflow-*.json` to the business workspace's `.gitignore`. Histories and reports contain business data. Input files remain local during deterministic processing; using AI sends the supplied instructions, bounded samples, and inspection results through your configured DSH model provider.

## Scope

Ordinary `.xlsx` templates and `.xlsx` / UTF-8 comma-separated `.csv` tables; one key and one two-decimal amount per source, one shared currency and business period, a fixed reserved writable region. Sources may be separate sheets of the same workbook. Recipes are per DSH session; use JSON to transfer them.

This preview does not calculate Excel formulas, perform currency conversion, fuzzy matching, many-to-many reconciliation, OCR/PDF ingestion, or insert template rows. Formulas are preserved and caches invalidated; open the copy in Excel and recalculate before relying on formula outputs. Macros, digital signatures, external workbook links and protected target sheets are rejected. Complex workbook fidelity and remote/sandbox-only filesystem backends are unverified. [Full limits](docs/compatibility.md).

## Develop

```sh
npm run check
npm run test:e2e
```

Browser tests use Windows Google Chrome when available; otherwise run `npx playwright install chromium`. `SHEETFLOW_CHROMIUM_PATH` can select a browser. `.npmrc` uses legacy peer resolution to work around the tested DSH prerelease dependency graph; DSH itself should be installed separately using its official instructions.

For another local fixture:

```powershell
$env:SHEETFLOW_WORKSPACE = "examples/next-month"
npm run dev
```

Import that folder's `recipe.json` through **Advanced**. The next-month example demonstrates `0.10 + 0.20 = 0.30`; the supplier example uses another sheet, row range and prefilled template.

MIT licensed. Preview acceptance, integration boundaries, and the next validation gate are documented in [validation.md](docs/validation.md).
