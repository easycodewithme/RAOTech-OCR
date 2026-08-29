/**
 * Does Tally actually accept a Payment / Receipt / Contra built from a bank
 * statement line? The unit tests prove the double entry is coherent; only Tally
 * can say whether the envelope is one it will take.
 *
 * Posts into RAOTECH and deletes everything it created.
 */
import { buildBankVoucher } from "../src/lib/accounting/buildBankVoucher";
import { buildTallyXml, buildTallyDeleteXml } from "../src/lib/tally/exportXml";
import { pushToTally, type TallyGateway } from "../src/lib/tally/connector";
import type { VoucherType } from "../src/lib/accounting/types";

const gateway: TallyGateway = { host: "localhost", port: 9000, timeoutMs: 30_000 };
const COMPANY = "RAOTECH";
const DATE = new Date("2026-08-01T00:00:00");

const LEDGERS = [
  { name: "RAO Bank A/c", group: "BANK_ACCOUNTS", ledgerType: "BANK" },
  { name: "RAO Rent A/c", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "RAO Elec A/c", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "RAO Cash Box", group: "CASH_IN_HAND", ledgerType: "CASH" },
];

await pushToTally(
  buildTallyXml({ companyName: COMPANY, ledgers: LEDGERS, vouchers: [] }),
  gateway
);

interface Case {
  id: string;
  label: string;
  withdrawal: number;
  deposit: number;
  allocations: { ledgerId: string; ledgerName: string; amount: number }[];
  override?: "CONTRA";
}

const CASES: Case[] = [
  {
    id: "rao-bank-pay-1",
    label: "Payment (withdrawal, single ledger)",
    withdrawal: 5000,
    deposit: 0,
    allocations: [{ ledgerId: "x", ledgerName: "RAO Rent A/c", amount: 5000 }],
  },
  {
    id: "rao-bank-rcpt-1",
    label: "Receipt (deposit, single ledger)",
    withdrawal: 0,
    deposit: 12000,
    allocations: [{ ledgerId: "x", ledgerName: "RAO Rent A/c", amount: 12000 }],
  },
  {
    id: "rao-bank-split-1",
    label: "Payment split across two ledgers",
    withdrawal: 10000,
    deposit: 0,
    allocations: [
      { ledgerId: "x", ledgerName: "RAO Rent A/c", amount: 7000 },
      { ledgerId: "y", ledgerName: "RAO Elec A/c", amount: 3000 },
    ],
  },
  {
    id: "rao-bank-contra-1",
    label: "Contra (bank -> cash)",
    withdrawal: 25000,
    deposit: 0,
    allocations: [{ ledgerId: "z", ledgerName: "RAO Cash Box", amount: 25000 }],
    override: "CONTRA",
  },
];

const posted: { id: string; voucherType: string }[] = [];

for (const c of CASES) {
  const { draft, errors } = buildBankVoucher({
    date: DATE,
    bankLedgerId: "bank",
    bankLedgerName: "RAO Bank A/c",
    withdrawal: c.withdrawal,
    deposit: c.deposit,
    allocations: c.allocations,
    narration: `RAO bank probe — ${c.label}`,
    voucherTypeOverride: c.override,
  });

  if (!draft) {
    console.log(`SKIP    ${c.label}: ${errors.join("; ")}`);
    continue;
  }

  const xml = buildTallyXml({
    companyName: COMPANY,
    ledgers: [],
    vouchers: [
      {
        id: c.id,
        voucherType: draft.voucherType,
        date: draft.date,
        narration: draft.narration,
        invoiceNumber: null,
        partyName: null,
        lines: draft.lines.map((l) => ({
          ledgerName: l.ledgerNameSnapshot ?? "Unknown",
          role: l.role,
          debit: l.debit,
          credit: l.credit,
          hsnCode: l.hsnCode,
          gstRate: l.gstRate,
        })),
      },
    ],
  });

  const r = await pushToTally(xml, gateway);
  const ok = r.errors === 0 && r.exceptions === 0 && r.lineErrors.length === 0;
  if (ok) posted.push({ id: c.id, voucherType: draft.voucherType });
  console.log(
    `${ok ? "ACCEPT" : "REJECT"}  ${draft.voucherType.padEnd(8)} ${c.label.padEnd(38)} ` +
      `c=${r.created} a=${r.altered} exc=${r.exceptions} ${r.lineErrors.join(" | ") || (ok ? "" : "(blank reason)")}`
  );
}

if (posted.length) {
  const del = await pushToTally(
    buildTallyDeleteXml({
      companyName: COMPANY,
      vouchers: posted.map((p) => ({ id: p.id, voucherType: p.voucherType as VoucherType })),
    }),
    gateway
  );
  console.log(`\ncleanup: deleted ${del.deleted} of ${posted.length}`);
}
