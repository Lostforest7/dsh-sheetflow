# Recipe format

Recipes are strict JSON, schemaVersion 1. Start with one of the `examples/*/recipe.json` files. The workbench edits the common fields; advanced import validates on the host before applying anything.

| Section | Purpose |
| --- | --- |
| `name` | Reusable name; saving the same name updates that session's recipe |
| `currency` | Shared three-letter label, explicitly confirmed by the user |
| `orders`, `settlements` | Relative path, exact sheet name, header row, key/amount/optional label columns |
| `headers` | Exact expected header text; surrounding whitespace ignored when comparing |
| `match.trim` | Trim key whitespace; off preserves it |
| `match.caseSensitive` | Case-sensitive comparison, or explicit uppercase normalization |
| `match.settlementDuplicates` | `reject` or `sum`; orders are never silently summed |
| `match.tolerance` | Nonnegative two-decimal absolute difference tolerance; default `0.00` |
| `template` | Relative XLSX path, exact sheet, reserved start/end rows, distinct output columns |

Output fields: `key`, optional `label`, `expected`, `actual`, `difference`, `status`. `difference = actual − expected`. Unavailable amounts export as empty cells. Status values are stable English codes; the workbench translates them.

The reserved region is an explicit replacement area: its old values are included in preview, and unused rows in mapped columns are cleared. Other columns, formulas, merges and styles are retained. Do not include a formula column in the mapping.

Importing and saving a recipe do not run it. A model proposal is stored separately and must be loaded and confirmed by a user. File inspection exposes a bounded first five data rows, not the entire workbook, to the proposing model.

For the next period, place replacement inputs in the same workspace and refresh the file list. Reuse a saved recipe, adjust paths if needed, reconfirm headers, period, currency and the template region. Never reuse a historical review as approval for changed inputs.

## Architecture

`src/core` provides local parsing, deterministic reconciliation, minimal XLSX patching, workspace fencing, persisted reviews and reports. `src/host` registers the official DSH connection route and two tools, observing the actual session workspace. `src/client` injects the Web launcher and sends prompts through the session controller. `src/ui` is shared between the injected workbench and authenticated local preview.

The client contains no amount/reconciliation implementation. Recipe validation and monetary comparison happen on the host. Amounts use integer cents (`BigInt`), and export performs an independent value readback before publishing new files.
