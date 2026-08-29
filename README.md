# Rao-Tech

Documents in, double-entry vouchers out, posted straight into the firm's own
TallyPrime.

A CA firm gets a client's paperwork in whatever shape the client had it: a
folder of scanned bills, a purchase register in Excel that someone built by
hand, a bank statement PDF. Turning that into vouchers is the firm's actual
month, and it is nearly all retyping. This does the retyping.

## What it does

- **Scanned bills → vouchers.** OCR reads the bill; the app resolves the party,
  the expense head and each tax component into real ledgers, and builds a
  balanced voucher you approve.
- **Spreadsheets → vouchers.** Point it at a purchase or sales register in any
  shape. It finds the header row, works out whether tax is in one column or one
  column per rate, maps the columns, and commits the rows that reconcile.
- **Bank statements → Payment / Receipt / Contra.** An auditable rule list plus
  a memory of what you chose last month, with the bank side bound once per
  statement rather than per row.
- **Bulk master upload.** A chart of accounts or an item list as a spreadsheet,
  mapped and reviewed before anything is written.
- **Stock, where the client keeps it.** An item line becomes a real inventory
  allocation so the quantities in Tally move with the money — switched on by
  having the masters, not by a setting.
- **GSTR-2B reconciliation** against the purchases in the books.
- **Posting into TallyPrime** over its HTTP-XML gateway, through a desktop agent
  that polls outward — the cloud never dials into a client's machine.

Every voucher is addressed in Tally by a stable `RAO-<uuid>` REMOTEID, so a
re-push alters rather than duplicates, and a delete can find what it means to
remove.

## Stack

Next.js 16 (App Router) · React 19 · Prisma 6 / PostgreSQL · Clerk · Tailwind v4
· vitest. The desktop agent is Go, shipped as a single `.exe`.

## Getting started

```bash
npm install
cp .env.example .env.local     # fill in Clerk, Postgres, the OCR backend
npx prisma migrate deploy
npm run dev
```

**→ [TESTING.md](./TESTING.md)** is the real guide: full local setup, how to
connect TallyPrime, and a walkthrough of how to exercise every feature by hand —
including what a wrong result looks like for each one.

## Commands

```bash
npm run dev        # dev server
npm test           # unit tests (no database, no Tally)
npm run lint
npx tsc --noEmit
npm run build
```

## A word on the migrations

They are hand-written and strictly additive. This database is shared with an
older inventory project, so `prisma migrate diff` will cheerfully propose
dropping thirteen tables that belong to it. **Do not run `prisma migrate dev`
against this database.**

## Repository layout

| Path | |
|---|---|
| `src/lib/accounting/` | voucher construction, ledger resolution |
| `src/lib/bank/` | statement classification, the banking rule engine |
| `src/lib/excel/` | spreadsheet parsing, layout detection, column mapping |
| `src/lib/tally/` | Tally XML, the gateway client, the job queue |
| `scripts/` | end-to-end harnesses that drive the real pipeline |
| `../tally-connector/` | the Go desktop agent |
| `../tally-dev-docs/` | Tally XML notes, and the connector protocol contract |
