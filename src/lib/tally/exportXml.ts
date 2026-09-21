/**
 * Generate TallyPrime-compatible XML for ledger masters + vouchers.
 * Import via Gateway of Tally → Import Data → XML.
 */

import { BILL_WISE_GROUPS } from "../accounting/types";

type ExportLedger = {
  name: string;
  group: string;
  /** Drives the GST duty-head and bill-wise decisions. */
  ledgerType?: string | null;
  /** Combined GST rate (e.g. 18 for an 18% purchase ledger). */
  gstRate?: number | null;
  gstin?: string | null;
};

type ExportLine = {
  ledgerName: string;
  /** PARTY lines carry the bill reference; ITEM lines carry HSN. */
  role?: string | null;
  debit: number;
  credit: number;
  hsnCode?: string | null;
  gstRate?: number | null;

  /**
   * How this line allocates against a bill, decided by the builder that made
   * it, in Tally's own vocabulary: "New Ref" | "Agst Ref" | "Advance" |
   * "On Account".
   *
   * This exists so the emitter reads the line rather than guessing from it.
   * The rule used to be hardcoded here — role PARTY meant New Ref, always —
   * which is right for an invoice and wrong for everything that settles one. A
   * credit note got a new reference instead of cancelling the original; a bank
   * payment never reached this branch at all and posted with no allocation. The
   * builders know which document they are looking at and this layer does not,
   * so the decision moved to them and the shape stayed here.
   *
   * Absent on both fields ⇒ the historical default: a PARTY line opens a New Ref
   * named after the invoice number (or the RAO- fallback), and nothing else
   * carries an allocation at all.
   */
  billRefType?: string | null;
  billRefName?: string | null;

  /**
   * Set only when this line moves stock. The accounting ledger above then
   * appears *inside* the inventory entry rather than beside it.
   */
  stockItemName?: string | null;
  quantity?: number | null;
  unit?: string | null;
  rate?: number | null;
};

export type ExportStockItem = {
  name: string;
  /** Tally rejects a stock item naming a unit that does not exist yet. */
  unit?: string | null;
  hsnCode?: string | null;
  gstRate?: number | null;
  alias?: string | null;
};

type ExportVoucher = {
  /** Our voucher UUID. Becomes REMOTEID, which is how Tally recognises a
   *  re-import as the same voucher and alters it instead of duplicating it. */
  id: string;
  voucherType: string;
  date: Date;
  narration?: string | null;
  partyName?: string | null;
  invoiceNumber?: string | null;
  lines: ExportLine[];
};

const TALLY_GROUP: Record<string, string> = {
  SUNDRY_CREDITORS: "Sundry Creditors",
  SUNDRY_DEBTORS: "Sundry Debtors",
  DUTIES_AND_TAXES: "Duties & Taxes",
  PURCHASE_ACCOUNTS: "Purchase Accounts",
  SALES_ACCOUNTS: "Sales Accounts",
  DIRECT_EXPENSES: "Direct Expenses",
  INDIRECT_EXPENSES: "Indirect Expenses",
  INDIRECT_INCOME: "Indirect Incomes",
  BANK_ACCOUNTS: "Bank Accounts",
  CASH_IN_HAND: "Cash-in-Hand",
  CURRENT_ASSETS: "Current Assets",
  CURRENT_LIABILITIES: "Current Liabilities",
  FIXED_ASSETS: "Fixed Assets",
};

const TALLY_VOUCHER: Record<string, string> = {
  PURCHASE: "Purchase",
  SALE: "Sales",
  JOURNAL: "Journal",
  CREDIT_NOTE: "Credit Note",
  DEBIT_NOTE: "Debit Note",
  PAYMENT: "Payment",
  RECEIPT: "Receipt",
  CONTRA: "Contra",
};

/** Ledger types whose GST rate belongs on the master. */
const RATED_LEDGER_TYPES = new Set(["PURCHASE", "SALE", "EXPENSE", "INCOME"]);

/** Tally's duty-head names, inferred from the tax ledger's own name. */
function gstDutyHead(ledgerName: string): string | null {
  const n = ledgerName.toUpperCase();
  if (n.startsWith("CGST")) return "Central Tax";
  if (n.startsWith("SGST")) return "State Tax";
  if (n.startsWith("IGST")) return "Integrated Tax";
  if (n.startsWith("CESS")) return "Cess";
  return null;
}

/**
 * Tally matches ledgers and company names by exact string. Leading/trailing
 * whitespace is one of the most-cited import failures ("Extra space in the name
 * of ledgers or company name"), and it is invisible in the UI, so every
 * identifier is trimmed on the way out.
 *
 * Internal runs of whitespace are deliberately left alone — collapsing them
 * would rewrite a name that may legitimately exist that way in Tally. Preflight
 * warns about those instead.
 */
function name(s: string) {
  return s.trim();
}

function esc(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function tallyDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

/** Trim a rate to the shortest exact form Tally accepts: 9, 2.5, 0.125. */
function rateStr(n: number) {
  return String(Number(n.toFixed(3)));
}

/**
 * GST configuration on the ledger master.
 *
 * For accounting-only vouchers (no inventory) Tally derives a voucher's GST
 * treatment from its ledgers rather than from the voucher lines, so the rate
 * has to live here. A combined 18% splits 9/9 across Central and State Tax;
 * the integrated head carries the full rate and Tally applies whichever is
 * relevant based on the party's state.
 */
function gstDetailsXml(l: ExportLedger, applicableFrom: string) {
  const rate = l.gstRate;
  if (rate == null || !RATED_LEDGER_TYPES.has(String(l.ledgerType))) return "";
  const half = rateStr(rate / 2);
  const full = rateStr(rate);
  return `
          <GSTDETAILS.LIST>
            <APPLICABLEFROM>${applicableFrom}</APPLICABLEFROM>
            <TAXABILITY>Taxable</TAXABILITY>
            <GSTRATEDUTYHEAD.LIST>
              <GSTRATEDUTYHEAD>Central Tax</GSTRATEDUTYHEAD>
              <GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
              <GSTRATE>${half}</GSTRATE>
            </GSTRATEDUTYHEAD.LIST>
            <GSTRATEDUTYHEAD.LIST>
              <GSTRATEDUTYHEAD>State Tax</GSTRATEDUTYHEAD>
              <GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
              <GSTRATE>${half}</GSTRATE>
            </GSTRATEDUTYHEAD.LIST>
            <GSTRATEDUTYHEAD.LIST>
              <GSTRATEDUTYHEAD>Integrated Tax</GSTRATEDUTYHEAD>
              <GSTRATEVALUATIONTYPE>Based on Value</GSTRATEVALUATIONTYPE>
              <GSTRATE>${full}</GSTRATE>
            </GSTRATEDUTYHEAD.LIST>
          </GSTDETAILS.LIST>`;
}

function ledgerXml(
  l: ExportLedger,
  opts: { gstApplicableFrom: string; includeGstDetails: boolean }
) {
  const ledgerName = name(l.name);
  const parent = TALLY_GROUP[l.group] || l.group.replaceAll("_", " ");

  // Party ledgers need bill-wise on, or Tally cannot age an outstanding
  // against the invoice it came from. The same set decides which voucher lines
  // must carry a BILLALLOCATIONS.LIST — see `BILL_WISE_GROUPS` — because a
  // ledger flagged here and a line that names no bill is exactly how an
  // outstanding gets parked On Account and never knocked off.
  const billWise = BILL_WISE_GROUPS.has(l.group);

  const dutyHead = l.group === "DUTIES_AND_TAXES" ? gstDutyHead(ledgerName) : null;
  const dutyBlock = dutyHead
    ? `
          <TAXTYPE>GST</TAXTYPE>
          <GSTDUTYHEAD>${dutyHead}</GSTDUTYHEAD>`
    : "";
  const gstBlock = opts.includeGstDetails
    ? gstDetailsXml(l, opts.gstApplicableFrom)
    : "";

  return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <LEDGER NAME="${esc(ledgerName)}" ACTION="Create">
          <NAME.LIST>
            <NAME>${esc(ledgerName)}</NAME>
          </NAME.LIST>
          <PARENT>${esc(parent)}</PARENT>
          ${l.gstin ? `<PARTYGSTIN>${esc(l.gstin)}</PARTYGSTIN>` : ""}
          <ISBILLWISEON>${billWise ? "Yes" : "No"}</ISBILLWISEON>${dutyBlock}${gstBlock}
        </LEDGER>
      </TALLYMESSAGE>`;
}

/**
 * A simple unit of measure.
 *
 * Units come first in the master order, because a stock item naming a
 * `<BASEUNITS>` Tally does not have is rejected outright. They are cheap and
 * idempotent, so every unit a batch mentions is declared rather than tracked.
 */
function unitXml(unit: string) {
  return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <UNIT NAME="${esc(unit)}" ACTION="Create">
          <NAME>${esc(unit)}</NAME>
          <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
          <DECIMALPLACES>2</DECIMALPLACES>
        </UNIT>
      </TALLYMESSAGE>`;
}

/**
 * A stock item master.
 *
 * Note what is *not* here: `<PARENT>`. A company that has never used inventory
 * has no stock groups at all — not even `Primary`, which exists as a ledger
 * group and does not exist as a stock group — so naming one is rejected with
 * `Stock Group 'Primary' does not exist!`. Omitting the tag lands the item at
 * the root, which is exactly where an empty parent and Tally's own escaped
 * `&#4; Primary` put it, and it is the only form that cannot fail.
 *
 * Getting this right first time matters more than usual: a master create that
 * fails poisons that name for the rest of Tally's session, and every retry
 * replays the original error even after the XML is corrected
 * (connector-protocol.md rule 12).
 */
function stockItemXml(
  item: ExportStockItem,
  opts: { gstApplicableFrom: string; includeGstDetails: boolean }
) {
  const itemName = name(item.name);
  const unit = name(item.unit || "");

  const gstBlock =
    opts.includeGstDetails && (item.gstRate != null || item.hsnCode)
      ? `
          <GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>
          <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>${
            item.hsnCode ? `
          <HSNCODE>${esc(item.hsnCode)}</HSNCODE>` : ""
          }`
      : "";

  return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <STOCKITEM NAME="${esc(itemName)}" ACTION="Create">
          <NAME.LIST>
            <NAME>${esc(itemName)}</NAME>${
              item.alias ? `
            <NAME>${esc(name(item.alias))}</NAME>` : ""
            }
          </NAME.LIST>${unit ? `
          <BASEUNITS>${esc(unit)}</BASEUNITS>` : ""}${gstBlock}
        </STOCKITEM>
      </TALLYMESSAGE>`;
}

/**
 * The REMOTEID we stamp on every voucher, and Tally's idempotency key.
 *
 * Verified against a live instance: re-importing with the same REMOTEID ALTERs
 * the existing voucher, a different one CREATEs a duplicate, and
 * ACTION="Delete" resolves by it. Everything that needs to name a voucher in
 * Tally — re-posting, deleting, VoucherSync.remoteId — must go through here,
 * because a prefix applied in one place and not another silently creates
 * duplicates instead of updates.
 */
export function remoteIdFor(voucherId: string): string {
  return `RAO-${voucherId}`;
}

/**
 * The bill allocation for one ledger entry, read off the line.
 *
 * This used to be a rule rather than data: role PARTY meant `New Ref` named
 * after the invoice, and everything else meant nothing at all. That is right
 * for the one document that *opens* an outstanding and wrong for every document
 * that settles one, and the XML layer is the worst possible place to tell them
 * apart — it can see a role and an amount, not whether it is looking at a sales
 * invoice, a credit note against last month's bill, or a supplier payment. So
 * the decision belongs to the builders and this function only gives it a shape.
 *
 * `amount` is passed in as the already-formatted ledger-entry string, not
 * recomputed: **the allocation amount must equal the ledger entry amount
 * exactly, sign included, or Tally rejects the whole voucher.** Sharing the one
 * string makes that unbreakable rather than merely intended.
 *
 * @param defaultRef  the voucher's own reference — invoice number, or the
 *                    stable `RAO-<id>` fallback — used when a line asks for an
 *                    allocation without naming the bill.
 */
function billAllocationXml(l: ExportLine, amount: string, defaultRef: string) {
  const explicitType = (l.billRefType || "").trim();
  const explicitName = name(l.billRefName || "");

  /**
   * A line that says nothing falls back to exactly what this file did before:
   * PARTY opens a New Ref, everything else carries no allocation. Kept as the
   * default rather than removed because it is still correct for a purchase or a
   * sale, and because a line built before this field existed must keep posting
   * the way it always did.
   */
  const billType = explicitType || (l.role === "PARTY" ? "New Ref" : "");
  if (!billType) return "";

  /**
   * `On Account` names no bill, because there is no bill — that is the whole
   * meaning of it. Tally's own export of an unallocated entry carries an empty
   * `<NAME>`, and putting the voucher's reference there instead would open a
   * brand new outstanding: the precise bug this change exists to remove, one
   * level further down.
   */
  const refName = billType === "On Account" ? "" : explicitName || defaultRef;

  return `
              <BILLALLOCATIONS.LIST>
                <NAME>${esc(refName)}</NAME>
                <BILLTYPE>${esc(billType)}</BILLTYPE>
                <AMOUNT>${amount}</AMOUNT>
              </BILLALLOCATIONS.LIST>`;
}

function voucherXml(v: ExportVoucher, opts: { includeGstDetails: boolean }) {
  const vtype = TALLY_VOUCHER[v.voucherType] || "Journal";

  // The voucher's own bill reference, used when a line asks for an allocation
  // without naming one. Falls back to the stable voucher id so a party balance
  // is never left unreferenced — and stable matters, because a reference that
  // changed between exports would open a second outstanding on re-import.
  const billRef = name(v.invoiceNumber || "") || `RAO-${v.id.slice(0, 8)}`;

  /**
   * Quantities and rates carry their unit inline: Tally wants "10 Nos" and
   * "100/Nos", not "10" and "100". A unitless item still posts, so a sheet that
   * never named a unit is not blocked here.
   */
  const qty = (n: number, unit: string | null | undefined) =>
    unit ? `${n} ${name(unit)}` : String(n);
  const rateOf = (n: number, unit: string | null | undefined) =>
    unit ? `${n.toFixed(2)}/${name(unit)}` : n.toFixed(2);

  /**
   * The lines that move stock, and the trap this whole block exists to avoid.
   *
   * An item line's accounting ledger belongs *inside* its inventory entry as an
   * ACCOUNTINGALLOCATIONS.LIST. Emit it there and also as a sibling
   * ALLLEDGERENTRIES.LIST and Tally accepts the voucher, the books balance, and
   * the purchase account is debited twice — a silent doubling of the client's
   * expense that nothing on our side would ever report. So a line appears in
   * exactly one of the two blocks below, never both.
   */
  const stockLines = v.lines.filter(
    (l) => (l.debit > 0 || l.credit > 0) && !!l.stockItemName
  );

  const inventoryEntries = stockLines
    .map((l) => {
      const isDebit = l.debit > 0;
      const amount = isDebit ? `-${l.debit.toFixed(2)}` : l.credit.toFixed(2);
      const value = isDebit ? l.debit : l.credit;
      const q = l.quantity ?? null;
      // Rate is only meaningful with a quantity, and deriving it from the line
      // total is better than omitting it: Tally shows a zero rate otherwise.
      const r = l.rate ?? (q && q !== 0 ? value / q : null);

      const qtyTags =
        q != null
          ? `
              <ACTUALQTY>${esc(qty(q, l.unit))}</ACTUALQTY>
              <BILLEDQTY>${esc(qty(q, l.unit))}</BILLEDQTY>`
          : "";
      const rateTag =
        r != null
          ? `
              <RATE>${esc(rateOf(r, l.unit))}</RATE>`
          : "";

      return `
            <ALLINVENTORYENTRIES.LIST>
              <STOCKITEMNAME>${esc(name(l.stockItemName || ""))}</STOCKITEMNAME>
              <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>${rateTag}
              <AMOUNT>${amount}</AMOUNT>${qtyTags}
              <ACCOUNTINGALLOCATIONS.LIST>
                <LEDGERNAME>${esc(name(l.ledgerName))}</LEDGERNAME>
                <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
                <AMOUNT>${amount}</AMOUNT>
              </ACCOUNTINGALLOCATIONS.LIST>
            </ALLINVENTORYENTRIES.LIST>`;
    })
    .join("");

  /**
   * Invoice mode or accounting mode — the tag name is what tells Tally which.
   *
   * Measured against TallyPrime: a voucher that carries ALLINVENTORYENTRIES
   * and puts its party and tax lines in ALLLEDGERENTRIES.LIST is refused with
   * errors=0, exceptions=1 and no reason at all, and refused identically
   * whatever else is changed. ALLLEDGERENTRIES is the accounting-voucher form;
   * asking Tally to record an item invoice with it is a contradiction it
   * declines to explain. LEDGERENTRIES.LIST is the invoice form, and posts.
   *
   * Sixteen other shapes were tried against that blank refusal before the tag
   * was: batch and godown allocations, OBJVIEW / PERSISTEDVIEW / ISINVOICE in
   * every combination and in none, INVENTORYENTRIES against
   * ALLINVENTORYENTRIES, PARTYNAME, BASICBUYERNAME, ISPARTYLEDGER, and masters
   * marked GST-not-applicable. Every one was still refused. Swapping this one
   * tag posts with no other change, so none of the rest are emitted.
   *
   * A voucher with no stock keeps ALLLEDGERENTRIES, which is right for it and
   * is what every non-inventory push has been posting with all along.
   */
  const entryTag = stockLines.length > 0 ? "LEDGERENTRIES" : "ALLLEDGERENTRIES";

  const entries = v.lines
    .filter((l) => (l.debit > 0 || l.credit > 0) && !l.stockItemName)
    .map((l) => {
      const isDebit = l.debit > 0;
      // Tally's convention: debits are "deemed positive" and carry a negative
      // amount; credits are the reverse.
      const amount = isDebit ? `-${l.debit.toFixed(2)}` : l.credit.toFixed(2);

      // The allocation amount is `amount` itself, never a re-derivation of it:
      // it must match the ledger entry exactly, sign included, or Tally rejects
      // the voucher. Every branch below shares this one string.
      const billAllocation = billAllocationXml(l, amount, billRef);

      const hsn =
        opts.includeGstDetails && l.role === "ITEM" && l.hsnCode
          ? `
              <HSNCODE>${esc(l.hsnCode)}</HSNCODE>`
          : "";

      return `
            <${entryTag}.LIST>
              <LEDGERNAME>${esc(name(l.ledgerName))}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>${isDebit ? "Yes" : "No"}</ISDEEMEDPOSITIVE>
              <AMOUNT>${amount}</AMOUNT>${hsn}${billAllocation}
            </${entryTag}.LIST>`;
    })
    .join("");

  const narr =
    v.narration ||
    [v.partyName, v.invoiceNumber ? `Inv ${v.invoiceNumber}` : null].filter(Boolean).join(" / ");

  // Derived from the voucher id, not the batch position — a positional
  // fallback made the same voucher show a different number on each re-export.
  const voucherNumber = name(v.invoiceNumber || "") || `RAO-${v.id.slice(0, 8)}`;

  const partyTag = v.partyName
    ? `
          <PARTYLEDGERNAME>${esc(name(v.partyName))}</PARTYLEDGERNAME>`
    : "";

  return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER REMOTEID="${esc(remoteIdFor(v.id))}" VCHTYPE="${esc(vtype)}" ACTION="Create">
          <DATE>${tallyDate(v.date)}</DATE>
          <NARRATION>${esc(narr || "Imported from RAO AI")}</NARRATION>
          <VOUCHERTYPENAME>${esc(vtype)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${esc(voucherNumber)}</VOUCHERNUMBER>${partyTag}
          ${inventoryEntries}${entries}
        </VOUCHER>
      </TALLYMESSAGE>`;
}

export function buildTallyXml(opts: {
  companyName?: string | null;
  ledgers: ExportLedger[];
  /**
   * Stock item masters to create before the vouchers that name them. Tally
   * will not invent one, exactly as with ledgers.
   */
  stockItems?: ExportStockItem[];
  vouchers: ExportVoucher[];
  /** GST rate effective-from date, YYYYMMDD. Defaults to 1 July 2017. */
  gstApplicableFrom?: string;
  /**
   * Emit GST rate details on masters and HSN on item lines. On by default.
   * Tally's statutory schema shifts between releases — if a real import
   * rejects the GSTDETAILS block, turn this off to fall back to plain
   * accounting vouchers while the shape is corrected.
   */
  includeGstDetails?: boolean;
}) {
  const includeGstDetails = opts.includeGstDetails ?? true;
  const gstApplicableFrom = opts.gstApplicableFrom ?? "20170701";

  // Keyed on the trimmed name so "Acme " and "Acme" collapse to one master
  // rather than being pushed as two.
  const uniqueLedgers = new Map<string, ExportLedger>();
  for (const l of opts.ledgers) {
    const key = name(l.name || "");
    if (key) uniqueLedgers.set(key, l);
  }

  const ledgerBlock = [...uniqueLedgers.values()]
    .map((l) => ledgerXml(l, { gstApplicableFrom, includeGstDetails }))
    .join("");

  const uniqueItems = new Map<string, ExportStockItem>();
  for (const i of opts.stockItems ?? []) {
    const key = name(i.name || "");
    if (key) uniqueItems.set(key, i);
  }

  /**
   * Every unit any of them mentions, declared first.
   *
   * Order is load-bearing: a stock item naming a `<BASEUNITS>` Tally does not
   * have is rejected, and that rejection then poisons the item name for the
   * rest of the session. Units are idempotent and cost one line each, so they
   * are re-declared every time rather than tracked.
   */
  const units = new Set<string>();
  for (const i of uniqueItems.values()) {
    const u = name(i.unit || "");
    if (u) units.add(u);
  }
  for (const v of opts.vouchers) {
    for (const l of v.lines) {
      const u = name(l.unit || "");
      if (u && l.stockItemName) units.add(u);
    }
  }

  const unitBlock = [...units].map(unitXml).join("");
  const stockItemBlock = [...uniqueItems.values()]
    .map((i) => stockItemXml(i, { gstApplicableFrom, includeGstDetails }))
    .join("");
  const voucherBlock = opts.vouchers
    .map((v) => voucherXml(v, { includeGstDetails }))
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(name(opts.companyName || "RAO AI Import"))}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${unitBlock}
${ledgerBlock}
${stockItemBlock}
${voucherBlock}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}

/**
 * Build a "remove these vouchers from Tally" envelope.
 *
 * Deleting needs only the REMOTEID and the voucher type — Tally resolves the
 * target by REMOTEID and ignores the body, which matters because by the time a
 * user asks to un-post something they may well have edited the voucher here.
 * Reconstructing its lines to delete it would mean the delete depended on data
 * that no longer matches what is in Tally.
 *
 * Scoped by construction: only vouchers we posted carry a RAO- REMOTEID, so
 * this cannot reach an entry the accountant keyed in by hand.
 */
export function buildTallyDeleteXml(opts: {
  companyName?: string | null;
  vouchers: Array<{ id: string; voucherType: string }>;
}) {
  const messages = opts.vouchers
    .map((v) => {
      const vtype = TALLY_VOUCHER[v.voucherType] || "Journal";
      return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER REMOTEID="${esc(remoteIdFor(v.id))}" VCHTYPE="${esc(vtype)}" ACTION="Delete" />
      </TALLYMESSAGE>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<ENVELOPE>
  <HEADER>
    <TALLYREQUEST>Import Data</TALLYREQUEST>
  </HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES>
          <SVCURRENTCOMPANY>${esc(name(opts.companyName || "RAO AI Import"))}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${messages}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;
}
