/**
 * Generate TallyPrime-compatible XML for ledger masters + vouchers.
 * Import via Gateway of Tally → Import Data → XML.
 */

type ExportLedger = {
  name: string;
  group: string;
  gstin?: string | null;
};

type ExportLine = {
  ledgerName: string;
  debit: number;
  credit: number;
};

type ExportVoucher = {
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

function ledgerXml(l: ExportLedger) {
  const parent = TALLY_GROUP[l.group] || l.group.replaceAll("_", " ");
  return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <LEDGER NAME="${esc(l.name)}" ACTION="Create">
          <NAME.LIST>
            <NAME>${esc(l.name)}</NAME>
          </NAME.LIST>
          <PARENT>${esc(parent)}</PARENT>
          ${l.gstin ? `<PARTYGSTIN>${esc(l.gstin)}</PARTYGSTIN>` : ""}
          <ISBILLWISEON>No</ISBILLWISEON>
        </LEDGER>
      </TALLYMESSAGE>`;
}

function voucherXml(v: ExportVoucher, idx: number) {
  const vtype = TALLY_VOUCHER[v.voucherType] || "Journal";
  const entries = v.lines
    .filter((l) => l.debit > 0 || l.credit > 0)
    .map((l) => {
      if (l.debit > 0) {
        return `
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${esc(l.ledgerName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
              <AMOUNT>-${l.debit.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
      }
      return `
            <ALLLEDGERENTRIES.LIST>
              <LEDGERNAME>${esc(l.ledgerName)}</LEDGERNAME>
              <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
              <AMOUNT>${l.credit.toFixed(2)}</AMOUNT>
            </ALLLEDGERENTRIES.LIST>`;
    })
    .join("");

  const narr =
    v.narration ||
    [v.partyName, v.invoiceNumber ? `Inv ${v.invoiceNumber}` : null].filter(Boolean).join(" / ");

  return `
      <TALLYMESSAGE xmlns:UDF="TallyUDF">
        <VOUCHER REMOTEID="RAO-${idx}-${tallyDate(v.date)}" VCHTYPE="${esc(vtype)}" ACTION="Create">
          <DATE>${tallyDate(v.date)}</DATE>
          <NARRATION>${esc(narr || "Imported from RAO AI")}</NARRATION>
          <VOUCHERTYPENAME>${esc(vtype)}</VOUCHERTYPENAME>
          <VOUCHERNUMBER>${esc(v.invoiceNumber || `RAO-${idx + 1}`)}</VOUCHERNUMBER>
          ${entries}
        </VOUCHER>
      </TALLYMESSAGE>`;
}

export function buildTallyXml(opts: {
  companyName?: string | null;
  ledgers: ExportLedger[];
  vouchers: ExportVoucher[];
}) {
  const uniqueLedgers = new Map<string, ExportLedger>();
  for (const l of opts.ledgers) {
    if (l.name) uniqueLedgers.set(l.name, l);
  }

  const ledgerBlock = [...uniqueLedgers.values()].map(ledgerXml).join("");
  const voucherBlock = opts.vouchers.map((v, i) => voucherXml(v, i)).join("");

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
          <SVCURRENTCOMPANY>${esc(opts.companyName || "RAO AI Import")}</SVCURRENTCOMPANY>
        </STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>
${ledgerBlock}
${voucherBlock}
      </REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>
`;
}
