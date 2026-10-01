var __knownSymbol = (name2, symbol) => (symbol = Symbol[name2]) ? symbol : /* @__PURE__ */ Symbol.for("Symbol." + name2);
var __typeError = (msg) => {
  throw TypeError(msg);
};
var __using = (stack, value, async) => {
  if (value != null) {
    if (typeof value !== "object" && typeof value !== "function") __typeError("Object expected");
    var dispose, inner;
    if (async) dispose = value[__knownSymbol("asyncDispose")];
    if (dispose === void 0) {
      dispose = value[__knownSymbol("dispose")];
      if (async) inner = dispose;
    }
    if (typeof dispose !== "function") __typeError("Object not disposable");
    if (inner) dispose = function() {
      try {
        inner.call(this);
      } catch (e) {
        return Promise.reject(e);
      }
    };
    stack.push([async, dispose, value]);
  } else if (async) {
    stack.push([async]);
  }
  return value;
};
var __callDispose = (stack, error, hasError) => {
  var E = typeof SuppressedError === "function" ? SuppressedError : function(e, s, m, _) {
    return _ = Error(m), _.name = "SuppressedError", _.error = e, _.suppressed = s, _;
  };
  var fail = (e) => error = hasError ? new E(e, error, "An error was suppressed during disposal") : (hasError = true, e);
  var next = (it) => {
    while (it = stack.pop()) {
      try {
        var result = it[1] && it[1].call(it[2]);
        if (it[0]) return Promise.resolve(result).then(next, (e) => (fail(e), next()));
      } catch (e) {
        fail(e);
      }
    }
    if (hasError) throw error;
  };
  return next();
};

// src/host/index.ts
import { defineTool } from "@deepseek-ai/dsh-tools";
import { z as z3 } from "zod";

// src/core/service.ts
import { writeFile as writeFile2, unlink } from "node:fs/promises";
import { randomUUID as randomUUID2 } from "node:crypto";
import { z as z2 } from "zod";

// src/core/storage.ts
import { readFile, writeFile, realpath, mkdir, lstat, rename, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

// src/shared/model.ts
import { z } from "zod";
var FlowError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
  code;
};
var col = z.string().regex(/^[A-Z]{1,3}$/).refine((s) => columnNumber(s) <= 100, "Supported columns are A through CV (100 columns).");
var SourceSchema = z.object({
  path: z.string().min(1).max(260),
  sheet: z.string().min(1).max(100),
  headerRow: z.number().int().min(1).max(50),
  key: col,
  amount: col,
  label: col.optional(),
  headers: z.object({ key: z.string().min(1), amount: z.string().min(1), label: z.string().optional() }).strict()
}).strict();
var RecipeSchema = z.object({
  schemaVersion: z.literal(1),
  name: z.string().trim().min(1).max(80),
  currency: z.string().regex(/^[A-Z]{3}$/),
  orders: SourceSchema,
  settlements: SourceSchema,
  match: z.object({
    trim: z.boolean(),
    caseSensitive: z.boolean(),
    settlementDuplicates: z.enum(["reject", "sum"]),
    tolerance: z.string().regex(/^\d{1,8}(\.\d{1,2})?$/)
  }).strict(),
  template: z.object({
    path: z.string().min(1).max(260),
    sheet: z.string().min(1).max(100),
    startRow: z.number().int().min(1).max(1e4),
    endRow: z.number().int().min(1).max(1e4),
    columns: z.object({
      key: col,
      label: col.optional(),
      expected: col,
      actual: col,
      difference: col,
      status: col
    }).strict()
  }).strict()
}).strict().superRefine((r, ctx) => {
  if (r.template.endRow < r.template.startRow)
    ctx.addIssue({ code: "custom", message: "Template endRow precedes startRow" });
  const cols = Object.values(r.template.columns);
  if (new Set(cols).size !== cols.length)
    ctx.addIssue({ code: "custom", message: "Output columns must be distinct" });
});
function columnNumber(s) {
  return [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
}
function columnName(n) {
  let s = "";
  while (n > 0) {
    n--;
    s = String.fromCharCode(65 + n % 26) + s;
    n = Math.floor(n / 26);
  }
  return s;
}
function cents(value) {
  if (value === null || !/^-?\d{1,13}(\.\d{1,2})?$/.test(value.trim()))
    throw new FlowError(
      "invalid-amount",
      "Amount must be a plain decimal with at most two decimal places; blank is not zero."
    );
  const s = value.trim(), negative = s.startsWith("-"), [whole, frac = ""] = s.replace(/^-/, "").split(".");
  return (BigInt(whole) * 100n + BigInt(frac.padEnd(2, "0"))) * (negative ? -1n : 1n);
}
function money(n) {
  const a = n < 0n ? -n : n;
  return (n < 0n ? "-" : "") + a / 100n + "." + (a % 100n).toString().padStart(2, "0");
}

// src/core/storage.ts
function relativeFile(file) {
  if (!file || file.length > 260 || path.isAbsolute(file) || /^[A-Za-z]:|[\u0000-\u001F]/.test(file) || file.split(/[\\/]/).some((x) => x === ".." || x === ".git" || x === ".credentials.yaml" || x === ".env"))
    throw new FlowError("invalid-path", "Choose a relative workspace file path.");
  return file.replaceAll("\\", "/");
}
var Workspace = class {
  constructor(root) {
    this.root = root;
  }
  root;
  async file(file, create = false) {
    const rel = relativeFile(file), root = await realpath(this.root), full = path.resolve(root, rel), resolved = create ? path.join(await realpath(path.dirname(full)), path.basename(full)) : await realpath(full);
    const back = path.relative(root, resolved);
    if (back.startsWith("..") || path.isAbsolute(back))
      throw new FlowError("outside-workspace", "File is outside the current workspace.");
    if (create) {
      const info = await lstat(full).catch(() => void 0);
      if (info) throw new FlowError("already-exists", "Export never overwrites an existing file.");
    }
    return resolved;
  }
  async read(file) {
    const full = await this.file(file), info = await lstat(full);
    if (!info.isFile() || info.size > 20 * 1024 * 1024)
      throw new FlowError("file-limit", "Use a regular file of at most 20 MiB.");
    return readFile(full);
  }
  async privateDir() {
    const root = await realpath(this.root), p = path.join(root, ".dsh-sheetflow");
    await mkdir(p, { recursive: true });
    const actual = await realpath(p), back = path.relative(root, actual);
    if (back.startsWith("..") || path.isAbsolute(back))
      throw new FlowError("outside-workspace", "Private storage must remain in this workspace.");
    return actual;
  }
  async readJson(name2) {
    const dir = await this.privateDir();
    try {
      return JSON.parse(await readFile(path.join(dir, name2), "utf8"));
    } catch (e) {
      if (e.code === "ENOENT") return void 0;
      throw e;
    }
  }
  async writeJson(name2, value) {
    const dir = await this.privateDir(), dest = path.join(dir, name2), temp = path.join(dir, randomUUID() + ".tmp");
    await writeFile(temp, JSON.stringify(value, null, 2), { flag: "wx" });
    await rename(temp, dest);
  }
  async list() {
    const root = await realpath(this.root), out = [];
    const walk = async (dir, depth) => {
      for (const e of await readdir(dir, { withFileTypes: true })) {
        if (out.length >= 200) return;
        if (e.name.startsWith(".") || ["node_modules", "work", "lib", "test-results", "playwright-report"].includes(e.name) || e.isSymbolicLink())
          continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory() && depth < 3) await walk(p, depth + 1);
        else if (e.isFile() && /\.(xlsx|csv)$/i.test(e.name))
          out.push(path.relative(root, p).replaceAll("\\", "/"));
        if (out.length >= 200) return;
      }
    };
    await walk(root, 0);
    return out.sort();
  }
};

// src/core/workbook.ts
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import path2 from "node:path";
var MAX_FILE = 20 * 1024 * 1024;
var MAX_EXPANDED = 80 * 1024 * 1024;
var parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
  trimValues: false,
  processEntities: true
});
var array = (v) => v === void 0 ? [] : Array.isArray(v) ? v : [v];
function xml(text) {
  if (/<!DOCTYPE|<!ENTITY/i.test(text) || XMLValidator.validate(text) !== true)
    throw new FlowError("invalid-xml", "Unsupported or invalid workbook XML");
  return parser.parse(text);
}
var txt = (v) => typeof v === "string" ? v : typeof v === "number" ? String(v) : v?.["#text"] ?? "";
function rich(v) {
  return array(v?.r).length ? array(v.r).map((x) => txt(x.t)).join("") : txt(v?.t);
}
function readBook(bytes, name2) {
  if (bytes.length > MAX_FILE) throw new FlowError("file-limit", "Input exceeds 20 MiB.");
  if (name2.toLowerCase().endsWith(".csv")) return readCsv(bytes, name2);
  if (!name2.toLowerCase().endsWith(".xlsx"))
    throw new FlowError("unsupported-format", "Use ordinary .xlsx or UTF-8 comma-separated .csv files.");
  let expanded = 0, count = 0, entries;
  const names = /* @__PURE__ */ new Set();
  try {
    entries = unzipSync(bytes, {
      filter: (f) => {
        expanded += f.originalSize;
        count++;
        if (expanded > MAX_EXPANDED || count > 2e3 || names.has(f.name) || /^(\/|[A-Za-z]:)|\\|(?:^|\/)\.\.(?:\/|$)/.test(f.name))
          throw new FlowError("zip-limit", "Workbook ZIP exceeds supported bounds.");
        names.add(f.name);
        return true;
      }
    });
  } catch (e) {
    if (e instanceof FlowError) throw e;
    throw new FlowError("invalid-xlsx", "Unable to read XLSX archive.");
  }
  if (Object.keys(entries).some((n) => /vbaProject|externalLinks|_xmlsignatures/i.test(n)))
    throw new FlowError(
      "unsupported-workbook",
      "Macros, external workbook links and digitally signed files are outside this preview."
    );
  const get = (n) => {
    if (!entries[n]) throw new FlowError("invalid-xlsx", "Missing XLSX part: " + n);
    return xml(strFromU8(entries[n]));
  };
  const root = get("xl/workbook.xml").workbook;
  const rels = array(get("xl/_rels/workbook.xml.rels").Relationships.Relationship);
  const strings = entries["xl/sharedStrings.xml"] ? array(get("xl/sharedStrings.xml").sst.si).map(rich) : [];
  const sheets = array(root.sheets?.sheet).map((s) => {
    const rel = rels.find((r) => r["@Id"] === s["@id"]);
    if (!rel || rel["@TargetMode"] === "External")
      throw new FlowError("invalid-xlsx", "Invalid worksheet relationship.");
    const target = String(rel["@Target"]), part = target.startsWith("/") ? target.slice(1) : path2.posix.normalize("xl/" + target);
    if (!part.startsWith("xl/worksheets/"))
      throw new FlowError("unsupported-sheet", "Only standard worksheets are supported.");
    const doc = get(part).worksheet, cells = {}, sheet = {
      name: String(s["@name"]),
      path: part,
      cells,
      maxRow: 0,
      maxCol: 0,
      merges: array(doc.mergeCells?.mergeCell).map((m) => String(m["@ref"])),
      protected: doc.sheetProtection !== void 0
    };
    for (const row of array(doc.sheetData?.row))
      for (const c of array(row.c)) {
        const ref = String(c["@r"]), m = /^([A-Z]{1,3})(\d+)$/.exec(ref);
        if (!m) throw new FlowError("invalid-cell", "Invalid cell reference.");
        const rn = Number(m[2]), cn = columnNumber(m[1]);
        if (rn < 1 || rn > 10050 || cn > 100 || cells[ref])
          throw new FlowError(
            "sheet-limit",
            "Supported worksheet bounds: 10,050 rows and 100 columns; duplicate cell addresses are rejected."
          );
        const type = c["@t"];
        let value = c.v === void 0 ? null : txt(c.v), kind = "number";
        if (type === "s") {
          value = strings[Number(value)] ?? null;
          kind = "text";
        } else if (type === "inlineStr") {
          value = rich(c.is);
          kind = "text";
        } else if (type === "str" || type === "d") {
          kind = "text";
        } else if (type === "e") {
          kind = "error";
        } else if (type === "b") {
          kind = "boolean";
        } else if (value === null) {
          kind = "blank";
        }
        cells[ref] = {
          ref,
          value,
          kind,
          ...c.f !== void 0 ? { formula: txt(c.f) } : {},
          ...c["@s"] !== void 0 ? { style: c["@s"] } : {}
        };
        sheet.maxRow = Math.max(sheet.maxRow, rn);
        sheet.maxCol = Math.max(sheet.maxCol, cn);
      }
    return sheet;
  });
  if (!sheets.length || sheets.length > 20)
    throw new FlowError("sheet-limit", "Use a workbook with 1\u201320 sheets.");
  return { name: name2, format: "xlsx", sheets, entries };
}
function readCsv(bytes, name2) {
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
  } catch {
    throw new FlowError("csv-encoding", "CSV must use UTF-8.");
  }
  const rows = [];
  let row = [], field = "", quoted = false, closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === '"') {
      if (field || closed) throw new FlowError("csv-syntax", "Unexpected CSV quote.");
      quoted = true;
    } else if (c === "," || c === "\n" || c === "\r") {
      row.push(field);
      field = "";
      closed = false;
      if (c !== ",") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        rows.push(row);
        row = [];
      }
    } else {
      if (closed) throw new FlowError("csv-syntax", "Unexpected characters after quoted field.");
      field += c;
    }
    if (field.length > 1e4 || row.length > 100 || rows.length > 10001)
      throw new FlowError("csv-limit", "CSV exceeds supported bounds.");
  }
  if (quoted) throw new FlowError("csv-syntax", "Unclosed CSV quote.");
  if (field || row.length || closed) {
    row.push(field);
    rows.push(row);
  }
  if (rows.length > 10001 || rows.some((r) => r.length > 100))
    throw new FlowError("csv-limit", "CSV exceeds supported bounds.");
  const cells = {};
  rows.forEach(
    (r, i) => r.forEach((v, j) => {
      const ref = columnName(j + 1) + (i + 1);
      cells[ref] = { ref, value: v, kind: "text" };
    })
  );
  return {
    name: name2,
    format: "csv",
    sheets: [
      {
        name: "CSV",
        path: "",
        cells,
        maxRow: rows.length,
        maxCol: Math.max(0, ...rows.map((r) => r.length)),
        merges: [],
        protected: false
      }
    ]
  };
}
function sheetOf(book, name2) {
  const s = book.sheets.find((s2) => s2.name === name2);
  if (!s) throw new FlowError("missing-sheet", "Worksheet not found: " + name2);
  return s;
}
function inRange(ref, range) {
  const p = /^([A-Z]+)(\d+)$/.exec(ref), r = range.split(":").map((x) => /^([A-Z]+)(\d+)$/.exec(x));
  return columnNumber(p[1]) >= columnNumber(r[0][1]) && columnNumber(p[1]) <= columnNumber(r.at(-1)[1]) && Number(p[2]) >= Number(r[0][2]) && Number(p[2]) <= Number(r.at(-1)[2]);
}
var escapeXml = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
var regexEscape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function prefixOf(xml2, root) {
  const m = new RegExp("<([A-Za-z_][\\w.-]*:)?" + root + "\\b").exec(xml2);
  if (!m) throw new FlowError("invalid-xml", "Missing " + root + " XML root.");
  return m[1] ?? "";
}
function removeFormulaCaches(xml2) {
  const q = regexEscape(prefixOf(xml2, "worksheet"));
  return xml2.replace(
    new RegExp("<" + q + "c\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/" + q + "c>)", "g"),
    (c) => new RegExp("<" + q + "f\\b").test(c) ? c.replace(new RegExp("<" + q + "v\\b[^>]*>[\\s\\S]*?<\\/" + q + "v>", "g"), "") : c
  );
}
function fillTemplate(book, sheetName, changes) {
  if (!book.entries) throw new FlowError("template-format", "Template must be an XLSX workbook.");
  const sheet = sheetOf(book, sheetName);
  if (sheet.protected) throw new FlowError("protected-sheet", "Target worksheet is protected.");
  let doc = strFromU8(book.entries[sheet.path]);
  const prefix = prefixOf(doc, "worksheet"), q = regexEscape(prefix), tag = (n) => prefix + n;
  const entries = { ...book.entries };
  for (const change of changes) {
    const old = sheet.cells[change.ref];
    if (old?.formula !== void 0 || sheet.merges.some((r) => inRange(change.ref, r)))
      throw new FlowError(
        "protected-cell",
        "Writable cells must not contain formulas or overlap merged cells: " + change.ref
      );
    if (change.after !== null && /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(change.after))
      throw new FlowError("invalid-text", "Output contains invalid XML text.");
    const value = change.after === null ? "" : change.kind === "number" ? "<" + tag("v") + ">" + change.after + "</" + tag("v") + ">" : "<" + tag("is") + "><" + tag("t") + ' xml:space="preserve">' + escapeXml(change.after) + "</" + tag("t") + "></" + tag("is") + ">";
    const cell = "<" + tag("c") + ' r="' + change.ref + '"' + (old?.style !== void 0 ? ' s="' + old.style + '"' : "") + (change.kind === "text" && change.after !== null ? ' t="inlineStr"' : "") + ">" + value + "</" + tag("c") + ">";
    const existing = new RegExp(
      "<" + q + `c\\b(?=[^>]*\\br=["']` + change.ref + `["'])[^>]*?(?:\\/>|>[\\s\\S]*?<\\/` + q + "c>)"
    );
    if (existing.test(doc)) doc = doc.replace(existing, () => cell);
    else {
      const rowNumber = Number(/\d+$/.exec(change.ref)[0]), rowRe = new RegExp(
        "<" + q + `row\\b(?=[^>]*\\br=["']` + rowNumber + `["'])[^>]*?(?:\\/>|>[\\s\\S]*?<\\/` + q + "row>)"
      );
      const rowMatch = doc.match(rowRe);
      if (rowMatch) {
        let rowXml = rowMatch[0];
        if (rowXml.endsWith("/>")) rowXml = rowXml.slice(0, -2) + ">" + cell + "</" + tag("row") + ">";
        else {
          let inserted = false;
          rowXml = rowXml.replace(
            new RegExp(
              "<" + q + `c\\b[^>]*\\br=["']([A-Z]+)\\d+["'][^>]*?(?:\\/>|>[\\s\\S]*?<\\/` + q + "c>)",
              "g"
            ),
            (s, c) => {
              if (!inserted && columnNumber(c) > columnNumber(change.ref.replace(/\d+$/, ""))) {
                inserted = true;
                return cell + s;
              }
              return s;
            }
          );
          if (!inserted) rowXml = rowXml.replace("</" + tag("row") + ">", cell + "</" + tag("row") + ">");
        }
        doc = doc.replace(rowRe, () => rowXml);
      } else {
        const newRow = "<" + tag("row") + ' r="' + rowNumber + '">' + cell + "</" + tag("row") + ">";
        let inserted = false;
        doc = doc.replace(
          new RegExp(
            "<" + q + `row\\b[^>]*\\br=["'](\\d+)["'][^>]*?(?:\\/>|>[\\s\\S]*?<\\/` + q + "row>)",
            "g"
          ),
          (s, r) => {
            if (!inserted && Number(r) > rowNumber) {
              inserted = true;
              return newRow + s;
            }
            return s;
          }
        );
        if (!inserted)
          doc = doc.replace("</" + tag("sheetData") + ">", newRow + "</" + tag("sheetData") + ">");
      }
    }
  }
  doc = removeFormulaCaches(doc);
  entries[sheet.path] = strToU8(doc);
  for (const other of book.sheets)
    if (other.path !== sheet.path)
      entries[other.path] = strToU8(removeFormulaCaches(strFromU8(entries[other.path])));
  let wb = strFromU8(entries["xl/workbook.xml"]);
  const wp = prefixOf(wb, "workbook"), calc = new RegExp(
    "<" + regexEscape(wp) + "calcPr\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/" + regexEscape(wp) + "calcPr>)"
  ), replacement = "<" + wp + 'calcPr fullCalcOnLoad="1" forceFullCalc="1"/>';
  wb = calc.test(wb) ? wb.replace(calc, replacement) : wb.replace("</" + wp + "workbook>", replacement + "</" + wp + "workbook>");
  entries["xl/workbook.xml"] = strToU8(wb);
  return zipSync(entries, { level: 6 });
}

// src/core/engine.ts
import { createHash } from "node:crypto";
var hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function records(book, source, match) {
  const sheet = sheetOf(book, source.sheet);
  for (const role of ["key", "amount", "label"]) {
    const col2 = source[role];
    if (!col2) continue;
    const expected = source.headers[role];
    if (!expected || sheet.cells[col2 + source.headerRow]?.value?.trim() !== expected.trim())
      throw new FlowError(
        "header-changed",
        "Header changed for " + source.path + " / " + source.sheet + " / " + col2 + ". Reinspect and confirm the mapping."
      );
  }
  const out = [];
  for (let row = source.headerRow + 1; row <= sheet.maxRow; row++) {
    const keyCell = sheet.cells[source.key + row], amountCell = sheet.cells[source.amount + row], labelCell = source.label ? sheet.cells[source.label + row] : void 0;
    if ([keyCell, amountCell, labelCell].every((c) => !c?.value?.trim() && c?.formula === void 0)) continue;
    let key = keyCell?.value ?? "", amount = null, issues = [];
    if (match.trim) key = key.trim();
    if (!match.caseSensitive) key = key.toLocaleUpperCase("en-US");
    if (!key) issues.push("blank-key");
    if (keyCell?.formula !== void 0 || amountCell?.formula !== void 0 || labelCell?.formula !== void 0)
      issues.push("source-formula");
    if ([keyCell, amountCell, labelCell].some((c) => c?.kind === "error")) issues.push("source-error");
    if (keyCell?.kind === "boolean" || amountCell?.kind === "boolean") issues.push("source-type");
    if ([source.key, source.amount, source.label].filter(Boolean).some((col2) => sheet.merges.some((range) => inRange(col2 + row, range))))
      issues.push("source-merge");
    if (keyCell?.kind === "number" && !/^\d{1,15}$/.test(keyCell.value ?? ""))
      issues.push("numeric-key-precision");
    try {
      amount = cents(amountCell?.value ?? null);
    } catch {
      issues.push("invalid-amount");
    }
    out.push({
      row,
      key,
      label: labelCell?.value ?? "",
      amount,
      issues,
      evidence: {
        file: source.path,
        sheet: source.sheet,
        row,
        cells: [source.key + row, source.amount + row, ...source.label ? [source.label + row] : []],
        values: [
          keyCell?.value ?? "",
          amountCell?.value ?? "",
          ...source.label ? [labelCell?.value ?? ""] : []
        ],
        rule: "Exact key match; " + (match.trim ? "trim whitespace; " : "") + (match.caseSensitive ? "case-sensitive" : "case-insensitive")
      }
    });
  }
  if (out.length > 1e4)
    throw new FlowError("row-limit", "A source table may contain at most 10,000 data rows.");
  return out;
}
function reconcile(raw, ordersBook, settlementsBook) {
  const recipe = RecipeSchema.parse(raw), orders = records(ordersBook, recipe.orders, recipe.match), settlements = records(settlementsBook, recipe.settlements, recipe.match);
  const group = (list, side) => {
    const m = /* @__PURE__ */ new Map();
    for (const r of list) {
      const k = r.key ? "key:" + r.key : "blank:" + side + ":" + r.row;
      m.set(k, [...m.get(k) ?? [], r]);
    }
    return m;
  };
  const left = group(orders, "orders"), right = group(settlements, "settlements"), keys = /* @__PURE__ */ new Set([...left.keys(), ...right.keys()]), rows = [];
  let expectedTotal = 0n, actualTotal = 0n;
  for (const key of keys) {
    const a = left.get(key) ?? [], b = right.get(key) ?? [], issues = [...new Set([...a, ...b].flatMap((r) => r.issues))];
    if (a.length > 1) issues.push("duplicate-order");
    if (b.length > 1 && recipe.match.settlementDuplicates === "reject") issues.push("duplicate-settlement");
    if (!a.length) issues.push("missing-order");
    if (!b.length) issues.push("missing-settlement");
    const invalid = (list) => list.some((r) => r.amount === null || r.issues.length);
    const expected = a.length === 1 && !invalid(a) ? a[0].amount : null;
    const actual = b.length && !invalid(b) && (b.length === 1 || recipe.match.settlementDuplicates === "sum") ? b.reduce((s, r) => s + r.amount, 0n) : null;
    const difference = expected !== null && actual !== null ? actual - expected : null;
    if (difference !== null && (difference < 0n ? -difference : difference) > cents(recipe.match.tolerance))
      issues.push("amount-difference");
    let status = "matched";
    if (issues.length)
      status = issues.some(
        (x) => [
          "blank-key",
          "invalid-amount",
          "source-formula",
          "source-error",
          "source-type",
          "source-merge",
          "numeric-key-precision"
        ].includes(x)
      ) ? "invalid-input" : issues.includes("duplicate-order") ? "duplicate-order" : issues.includes("duplicate-settlement") ? "duplicate-settlement" : issues.includes("missing-order") ? "missing-order" : issues.includes("missing-settlement") ? "missing-settlement" : "amount-difference";
    if (expected !== null) expectedTotal += expected;
    if (actual !== null) actualTotal += actual;
    const evidence = [...a, ...b].map((r) => ({
      ...r.evidence,
      rule: r.evidence.rule + (b.length > 1 && recipe.match.settlementDuplicates === "sum" ? "; sum settlement rows by confirmed rule" : "")
    }));
    rows.push({
      id: hash(JSON.stringify({ key, a: a.map((x) => x.row), b: b.map((x) => x.row) })).slice(0, 20),
      key: a[0]?.key ?? b[0]?.key ?? "",
      label: a[0]?.label ?? b[0]?.label ?? "",
      expected: expected === null ? null : money(expected),
      actual: actual === null ? null : money(actual),
      difference: difference === null ? null : money(difference),
      status,
      issues,
      evidence
    });
  }
  return {
    recipe,
    rows,
    summary: {
      rows: rows.length,
      matched: rows.filter((r) => r.status === "matched").length,
      exceptions: rows.filter((r) => r.status !== "matched").length,
      expected: money(expectedTotal),
      actual: money(actualTotal),
      difference: money(actualTotal - expectedTotal)
    }
  };
}
function planChanges(template, recipe, rows) {
  const target = recipe.template, sheet = sheetOf(template, target.sheet);
  if (template.format !== "xlsx") throw new FlowError("template-format", "The template must be .xlsx.");
  if (sheet.protected) throw new FlowError("protected-sheet", "Target worksheet is protected.");
  if (rows.length > target.endRow - target.startRow + 1)
    throw new FlowError(
      "template-capacity",
      "Template has insufficient reserved rows; expand the approved region first."
    );
  const changes = [];
  for (let i = 0; i <= target.endRow - target.startRow; i++)
    for (const [role, col2] of Object.entries(target.columns)) {
      const ref = col2 + (target.startRow + i), before = sheet.cells[ref], row = rows[i];
      if (before?.formula !== void 0 || sheet.merges.some((r) => inRange(ref, r)))
        throw new FlowError(
          "protected-cell",
          "Target region contains a formula or merge at " + ref + ". Choose writable columns only."
        );
      const after = row ? role === "status" ? row.status : row[role] : null;
      if (after !== null && ["expected", "actual", "difference"].includes(role)) cents(after);
      if ((before?.value ?? null) !== after)
        changes.push({
          ref,
          before: before?.value ?? null,
          after,
          kind: ["expected", "actual", "difference"].includes(role) ? "number" : "text",
          rowId: row?.id ?? "clear-unused",
          evidence: row?.evidence ?? []
        });
    }
  return changes;
}

// src/core/report.ts
var esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
function reportHtml(p) {
  const rows = p.rows.map(
    (r) => "<tr><td>" + esc(r.key) + "</td><td>" + esc(r.label) + "</td><td>" + esc(r.expected ?? "unavailable") + "</td><td>" + esc(r.actual ?? "unavailable") + "</td><td>" + esc(r.difference ?? "unavailable") + "</td><td>" + esc(r.status) + "</td><td>" + esc(r.issues.join(", ")) + "<br>" + (r.status === "matched" ? "\u2014" : p.acknowledgements.includes(r.id) ? "\u5DF2\u6838\u5BF9 / Acknowledged" : "\u5F85\u6838\u5BF9 / Pending") + "</td><td>" + r.evidence.map(
      (e) => esc(e.file) + " / " + esc(e.sheet) + " / row " + e.row + " / " + esc(e.cells.join(", ")) + "<br>" + esc(e.values.join(" \xB7 ")) + "<br>" + esc(e.rule)
    ).join("<hr>") + "</td></tr>"
  ).join("");
  const changes = p.changes.map(
    (c) => "<tr><td>" + esc(c.ref) + "</td><td>" + esc(c.before ?? "\u2205") + "</td><td>" + esc(c.after ?? "\u2205") + "</td><td>" + esc(c.rowId) + "</td></tr>"
  ).join("");
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:"><meta name="viewport" content="width=device-width, initial-scale=1"><title>SheetFlow review</title>
 <style>body{font:14px system-ui;max-width:1500px;margin:40px auto;padding:24px;color:#172434}h1{font-size:28px}table{border-collapse:collapse;width:100%}th,td{text-align:left;padding:12px;border-bottom:1px solid #ddd;vertical-align:top;overflow-wrap:anywhere}th{background:#e9f0f4}small{color:#536579}pre{white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow-x:auto}</style>
 <h1>${esc(p.recipe.name)}</h1><p>DSH SheetFlow \xB7 ${esc(p.createdAt)} \xB7 ${esc(p.recipe.currency)}</p>
 <p>${p.summary.rows} records / \u8BB0\u5F55 \xB7 ${p.summary.exceptions} exceptions / \u5F02\u5E38 \xB7 ${p.acknowledgements.length} acknowledged / \u5DF2\u6838\u5BF9</p>
 <p>\u5E94\u6536 / Expected: ${esc(p.summary.expected)} \xB7 \u5230\u8D26 / Actual: ${esc(p.summary.actual)} \xB7 \u5DEE\u989D / Difference: ${esc(p.summary.difference)}</p>
 <p>\u5408\u8BA1\u4EC5\u542B\u6709\u6548\u4E14\u65E0\u6B67\u4E49\u91D1\u989D\u3002\u6838\u5BF9\u8BB0\u5F55\u4E0D\u8868\u793A\u5F02\u5E38\u5DF2\u7ECF\u89E3\u51B3\u3002Totals include only valid, unambiguous amounts. Missing or invalid values stay unavailable. Acknowledgement records review; it does not resolve an exception.</p>
 ${p.warnings.map((w) => "<p>" + esc(w) + "</p>").join("")}
 <div class="scroll"><table><thead><tr><th>\u7F16\u53F7 / Key</th><th>\u540D\u79F0 / Label</th><th>\u5E94\u6536 / Expected</th><th>\u5230\u8D26 / Actual</th><th>\u5DEE\u989D / Difference</th><th>\u72B6\u6001 / Status</th><th>\u5F02\u5E38\u4E0E\u6838\u5BF9 / Issues & review</th><th>\u6765\u6E90 / Evidence</th></tr></thead><tbody>${rows}</tbody></table></div>
 <h2>\u5B8C\u6574\u5199\u5165\u5DEE\u5F02 / All cell changes (${p.changes.length})</h2><table><thead><tr><th>Cell</th><th>Before</th><th>After</th><th>Record ID</th></tr></thead><tbody>${changes}</tbody></table>
 <h2>\u8F93\u5165\u6307\u7EB9 / Input fingerprints</h2><pre>${esc(JSON.stringify(p.inputHashes, null, 2))}</pre>
 <h2>\u89C4\u5219 / Recipe</h2><pre>${esc(JSON.stringify(p.recipe, null, 2))}</pre>
 <small>Independent community plugin. XLSX formulas are preserved and request recalculation when opened; SheetFlow does not calculate Excel formulas. \u4FDD\u7559\u516C\u5F0F\u5E76\u8BF7\u6C42 Excel \u91CD\u7B97\uFF1B\u63D2\u4EF6\u81EA\u8EAB\u4E0D\u8BA1\u7B97\u516C\u5F0F\u3002</small></html>`;
}

// src/core/service.ts
var id = z2.string().regex(/^[a-f0-9-]{36}$/);
var version = z2.number().int().nonnegative();
var SheetFlowService = class {
  locks = /* @__PURE__ */ new Map();
  async execute(root, session, op, raw = {}, signal) {
    const key = root + "\0" + session, previous = this.locks.get(key) ?? Promise.resolve();
    const pending = previous.catch(() => {
    }).then(() => {
      signal?.throwIfAborted();
      return this.run(new Workspace(root), session, op, raw, signal);
    });
    this.locks.set(key, pending);
    try {
      return await pending;
    } finally {
      if (this.locks.get(key) === pending) this.locks.delete(key);
    }
  }
  prefix(session) {
    return hash(session).slice(0, 20);
  }
  async run(ws, session, op, raw, signal) {
    const prefix = this.prefix(session);
    if (op === "validateRecipe") return RecipeSchema.parse(raw);
    if (op === "listFiles") return ws.list();
    if (op === "describe") {
      const args = z2.object({ path: z2.string(), headerRow: z2.number().int().min(1).max(50).default(1) }).parse(raw), bytes = await ws.read(args.path), book = readBook(bytes, args.path);
      const result = {
        path: args.path,
        hash: hash(bytes),
        format: book.format,
        sheets: book.sheets.map((s) => ({
          name: s.name,
          rows: s.maxRow,
          columns: Array.from({ length: s.maxCol }, (_, i) => ({
            column: columnName(i + 1),
            header: s.cells[columnName(i + 1) + args.headerRow]?.value ?? ""
          })),
          sample: Array.from(
            { length: Math.min(5, Math.max(0, s.maxRow - args.headerRow)) },
            (_, i) => Array.from(
              { length: s.maxCol },
              (_2, j) => s.cells[columnName(j + 1) + (i + args.headerRow + 1)]?.value ?? ""
            )
          )
        }))
      };
      return result;
    }
    if (op === "recipes")
      return await ws.readJson(prefix + "-recipes.json") ?? [];
    if (op === "saveRecipe" || op === "propose") {
      const recipe = RecipeSchema.parse(raw);
      if (op === "propose") {
        await ws.writeJson(prefix + "-proposal.json", recipe);
        return { proposal: true, name: recipe.name };
      }
      const recipes = await ws.readJson(prefix + "-recipes.json") ?? [], rid = hash(recipe.name).slice(0, 20), next = recipes.filter((x) => x.id !== rid);
      next.unshift({ id: rid, recipe });
      await ws.writeJson(prefix + "-recipes.json", next.slice(0, 50));
      return { id: rid };
    }
    if (op === "proposal") return await ws.readJson(prefix + "-proposal.json") ?? null;
    if (op === "preview") {
      const recipe = RecipeSchema.parse(raw), inputHashes = {}, books = /* @__PURE__ */ new Map();
      for (const file of /* @__PURE__ */ new Set([recipe.orders.path, recipe.settlements.path, recipe.template.path])) {
        signal?.throwIfAborted();
        const bytes = await ws.read(file);
        inputHashes[file] = hash(bytes);
        books.set(file, readBook(bytes, file));
      }
      if (recipe.orders.path === recipe.settlements.path && recipe.orders.sheet === recipe.settlements.sheet)
        throw new FlowError("same-source", "Orders and settlements must refer to different tables.");
      const result = reconcile(recipe, books.get(recipe.orders.path), books.get(recipe.settlements.path)), changes = planChanges(books.get(recipe.template.path), recipe, result.rows);
      const p = {
        id: randomUUID2(),
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        recipe,
        inputHashes,
        rows: result.rows,
        changes,
        summary: result.summary,
        warnings: [
          "Totals include only valid, unambiguous amounts; unresolved values are excluded.",
          "Exports retain original formulas and request recalculation in Excel. Cached formula values are not evidence of recalculation."
        ],
        acknowledgements: [],
        version: 0
      };
      await this.fresh(ws, p);
      await ws.writeJson(prefix + "-" + p.id + ".json", p);
      const history = await ws.readJson(prefix + "-history.json") ?? [];
      await ws.writeJson(prefix + "-history.json", [p.id, ...history].slice(0, 30));
      return p;
    }
    if (op === "history") {
      const list = await ws.readJson(prefix + "-history.json") ?? [];
      const out = [];
      for (const rid of list) {
        const p = await ws.readJson(prefix + "-" + id.parse(rid) + ".json");
        if (p)
          out.push({
            id: p.id,
            name: p.recipe.name,
            createdAt: p.createdAt,
            summary: p.summary,
            exported: p.exported
          });
      }
      return out;
    }
    if (["getPreview", "acknowledge", "export", "report"].includes(op)) {
      const args = z2.object({
        id,
        version: version.optional(),
        rowId: z2.string().optional(),
        acknowledged: z2.boolean().optional()
      }).parse(raw), p = await ws.readJson(prefix + "-" + args.id + ".json");
      if (!p) throw new FlowError("not-found", "Preview not found in this session.");
      if (op === "getPreview") return p;
      if (op === "report") return reportHtml(p);
      if (args.version !== p.version)
        throw new FlowError("stale-version", "Review changed. Reload the preview before continuing.");
      if (op === "acknowledge" && p.exported)
        throw new FlowError("already-exported", "Exported reviews are immutable; generate a fresh preview.");
      await this.fresh(ws, p);
      if (op === "acknowledge") {
        const row = p.rows.find((r) => r.id === args.rowId);
        if (!row || row.status === "matched" || args.acknowledged === void 0)
          throw new FlowError("invalid-review", "Choose a valid exception to acknowledge.");
        p.acknowledgements = p.acknowledgements.filter((x) => x !== args.rowId);
        if (args.acknowledged) p.acknowledgements.push(row.id);
        p.version++;
        await ws.writeJson(prefix + "-" + p.id + ".json", p);
        return p;
      }
      if (p.exported)
        throw new FlowError(
          "already-exported",
          "This reviewed preview was already exported; start a fresh preview for another output."
        );
      const pending = p.rows.filter((r) => r.status !== "matched" && !p.acknowledgements.includes(r.id));
      if (pending.length)
        throw new FlowError(
          "unreviewed-exceptions",
          "Acknowledge every exception before exporting the reviewed result."
        );
      const template = readBook(await ws.read(p.recipe.template.path), p.recipe.template.path), bytes = fillTemplate(template, p.recipe.template.sheet, p.changes);
      const actual = sheetOf(readBook(bytes, "result.xlsx"), p.recipe.template.sheet);
      for (const c of p.changes)
        if ((actual.cells[c.ref]?.value ?? null) !== c.after)
          throw new FlowError("export-readback", "Exported value differs at " + c.ref);
      await this.fresh(ws, p);
      signal?.throwIfAborted();
      const stem = "sheetflow-" + p.id, file = stem + ".xlsx", report = stem + ".html", trace = stem + ".json", paths = await Promise.all([file, report, trace].map((x) => ws.file(x, true))), written = [];
      try {
        for (const [i, data] of [bytes, reportHtml(p), JSON.stringify(p, null, 2)].entries()) {
          await writeFile2(paths[i], data, { flag: "wx" });
          written.push(paths[i]);
        }
      } catch (e) {
        await Promise.all(written.map((x) => unlink(x).catch(() => {
        })));
        throw e;
      }
      p.exported = { file, report, trace };
      p.version++;
      await ws.writeJson(prefix + "-" + p.id + ".json", p);
      return p;
    }
    throw new FlowError("unknown-operation", "Unknown SheetFlow operation.");
  }
  async fresh(ws, p) {
    for (const [file, fingerprint] of Object.entries(p.inputHashes)) {
      if (hash(await ws.read(file)) !== fingerprint)
        throw new FlowError(
          "stale-input",
          "An input or template changed since preview. Generate a fresh preview and review again."
        );
    }
  }
};

// src/host/index.ts
var name = "dsh-sheetflow";
var inject = ["connection", "sessionQuery", "tools"];
var Request = z3.object({
  type: z3.literal("client-request"),
  rpcId: z3.string().min(1).max(200),
  method: z3.literal("dsh-sheetflow"),
  payload: z3.object({
    sessionId: z3.string().min(1).max(200),
    operation: z3.string().max(40),
    args: z3.unknown()
  })
});
function apply(ctx) {
  const service = new SheetFlowService();
  async function run(session, op, args, signal) {
    var _stack = [];
    try {
      const obs = __using(_stack, await ctx.sessionQuery.observeSession(session, { projectionMode: "none", signal }));
      const root = obs.header.cwd;
      if (!root) throw new FlowError("no-workspace", "Choose a DSH session with a local workspace.");
      return service.execute(root, session, op, args, signal);
    } catch (_) {
      var _error = _, _hasError = true;
    } finally {
      __callDispose(_stack, _error, _hasError);
    }
  }
  ctx.connection.fetch.register({
    path: "/api/dsh-sheetflow",
    methods: ["POST"],
    requestBody: "buffered",
    fetch: async (incoming) => {
      let rpcId = "invalid-request";
      try {
        const req = Request.parse(await incoming.json());
        rpcId = req.rpcId;
        return Response.json(
          {
            type: "server-response",
            rpcId,
            result: {
              ok: true,
              value: await run(
                req.payload.sessionId,
                req.payload.operation,
                req.payload.args,
                incoming.signal
              )
            }
          },
          { headers: { "cache-control": "no-store" } }
        );
      } catch (e) {
        return Response.json(
          {
            type: "server-response",
            rpcId,
            result: {
              ok: false,
              error: {
                code: e instanceof FlowError ? e.code : "sheetflow/failed",
                message: e instanceof Error ? e.message : String(e),
                details: {}
              }
            }
          },
          { headers: { "cache-control": "no-store" } }
        );
      }
    }
  });
  function sessionOf(exec) {
    if (!exec.agent) throw new FlowError("no-agent", "This tool requires a current DSH agent session.");
    return exec.agent.session.id;
  }
  ctx.tools.register(
    defineTool({
      name: "sheetflow_inspect",
      description: "Inspect a relative workspace XLSX/CSV file for SheetFlow mapping. Returns bounded headers and sample rows, without modifying the file.",
      parameters: { path: { type: "string", required: true }, headerRow: { type: "integer" } },
      output: {
        schema: { type: "json" },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
      },
      async execute(args, exec) {
        return await run(
          sessionOf(exec),
          "describe",
          { path: args.path, headerRow: args.headerRow ?? 1 },
          exec.signal
        );
      }
    })
  );
  ctx.tools.register(
    defineTool({
      name: "sheetflow_propose_recipe",
      description: "Propose a SheetFlow schemaVersion 1 recipe for human review. Does not run, approve or export it. Use the exact recipe JSON structure supplied by the SheetFlow request, preserving confirmed headers; recipeJson is a JSON string.",
      parameters: { recipeJson: { type: "string", required: true } },
      output: {
        schema: { type: "json" },
        render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
      },
      async execute(args, exec) {
        if (args.recipeJson.length > 2e4) throw new FlowError("body-limit", "Recipe is too large.");
        return await run(sessionOf(exec), "propose", JSON.parse(args.recipeJson), exec.signal);
      }
    })
  );
}
export {
  apply,
  inject,
  name
};
