/**
 * Read a workbook into `ParsedSheet`, and never let ExcelJS speak to the user.
 *
 * Four decisions here come straight out of the competitive analysis, and each
 * deletes a rule from the fourteen-item checklist their users have to obey
 * before uploading anything:
 *
 *   "Make sure all your sales data is in the first sheet"
 *      -> every sheet is listed, and the default is the one with the most
 *         populated cells rather than the first. A workbook whose first tab is
 *         "Instructions" is the normal case, not the exception.
 *
 *   "Only add up to 10,000 rows per sheet" (their own FAQ then says 7,000)
 *      -> the ceiling is `MAX_ROWS` and it counts populated rows. Their FAQ
 *         admits theirs counts the used range: "select the entire blank rows
 *         and blank columns, delete them using CTRL -, save and re-upload" is a
 *         workaround for a bug, and streaming past empty rows is the fix.
 *
 *   "Use 'Excel Workbook' format - not CSV or PDF"
 *      -> .xlsx and .csv both work. .xls does not, and says so precisely.
 *
 *   "Delete rows with Grand Total or any notes"
 *      -> dropped here, and reported in `droppedRowIndexes` so the count the
 *         user sees still reconciles with the file they uploaded.
 *
 * ExcelJS's streaming reader is used rather than `workbook.xlsx.load`, so a
 * large upload never materialises as an object graph and the row ceiling can
 * abort mid-file instead of after it.
 *
 * `xlsx` (SheetJS on npm) is deliberately absent: the package is abandoned and
 * carries two unpatched high-severity advisories whose vulnerable path is
 * parsing an untrusted uploaded file, which is precisely this code path.
 */

import ExcelJS from "exceljs";
import { Readable } from "node:stream";
import { open } from "node:fs/promises";
import type { CellValue, ParsedSheet, SheetSummary } from "./types";
import { MAX_ROWS } from "./types";
import { normalizeCell } from "./normalizeCell";
import {
  HEADER_SCAN_ROWS,
  detectGrandTotalRows,
  detectHeaderRow,
  headerRowToStrings,
} from "./detectHeader";

export type ExcelParseErrorCode =
  | "LEGACY_XLS"
  | "UNSUPPORTED_FORMAT"
  | "UNREADABLE_FILE"
  | "EMPTY_WORKBOOK"
  | "SHEET_NOT_FOUND"
  | "NO_DATA_ROWS"
  | "ROW_LIMIT_EXCEEDED";

/**
 * Every failure an accountant can see, with a message they can act on.
 *
 * ExcelJS throws things like "Can't find end of central directory" and
 * "invalid signature: 0xe011cfd0". Both are true and useless. Each is caught
 * and re-thrown as one of these, because a vague parse failure on an upload
 * becomes a support ticket and a lost afternoon.
 */
export class ExcelParseError extends Error {
  readonly code: ExcelParseErrorCode;
  /** The underlying library message, for logs. Never shown to the user. */
  readonly detail: string | null;

  constructor(code: ExcelParseErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = "ExcelParseError";
    this.code = code;
    this.detail = cause instanceof Error ? cause.message : cause == null ? null : String(cause);
    Object.setPrototypeOf(this, ExcelParseError.prototype);
  }
}

export interface SpreadsheetInput {
  /** Original filename. The extension is the first format signal; magic bytes settle it. */
  fileName?: string;
  /** File bytes, for an upload held in memory. */
  data?: Buffer | Uint8Array;
  /** Path on disk. Preferred - ExcelJS streams from it without buffering the zip. */
  path?: string;
}

/** Bytes are the common case (a multipart upload); the object form adds a path. */
export type SpreadsheetSource = Buffer | Uint8Array | SpreadsheetInput;

export interface ParseSheetOptions {
  /** Original filename, when the source is a bare buffer. */
  fileName?: string;
  /** Which sheet. Defaults to the one `pickDefaultSheet` chooses. */
  sheetName?: string;
  /** Override header detection, for when the user has corrected the wizard. */
  headerRowIndex?: number;
  /** Populated-row ceiling. Defaults to `MAX_ROWS`. */
  maxRows?: number;
  /** Drop detected grand-total rows. Default true; they are always reported. */
  dropGrandTotalRows?: boolean;
}

/**
 * What a scan learns about one sheet.
 *
 * `SheetSummary` is the contract and carries no notion of "the best sheet", so
 * the populated-cell count that picks the default rides alongside it rather
 * than being folded in.
 */
export interface SheetScan {
  summary: SheetSummary;
  headerRowIndex: number;
  headers: string[];
  /** Non-empty cells across the whole sheet - the default-sheet tie-breaker. */
  populatedCells: number;
}

type SheetFormat = "xlsx" | "csv";

/** Rows held in memory per sheet during a scan: enough to detect a header. */
const SCAN_BUFFER_ROWS = HEADER_SCAN_ROWS + 8;

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
const OLE2_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

function resolveInput(source: SpreadsheetSource, fileName?: string): Required<
  Pick<SpreadsheetInput, "fileName">
> &
  SpreadsheetInput {
  if (Buffer.isBuffer(source) || source instanceof Uint8Array) {
    return { fileName: fileName ?? "", data: source };
  }
  return { ...source, fileName: fileName ?? source.fileName ?? "" };
}

type ResolvedInput = ReturnType<typeof resolveInput>;

function describe(input: ResolvedInput): string {
  return input.fileName ? `"${input.fileName}"` : "That file";
}

// ---------------------------------------------------------------------------
// Format sniffing
// ---------------------------------------------------------------------------

async function firstBytes(input: ResolvedInput, count: number): Promise<Uint8Array> {
  if (input.data) return Uint8Array.prototype.slice.call(input.data, 0, count);
  if (!input.path) return new Uint8Array(0);
  const handle = await open(input.path, "r");
  try {
    const buffer = Buffer.alloc(count);
    const { bytesRead } = await handle.read(buffer, 0, count, 0);
    return new Uint8Array(buffer.subarray(0, bytesRead));
  } finally {
    await handle.close();
  }
}

function startsWith(bytes: Uint8Array, magic: number[]): boolean {
  if (bytes.length < magic.length) return false;
  return magic.every((b, i) => bytes[i] === b);
}

/** A NUL byte in the first block means binary; CSV never contains one. */
function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false;
  return !bytes.some((b) => b === 0x00);
}

const LEGACY_XLS_MESSAGE =
  "This is an old-format .xls workbook, or a password-protected file. Neither can be read. " +
  "Open it in Excel, use File > Save As > Excel Workbook (.xlsx) with no password, and upload that.";

/**
 * Decide the format from the bytes, falling back to the extension.
 *
 * The magic-byte check earns its keep on the .xls case: a file renamed to
 * .xlsx still fails, and it fails here with the "re-save as .xlsx" instruction
 * rather than eighty frames deep in unzipper. The same OLE2 signature also
 * fronts a password-protected .xlsx, so the message names both possibilities
 * instead of confidently asserting the wrong one.
 */
async function detectFormat(input: ResolvedInput): Promise<SheetFormat> {
  const extension = (input.fileName.match(/\.([a-z0-9]+)$/i)?.[1] ?? "").toLowerCase();
  const bytes = await firstBytes(input, 512);

  if (startsWith(bytes, OLE2_MAGIC)) throw new ExcelParseError("LEGACY_XLS", LEGACY_XLS_MESSAGE);
  if (extension === "xls") throw new ExcelParseError("LEGACY_XLS", LEGACY_XLS_MESSAGE);

  if (startsWith(bytes, ZIP_MAGIC)) return "xlsx";
  if (extension === "csv" || extension === "txt" || extension === "tsv") return "csv";
  if (extension === "xlsx" || extension === "xlsm") {
    throw new ExcelParseError(
      "UNREADABLE_FILE",
      `${describe(input)} is named .${extension} but is not a valid Excel workbook. It may be truncated or still uploading. Open it in Excel and save a fresh copy.`
    );
  }
  // An unnamed buffer that is plainly text is a CSV. Guessing is better than
  // refusing here: the caller had no extension to give us.
  if (extension === "" && looksLikeText(bytes)) return "csv";

  throw new ExcelParseError(
    "UNSUPPORTED_FORMAT",
    `${describe(input)} is not a spreadsheet this can read. Upload an .xlsx workbook or a .csv file.`
  );
}

// ---------------------------------------------------------------------------
// Reading rows
// ---------------------------------------------------------------------------

/** ExcelJS's streaming worksheet, which its own typings describe without `name`. */
interface NamedWorksheetReader extends AsyncIterable<ExcelJSRow> {
  name?: string;
}

interface ExcelJSCell {
  value: unknown;
  numFmt?: string;
}

interface ExcelJSRow {
  number: number;
  eachCell(
    options: { includeEmpty: boolean },
    callback: (cell: ExcelJSCell, colNumber: number) => void
  ): void;
}

type VisitRow = (sheetName: string, rowIndex: number, cells: CellValue[]) => void;

/**
 * Where rows go, plus a way to unwind a half-finished pass.
 *
 * `reset` exists only because the streaming read can fail after emitting rows;
 * see `readXlsx`. Without it, a fallback pass would double every row it had
 * already delivered.
 */
interface RowSink {
  visit: VisitRow;
  reset: () => void;
}

function rowToCells(row: ExcelJSRow): CellValue[] {
  const cells: CellValue[] = [];
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    cells[colNumber - 1] = normalizeCell(cell.value, { numFmt: cell.numFmt });
  });
  for (let i = 0; i < cells.length; i += 1) {
    if (cells[i] === undefined) cells[i] = null;
  }
  return cells;
}

function isBlankRow(cells: CellValue[]): boolean {
  return cells.every((v) => v === null || v === "");
}

function toStream(input: ResolvedInput): Readable | string {
  if (input.path) return input.path;
  if (input.data) return Readable.from(Buffer.from(input.data));
  throw new ExcelParseError(
    "UNREADABLE_FILE",
    "No file contents were supplied. Upload the spreadsheet again."
  );
}

/**
 * Stream the workbook, holding nothing the visitor does not keep.
 *
 * Sheets the caller does not want are still iterated rather than skipped: the
 * reader shares one zip stream across all of them, and abandoning a worksheet
 * mid-parse is not a behaviour ExcelJS documents.
 */
async function streamXlsx(input: ResolvedInput, visit: VisitRow): Promise<number> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(toStream(input), {
    worksheets: "emit",
    sharedStrings: "cache",
    // Needed for `cell.numFmt`, the only way to tell a stored 0.18 from an 18.
    styles: "cache",
    entries: "ignore",
  });

  let sheetNo = 0;
  for await (const rawWorksheet of reader) {
    sheetNo += 1;
    const worksheet = rawWorksheet as unknown as NamedWorksheetReader;
    const name = worksheet.name ?? `Sheet${sheetNo}`;
    for await (const rawRow of worksheet) {
      const row = rawRow as unknown as ExcelJSRow;
      visit(name, row.number - 1, rowToCells(row));
    }
  }
  return sheetNo;
}

/** The whole workbook in memory. Correct, and bounded by the upload size cap. */
async function bufferXlsx(input: ResolvedInput, visit: VisitRow): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const source = toStream(input);
  if (typeof source === "string") await workbook.xlsx.readFile(source);
  else await workbook.xlsx.read(source);

  workbook.eachSheet((worksheet) => {
    worksheet.eachRow({ includeEmpty: false }, (rawRow) => {
      const row = rawRow as unknown as ExcelJSRow;
      visit(worksheet.name, row.number - 1, rowToCells(row));
    });
  });
}

/**
 * Read an .xlsx: stream it if ExcelJS can, buffer it when it cannot.
 *
 * The streaming reader is the one we want - memory stays flat and the row
 * ceiling can abort mid-file - but ExcelJS 4.4.0 cannot be relied on to
 * finish. Measured on this workbook set, `stream.xlsx.WorkbookReader` failed
 * 16 times in 20 with "Cannot read properties of undefined (reading 'sheets')".
 *
 * The cause is its deferral path, and it is not a race we introduced. When a
 * worksheet entry arrives before `xl/sharedStrings.xml` (which is where every
 * writer puts it - Excel's own included), the reader spools that worksheet to a
 * temp file and processes it after the zip. Piping the unzipper entry into that
 * temp file truncates the entry stream: reduced to just that pipe, the reader
 * saw 8 of the workbook's 16 zip entries on 7 runs out of 10, and
 * `xl/workbook.xml` - which ExcelJS's own writer places last - was among the
 * ones it lost. `this.model` is then undefined when the deferred worksheet is
 * finally read.
 *
 * So: try the stream, and fall back to the buffered reader, which failed 0
 * times in 20 on the same files. The fallback re-reads from the start, which
 * is why the sink can be reset. Upload size is capped by the route, so the
 * memory cost is bounded even when the fallback is what runs.
 */
async function readXlsx(input: ResolvedInput, sink: RowSink): Promise<void> {
  try {
    const sheetsSeen = await streamXlsx(input, sink.visit);
    if (sheetsSeen > 0) return;
  } catch {
    // Fall through. A genuinely corrupt file fails the buffered read too, and
    // that is the failure the user gets told about.
  }
  sink.reset();
  await bufferXlsx(input, sink.visit);
}

/**
 * ExcelJS's CSV reader coerces on the way in: `Number()` first, then a date
 * list that includes MM-DD-YYYY. Both are wrong here - `Number("0801")` loses
 * an HSN code, and month-first is the one reading an Indian sheet never means.
 * The identity map hands every field over as text so `normalizeCell` makes the
 * same decisions it makes for .xlsx.
 */
async function readCsv(input: ResolvedInput, sink: RowSink): Promise<void> {
  const visit = sink.visit;
  const workbook = new ExcelJS.Workbook();
  const source = toStream(input);
  const name = input.fileName.replace(/\.[a-z0-9]+$/i, "") || "Sheet1";
  const options = { sheetName: name, map: (value: unknown) => value };

  const worksheet =
    typeof source === "string"
      ? await workbook.csv.readFile(source, options)
      : await workbook.csv.read(source, options);

  worksheet.eachRow({ includeEmpty: false }, (rawRow) => {
    const row = rawRow as unknown as ExcelJSRow;
    visit(name, row.number - 1, rowToCells(row));
  });
}

async function readWorkbook(input: ResolvedInput, sink: RowSink): Promise<void> {
  const format = await detectFormat(input);
  try {
    if (format === "csv") await readCsv(input, sink);
    else await readXlsx(input, sink);
  } catch (error) {
    if (error instanceof ExcelParseError) throw error;
    throw new ExcelParseError(
      "UNREADABLE_FILE",
      `${describe(input)} could not be opened. It may be corrupt, password-protected, or not finished uploading. Try opening it in Excel and saving a fresh copy.`,
      error
    );
  }
}

// ---------------------------------------------------------------------------
// Sheet listing
// ---------------------------------------------------------------------------

interface SheetAccumulator {
  name: string;
  /** The first rows, sparse by absolute index, kept only to find the header. */
  head: Array<CellValue[] | undefined>;
  populatedRows: number;
  populatedCells: number;
}

function summarise(accumulator: SheetAccumulator): SheetScan {
  const dense: CellValue[][] = [];
  for (let i = 0; i < accumulator.head.length; i += 1) dense[i] = accumulator.head[i] ?? [];

  const headerRowIndex = detectHeaderRow(dense);
  const headerRow = accumulator.head[headerRowIndex] ?? [];
  const width = headerRow.reduce<number>(
    (max, value, i) => (value === null || value === "" ? max : i + 1),
    0
  );
  const headers = headerRowToStrings(headerRow, width);

  let headRowsUpToHeader = 0;
  for (let i = 0; i <= headerRowIndex && i < accumulator.head.length; i += 1) {
    const row = accumulator.head[i];
    if (row && !isBlankRow(row)) headRowsUpToHeader += 1;
  }

  return {
    summary: {
      name: accumulator.name,
      // Data rows: populated rows below the header. A sheet picker that counts
      // the preamble reports "3 rows" for an empty sheet with a title on it.
      rowCount: Math.max(0, accumulator.populatedRows - headRowsUpToHeader),
      columnCount: headers.filter((h) => h !== "").length,
    },
    headerRowIndex,
    headers,
    populatedCells: accumulator.populatedCells,
  };
}

/**
 * Every sheet in the workbook, with the statistics that pick a default.
 *
 * Memory stays flat: only the first `SCAN_BUFFER_ROWS` of each sheet are held,
 * and everything after that is counted as it streams past.
 */
export async function scanSheets(
  source: SpreadsheetSource,
  fileName?: string
): Promise<SheetScan[]> {
  const input = resolveInput(source, fileName);
  const order: string[] = [];
  const sheets = new Map<string, SheetAccumulator>();

  await readWorkbook(input, {
    reset: () => {
      order.length = 0;
      sheets.clear();
    },
    visit: (sheetName, rowIndex, cells) => {
      let accumulator = sheets.get(sheetName);
      if (!accumulator) {
        accumulator = { name: sheetName, head: [], populatedRows: 0, populatedCells: 0 };
        sheets.set(sheetName, accumulator);
        order.push(sheetName);
      }

      if (rowIndex < SCAN_BUFFER_ROWS) accumulator.head[rowIndex] = cells;
      if (isBlankRow(cells)) return;

      accumulator.populatedRows += 1;
      accumulator.populatedCells += cells.filter((v) => v !== null && v !== "").length;
    },
  });

  if (order.length === 0) {
    throw new ExcelParseError("EMPTY_WORKBOOK", `${describe(input)} has no worksheets in it.`);
  }

  return order.map((name) => summarise(sheets.get(name) as SheetAccumulator));
}

export async function listSheets(
  source: SpreadsheetSource,
  fileName?: string
): Promise<SheetSummary[]> {
  return (await scanSheets(source, fileName)).map((scan) => scan.summary);
}

/**
 * The sheet to open first.
 *
 * By populated cells, not by position. Workbooks routinely lead with a cover
 * sheet, a "Read Me" or a pivot, and their rule "make sure all your data is in
 * the first sheet" exists because their parser cannot tell. Ties go to the
 * earlier sheet, so a workbook with one real tab behaves predictably.
 */
export function pickDefaultSheet(scans: SheetScan[]): SheetScan | null {
  let best: SheetScan | null = null;
  for (const scan of scans) {
    if (!best || scan.populatedCells > best.populatedCells) best = scan;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Parsing one sheet
// ---------------------------------------------------------------------------

function rowLimitError(limit: number, seen: number | null): ExcelParseError {
  const shown = limit.toLocaleString("en-IN");
  const count = seen === null ? `more than ${shown}` : seen.toLocaleString("en-IN");
  return new ExcelParseError(
    "ROW_LIMIT_EXCEEDED",
    `This sheet has ${count} rows of data, above the ${shown}-row limit for one upload. Split it into several files and upload them one after another; there is no limit on how many uploads you make.`
  );
}

/**
 * Read one sheet into the shape the mapper consumes.
 *
 * `droppedRowIndexes` holds **absolute sheet row indexes** - the same
 * coordinate space as `headerRowIndex`, not offsets into `rows`. A dropped row
 * is by definition not in `rows`, and "we ignored sheet row 245" is the only
 * version of that sentence a user can check against the file in front of them.
 */
export async function parseSheet(
  source: SpreadsheetSource,
  opts: ParseSheetOptions = {}
): Promise<ParsedSheet> {
  const input = resolveInput(source, opts.fileName);
  const maxRows = opts.maxRows ?? MAX_ROWS;

  let sheetName = opts.sheetName;
  if (!sheetName) {
    const chosen = pickDefaultSheet(await scanSheets(input));
    if (!chosen) {
      throw new ExcelParseError("EMPTY_WORKBOOK", `${describe(input)} has no worksheets in it.`);
    }
    sheetName = chosen.summary.name;
  }

  const rowsByIndex = new Map<number, CellValue[]>();
  const seenSheets: string[] = [];
  let lastRowIndex = -1;
  let populatedRows = 0;
  let overflowed = false;

  await readWorkbook(input, {
    reset: () => {
      rowsByIndex.clear();
      seenSheets.length = 0;
      lastRowIndex = -1;
      populatedRows = 0;
      overflowed = false;
    },
    visit: (name, rowIndex, cells) => {
      if (!seenSheets.includes(name)) seenSheets.push(name);
      if (name !== sheetName || overflowed) return;

      lastRowIndex = Math.max(lastRowIndex, rowIndex);
      if (isBlankRow(cells)) return;

      populatedRows += 1;
      // Stop buffering the moment the ceiling becomes impossible to meet. The
      // header may sit up to HEADER_SCAN_ROWS down, so that slack is allowed for.
      if (populatedRows > maxRows + HEADER_SCAN_ROWS) {
        overflowed = true;
        return;
      }
      rowsByIndex.set(rowIndex, cells);
    },
  });

  if (!seenSheets.includes(sheetName)) {
    throw new ExcelParseError(
      "SHEET_NOT_FOUND",
      `${describe(input)} has no sheet called "${sheetName}". It has ${seenSheets.map((s) => `"${s}"`).join(", ")}.`
    );
  }
  if (overflowed) throw rowLimitError(maxRows, null);
  if (rowsByIndex.size === 0) {
    throw new ExcelParseError(
      "NO_DATA_ROWS",
      `Sheet "${sheetName}" is empty. Pick a different sheet, or check that the data is not hidden or filtered out.`
    );
  }

  const totalRowsScanned = lastRowIndex + 1;

  const scanWindow: CellValue[][] = [];
  for (let i = 0; i < Math.min(totalRowsScanned, HEADER_SCAN_ROWS); i += 1) {
    scanWindow[i] = rowsByIndex.get(i) ?? [];
  }
  const headerRowIndex = opts.headerRowIndex ?? detectHeaderRow(scanWindow);

  const dataIndexes = Array.from(rowsByIndex.keys())
    .filter((i) => i > headerRowIndex)
    .sort((a, b) => a - b);
  if (dataIndexes.length > maxRows) throw rowLimitError(maxRows, dataIndexes.length);

  // One width for headers and rows alike. A row wider than its header is real -
  // an unlabelled extra column - and truncating it would lose data silently.
  const headerRow = rowsByIndex.get(headerRowIndex) ?? [];
  const width = dataIndexes.reduce<number>(
    (max, i) => Math.max(max, (rowsByIndex.get(i) as CellValue[]).length),
    headerRow.length
  );
  const headers = headerRowToStrings(headerRow, width);

  const rows: CellValue[][] = dataIndexes.map((i) => {
    const padded = (rowsByIndex.get(i) as CellValue[]).slice();
    for (let c = 0; c < width; c += 1) if (padded[c] === undefined) padded[c] = null;
    return padded;
  });

  const dropped = new Set<number>();

  // Blank rows inside the body are separators worth reporting. Blank rows after
  // the last populated one are the used-range padding their FAQ tells users to
  // delete with CTRL-minus; those are trimmed without comment.
  const lastDataIndex =
    dataIndexes.length > 0 ? dataIndexes[dataIndexes.length - 1] : headerRowIndex;
  for (let i = headerRowIndex + 1; i < lastDataIndex; i += 1) {
    if (!rowsByIndex.has(i)) dropped.add(i);
  }

  const grandTotals = opts.dropGrandTotalRows === false ? [] : detectGrandTotalRows(rows, headers);
  for (const offset of grandTotals) dropped.add(dataIndexes[offset]);

  const grandTotalOffsets = new Set(grandTotals);
  const keptRows = rows.filter((_, offset) => !grandTotalOffsets.has(offset));

  return {
    sheetName,
    headerRowIndex,
    headers,
    rows: keptRows,
    droppedRowIndexes: Array.from(dropped).sort((a, b) => a - b),
    totalRowsScanned,
  };
}
