import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { validateStatementBalance } from "@/lib/bank/bankVouchers";
import {
  ROW_STATES,
  TXN_SELECT,
  readIds,
  requireStatement,
  serializeTxn,
  syncsForVouchers,
  type BankRowState,
  type SerializedTxn,
} from "../../../_shared";

/**
 * GET /api/bank/statements/{id}/txns
 *
 * Every filter composes with every other. That is the whole point: the way an
 * accountant actually works a statement is "show me the blank rows under ₹500
 * with 'UPI' in the narration", assign one ledger to all of them, save, and
 * move on. Filters that only work one at a time force the same person to do it
 * three hundred times, which is the complaint behind roughly twelve of the
 * competitor's twenty-seven banking articles.
 *
 * Query parameters, all optional:
 *   filter    blank | unsaved | saved | pushed | failed  (comma-separated = OR)
 *   from,to   ISO dates, inclusive
 *   min,max   amount range, against whichever of the two columns is non-zero
 *   q         narration keyword, case-insensitive substring
 *   type      PAYMENT | RECEIPT | CONTRA (comma-separated = OR)
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireStatement(id);
    if ("error" in ctx) return ctx.error;
    const { statement } = ctx;

    const url = new URL(req.url);
    const q = url.searchParams.get("q")?.trim() ?? "";
    const from = parseDate(url.searchParams.get("from"));
    const to = parseDate(url.searchParams.get("to"));
    const min = parseNumber(url.searchParams.get("min"));
    const max = parseNumber(url.searchParams.get("max"));
    const types = readList(url.searchParams.get("type"))
      .map((t) => t.toUpperCase())
      .filter((t): t is "PAYMENT" | "RECEIPT" | "CONTRA" =>
        t === "PAYMENT" || t === "RECEIPT" || t === "CONTRA"
      );
    const states = readList(url.searchParams.get("filter"))
      .map((s) => s.toLowerCase())
      .filter((s): s is BankRowState => (ROW_STATES as string[]).includes(s));

    // Date, narration and type narrow in Postgres; amount and row state are
    // derived and narrow below. Splitting it this way keeps the running-balance
    // walk honest — it always sees the whole statement, in file order, no
    // matter what the user has filtered the grid down to.
    const where: Prisma.BankTxnWhereInput = {
      statementId: statement.id,
      ...(q ? { description: { contains: q, mode: "insensitive" } } : {}),
      ...(from || to
        ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: endOfDay(to) } : {}) } }
        : {}),
      ...(types.length ? { classification: { in: types } } : {}),
    };

    const [matching, all] = await Promise.all([
      prisma.bankTxn.findMany({
        where,
        orderBy: { sortOrder: "asc" },
        select: TXN_SELECT,
      }),
      prisma.bankTxn.findMany({
        where: { statementId: statement.id },
        orderBy: { sortOrder: "asc" },
        select: TXN_SELECT,
      }),
    ]);

    const voucherIds = [
      ...new Set(all.map((t) => t.voucherId).filter((v): v is string => !!v)),
    ];
    const syncs = await syncsForVouchers(voucherIds);

    const everyRow = all.map((t) => serializeTxn(t, syncs));
    const counts = countStates(everyRow);

    let rows = matching.map((t) => serializeTxn(t, syncs));
    if (min != null || max != null) {
      rows = rows.filter((r) => {
        const amount = r.withdrawal > 0 ? r.withdrawal : r.deposit;
        if (min != null && amount < min) return false;
        if (max != null && amount > max) return false;
        return true;
      });
    }
    if (states.length) rows = rows.filter((r) => states.includes(r.state));

    /**
     * The reconciliation is recomputed on every read rather than trusted from
     * `BankStatement.balanceOk`.
     *
     * Rows are editable — date and narration inline, amounts never, but a row
     * can be deleted — so a check stored at import time goes stale the moment
     * anyone touches the statement. It costs one pass over a few hundred rows.
     */
    const balance = validateStatementBalance(
      all.map((t) => ({
        id: t.id,
        date: t.date,
        description: t.description,
        withdrawal: t.withdrawal,
        deposit: t.deposit,
        balance: t.balance,
      })),
      statement.openingBalance,
      statement.closingBalance
    );

    // Scoped to the workspace, so a stale `bankLedgerId` left behind by a
    // deleted ledger reads back as "not set" rather than as somebody else's
    // ledger — the N6 "Please Select Bank" failure, caught before the build.
    const bankLedger = statement.bankLedgerId
      ? await prisma.ledger.findFirst({
          where: { id: statement.bankLedgerId, userId: ctx.userId, clientId: ctx.clientId },
          select: { id: true, name: true },
        })
      : null;

    return NextResponse.json({
      statement: {
        ...statement,
        bankLedgerName: bankLedger?.name ?? null,
      },
      balance,
      counts,
      total: all.length,
      txns: rows,
    });
  } catch (error) {
    console.error("[BANK_TXNS_GET]", error);
    return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
  }
}

/**
 * PATCH /api/bank/statements/{id}/txns
 * Body: { updates: [{ id, date?, description?, classification? }] }
 *
 * Date and narration are editable after extraction because bank statements are
 * OCR'd out of PDFs and both are routinely wrong — the competitor ships the
 * same two editors for the same reason
 * (`how-to-change-date-and-edit-narration-in-vyapar-taxone-banking-module.md`).
 * Amounts are deliberately not editable here: an amount that disagrees with the
 * statement is a parse failure the running-balance check is there to catch, and
 * letting a user type over it would hide exactly the error we want surfaced.
 *
 * A row that has already become a voucher is refused. Editing it here would
 * leave our copy and Tally's disagreeing with no way to tell; the documented
 * path is Delete From Tally, then re-assign, then re-send.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ctx = await requireStatement(id);
    if ("error" in ctx) return ctx.error;
    const { statement } = ctx;

    const body = (await req.json().catch(() => ({}))) as {
      updates?: { id?: unknown; date?: unknown; description?: unknown; classification?: unknown }[];
    };
    const updates = Array.isArray(body.updates) ? body.updates : [];
    if (!updates.length) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const ids = readIds(updates.map((u) => u.id));
    const existing = await prisma.bankTxn.findMany({
      where: { id: { in: ids }, statementId: statement.id },
      select: { id: true, voucherId: true },
    });
    const byId = new Map(existing.map((t) => [t.id, t]));

    const blocked: string[] = [];
    const writes: Prisma.PrismaPromise<unknown>[] = [];

    for (const u of updates) {
      const txnId = String(u.id ?? "");
      const row = byId.get(txnId);
      if (!row) continue;
      if (row.voucherId) {
        blocked.push(txnId);
        continue;
      }

      const data: Prisma.BankTxnUpdateInput = {};
      if (u.date !== undefined) {
        const d = parseDate(u.date == null ? null : String(u.date));
        if (u.date === null) data.date = null;
        else if (d) data.date = d;
      }
      if (typeof u.description === "string") {
        const desc = u.description.trim().slice(0, 500);
        if (desc) data.description = desc;
      }
      if (u.classification !== undefined) {
        const c = u.classification == null ? null : String(u.classification).toUpperCase();
        if (c === null) data.classification = null;
        else if (c === "PAYMENT" || c === "RECEIPT" || c === "CONTRA") data.classification = c;
      }
      if (Object.keys(data).length === 0) continue;

      writes.push(prisma.bankTxn.update({ where: { id: txnId }, data }));
    }

    if (writes.length) await prisma.$transaction(writes);

    return NextResponse.json({
      updated: writes.length,
      blocked,
      ...(blocked.length
        ? {
            warning:
              "Rows that have already been built into vouchers were left alone. Delete them from Tally first, then edit and re-send.",
          }
        : {}),
    });
  } catch (error) {
    console.error("[BANK_TXNS_PATCH]", error);
    return NextResponse.json({ error: "Failed to update transactions" }, { status: 500 });
  }
}

/* ------------------------------------------------------------- helpers */

function readList(raw: string | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** An inclusive "to" date means the whole of that day, not midnight on it. */
function endOfDay(d: Date): Date {
  const copy = new Date(d);
  copy.setHours(23, 59, 59, 999);
  return copy;
}

function parseNumber(raw: string | null): number | null {
  if (raw == null || raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function countStates(rows: SerializedTxn[]): Record<BankRowState, number> {
  const counts: Record<BankRowState, number> = {
    blank: 0,
    unsaved: 0,
    saved: 0,
    pushed: 0,
    failed: 0,
  };
  for (const r of rows) counts[r.state] += 1;
  return counts;
}
