# Compatibility and preview limits

## Verified environment

| Component | Evidence |
| --- | --- |
| OS | Windows, current development machine |
| Node | 24.19.0 |
| DSH | Web 0.2.0-rc.2, isolated profile |
| Browser | Installed Windows Google Chrome, headless Playwright |
| Inputs | Three sets of synthetic XLSX tables and ordinary templates; UTF-8 CSV parser tests |
| Language | Chinese / English workbench; bilingual HTML report labels; internal issue codes and errors in English |
| Model integration | Real DSH session prompt and tool execution through a **local scripted Messages server** |
| Real model mapping | **Unverified** |

The Node engine accepts 22.19+ in the 22.x line and 24+, but only Node 24.19.0 has been exercised. Desktop, CLI-only UI, macOS/Linux, remote workspaces, other DSH releases, and real accounting datasets remain unverified.

## Supported business shape

Two tables, one match identifier and one two-decimal amount each. Orders must be unique by key. Settlement duplicates are exceptions unless the user explicitly selects summation for split payments. No automatic order deduplication, fuzzy matching, aggregation across currencies, many-to-many pairing, refunds interpretation, or business-period filtering. Currency and period are user assertions, not facts inferred from the workbooks.

Blank amounts are unavailable, never zero. Thousands separators, currency symbols, exponent notation, non-finite values and more than two decimals are invalid. Negative plain decimals are accepted. Source formula cells are flagged; cached formula results are not treated as reliable amounts. Merged mapped source cells, error cells and suspect numeric identifiers are flagged. Store IDs as text to retain leading zeroes.

Totals include each valid unambiguous side even if its counterpart is missing. They exclude invalid or ambiguous sides; they are not a complete accounting balance. Review acknowledgment means the user inspected an exception. It does not resolve it or imply accounting sign-off.

## Workbook bounds and preservation

- `.xlsx`, or UTF-8 comma-separated CSV with quoted fields for sources; `.xlsx` only for templates.
- Maximum 20 MiB per file, 80 MiB declared expanded ZIP size, 2,000 ZIP entries, 20 worksheets, 100 columns and 10,000 source data rows. XLSX cell row bound 10,050; CSV table bound 10,001 including its header.
- One fixed template sheet and reserved row range, maximum row 10,000. No row insertion, table resize or structural range updates. Expand the business template first if capacity is insufficient.
- Any formula or merge in a mapped target cell, including unused reserved cells, rejects the mapping. Protected target sheets are rejected.
- Values are patched in worksheet XML while retaining original styles and other archive parts. Both standard default namespaces and prefixed SpreadsheetML are supported. Formulas on all sheets are retained, cached results removed, and full recalculation requested.
- Excel must recalculate formulas after opening the exported copy. SheetFlow does not contain an Excel formula engine and does not attest to recalculated results.
- Per exported numeric cell: at most 13 integer digits plus two decimals, including explicit aggregation. Larger aggregates are rejected because Excel numeric precision would be insufficient.
- Macros, external workbook-link parts, and digital-signature parts are rejected. Encrypted files, `.xls`, `.xlsm`, `.xlsb`, rich Office features, charts/pivots, dynamic arrays, custom XML and application-specific round-trip fidelity are outside validation. Retaining ZIP bytes does not prove all Excel feature semantics.

## Local files and isolation

The host uses Node local filesystem access under the current observed DSH session workspace. It checks relative paths and resolved paths, rejects traversal/credential filenames and symlink escapes, and writes new output names with exclusive creation. It does **not** use a remote filesystem backend or route these plugin operations through DSH's sandbox approval implementation. Use a trusted local workspace; do not interpret this preview as a hardened multi-user service.

`.dsh-sheetflow/` stores recipes, proposals, histories and review records, keyed by session. This data, exported reports and trace JSON contain business information. They are intentionally excluded from the plugin's Git/package outputs. Add ignores in your business workspace too. Histories list the latest 30 previews; older cached records are not automatically deleted.

Input hashes are checked after preview and immediately before review/export. Review versions use compare-and-swap inside one host instance. External processes can still write files; there is no global filesystem transaction or multi-process lock. Exports represent the reviewed snapshot, and histories can be viewed after sources change without becoming valid for a new export.

The deterministic workbench runs locally and has no telemetry. Requesting AI sends the provided mapping instructions, bounded descriptions/samples and tool results through DSH's configured model route. SheetFlow does not manage model credentials. Its two model tools can inspect files and save a proposal; they do not approve or export. DSH may provide other tools separately.

## User interface

Records are paginated in groups of 100. Cell-change display shows the first 300 differences; the downloadable HTML and JSON contain the full set. Each exception must be acknowledged individually. Bulk approval, spreadsheet-style editing, drag/drop upload, rule migration UI and Excel add-in/live workbook operation are not implemented.

The preview server binds `127.0.0.1`, checks Host/Origin, and requires a random bearer token. It is a local development preview. It is not intended for internet hosting.
