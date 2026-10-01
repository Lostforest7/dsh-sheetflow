# Development

Use Node 24. Run `npm ci --cache .cache/npm`, `npm run check`, and `npm run test:e2e`.

Use the committed synthetic fixtures. Never add business spreadsheets, `.dsh-sheetflow/` histories, launch tokens or credentials to a PR. New parsing or reconciliation behavior needs a regression scenario with independently known expected results. Keep template preservation limits explicit.

Browser tests use local files. Scripted DSH integration is a separate smoke check and must never be described as a real model quality benchmark. A real provider test needs explicit fee authorization and isolated credentials.

Node 22 and non-Windows support are declared engine/API targets, not established compatibility claims. Update `docs/validation.md` and `docs/compatibility.md` with actual evidence before widening claims.
