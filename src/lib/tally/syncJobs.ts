import type { Prisma, PrismaClient, SyncJob } from "@prisma/client";
import { buildTallyDeleteXml, buildTallyXml, remoteIdFor } from "./exportXml";
import {
  preflightVouchers,
  type PreflightCode,
  type PreflightVoucher,
} from "./preflight";
import { applyMasterPull, type TallyCompanyRecord, type TallyLedgerRecord } from "./masterSync";

/**
 * The queue the desktop connector drains, and what the cloud does with what
 * comes back.
 *
 * The cloud builds every byte of XML. The connector POSTs it to Tally on
 * localhost and reports the reply — it holds no accounting logic and never
 * composes an envelope, so there is exactly one XML implementation and it is
 * unit-tested here rather than on an accountant's desktop.
 */

export type SyncJobKind =
  | "MASTER_PULL"
  | "MASTER_CREATE"
  | "VOUCHER_PUSH"
  | "VOUCHER_DELETE"
  | "PING";

/** Mirrors `internal/tally.ImportResult` on the Go side, field for field. */
export interface TallyCounters {
  created?: number;
  altered?: number;
  deleted?: number;
  ignored?: number;
  combined?: number;
  cancelled?: number;
  errors?: number;
  exceptions?: number;
  /**
   * Tally's internal id for the last voucher written.
   *
   * Typed loosely because it arrives from a connector over JSON and the
   * connectors disagree: the Go agent sends an int, the reference connector
   * passes through the parser's string. `toTallyId` below is the one place that
   * has to care.
   */
  lastVchId?: number | string | null;
  lastMId?: number | string | null;
  lineErrors?: string[];
}

export interface VoucherResultEntry {
  voucherId: string;
  ok?: boolean;
  tally?: TallyCounters | null;
  error?: string | null;
}

export interface JobResultBody {
  ok?: boolean;
  durationMs?: number;
  error?: string | null;
  companies?: TallyCompanyRecord[] | null;
  ledgers?: TallyLedgerRecord[] | null;
  ledgerIds?: string[] | null;
  tally?: TallyCounters | null;
  results?: VoucherResultEntry[] | null;
}

/**
 * Measured against a live TallyPrime 7.1: a rejected voucher comes back as
 * `EXCEPTIONS`, never as `ERRORS`. `ERRORS` counts malformed XML, which the
 * cloud does not produce. Testing `errors === 0` alone therefore reports every
 * single business rejection — missing ledger, date out of range, unbalanced —
 * as a success, and the user watches a voucher turn green that is not in the
 * books.
 */
/**
 * A Tally id as the `Int?` columns want it.
 *
 * This is not defensive coding for its own sake. A connector sending `"75"`
 * where the column is an Int made `applyJobResult` throw, the result endpoint
 * answer 500, and the job stay unrecorded — while all five vouchers were
 * already sitting in the client's books. That gap is precisely how a voucher
 * becomes an orphan: posted in Tally, unknown to us, and addressable only by a
 * REMOTEID we can no longer look up.
 */
export function toTallyId(v: number | string | null | undefined): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isTallySuccess(t: TallyCounters | null | undefined): boolean {
  if (!t) return false;
  return (
    (t.errors ?? 0) === 0 &&
    (t.exceptions ?? 0) === 0 &&
    (t.lineErrors?.length ?? 0) === 0
  );
}

/**
 * Tally rejects an unbalanced voucher, and every voucher in education mode,
 * with an *empty* reason. Both are pre-flighted, so seeing one here means the
 * pre-flight was bypassed or the licence lapsed between check and push. Storing
 * "" would render as a blank red row with nothing to act on.
 */
export const BLANK_REJECTION_REASON =
  "Tally rejected this voucher without giving a reason. Measured against TallyPrime 7.1 that means one of three things: the voucher's debits and credits do not agree; Tally is running in education mode, which only accepts vouchers dated the 1st, 2nd or last day of a month; or the voucher moves stock and the company has inventory switched off (F11 -> Inventory Features -> Maintain Stock).";

/**
 * The same thing, narrowed when we know the voucher carried stock.
 *
 * Worth splitting out because the third cause is the only one the user can fix
 * in ten seconds, and it is invisible from Tally's side: the same company
 * accepts stock item masters happily and then refuses every voucher that names
 * one, with no reason given. Telling someone to check their debits when the
 * real answer is a checkbox in F11 wastes an afternoon.
 */
export const BLANK_REJECTION_REASON_INVENTORY =
  "Tally rejected this voucher without giving a reason, and it moves stock. The most likely cause by far is that this company has inventory switched off — in TallyPrime, F11 -> Inventory Features -> Maintain Stock. A company running \"Maintain Accounts Only\" accepts stock item masters and then silently refuses every voucher that uses one. Failing that, check the voucher balances and that Tally is not in education mode.";

export function rejectionReason(
  entry: VoucherResultEntry | null | undefined,
  transportError?: string | null,
  /** True when the voucher carried an inventory allocation. */
  movesStock = false
): string {
  const fromLine = entry?.tally?.lineErrors?.find((s) => s && s.trim());
  if (fromLine) return fromLine.trim();
  if (entry?.error && entry.error.trim()) return entry.error.trim();
  if (transportError && transportError.trim()) return transportError.trim();
  return movesStock ? BLANK_REJECTION_REASON_INVENTORY : BLANK_REJECTION_REASON;
}

/** Education mode is the one blank-reason cause worth flagging on the company. */
export function looksLikeEducationMode(t: TallyCounters | null | undefined): boolean {
  return !!t?.lineErrors?.some((s) => /educational|education mode/i.test(s ?? ""));
}

/**
 * Tally's own words for "there is nothing here to delete".
 *
 * Measured: deleting a REMOTEID that was never posted answers
 * `deleted=0 errors=1 exceptions=0` with this line error — note `errors`, not
 * `exceptions`, which is the one rejection shape that breaks the usual rule.
 * It is treated as success, because the voucher being absent from Tally is
 * exactly the state the user asked for. Failing it instead leaves a red row
 * that no amount of retrying can ever clear, which is the normal outcome of a
 * retried delete or of an accountant who removed the entry by hand first.
 */
const ALREADY_ABSENT = /voucher does not exist/i;

export function isAlreadyAbsent(t: TallyCounters | null | undefined): boolean {
  return !!t?.lineErrors?.some((s) => ALREADY_ABSENT.test(s ?? ""));
}

/**
 * `preflight.ts` codes plus the one this module adds. It lives here rather than
 * in `preflight.ts` because the check only makes sense against a live Tally:
 * a file export has nobody to complain to, but a connector push writes straight
 * into the real books.
 */
export type PushPreflightCode = PreflightCode | "DATE_FAR_FUTURE";

export interface PushPreflightIssue {
  voucherId: string;
  code: PushPreflightCode;
  severity: "error" | "warning";
  message: string;
}

/** A year of headroom: annual accruals are legitimate, a typo'd year is not. */
const FAR_FUTURE_MS = 366 * 24 * 60 * 60 * 1000;

/**
 * Pre-flight for a connector push.
 *
 * Only `bookBeginning` is enforced, and it is taken from `booksFrom`. Measured
 * against a live TallyPrime 7.1: Tally rejects dates *before* books-beginning
 * with "The date … is Out of Range!" and applies no upper bound at all — a
 * voucher dated two financial years ahead posted cleanly. Passing Tally's
 * reported `EndingAt` as `bookEnding` would be actively harmful, because a real
 * company reported StartingFrom = EndingAt = BooksFrom, and preflight would then
 * reject every voucher dated after books-beginning, today's included.
 *
 * The flip side of Tally having no upper bound is that a mistyped year posts
 * silently into the real books, so that is caught here as a *warning* — visible,
 * never blocking, because a genuine forward-dated voucher must still go through.
 */
export function preflightForPush(
  vouchers: PreflightVoucher[],
  opts: { booksFrom?: Date | null; now?: Date } = {}
): PushPreflightIssue[] {
  const issues: PushPreflightIssue[] = preflightVouchers(vouchers, {
    bookBeginning: opts.booksFrom ?? undefined,
  });

  const horizon = (opts.now ?? new Date()).getTime() + FAR_FUTURE_MS;
  for (const v of vouchers) {
    const t = v.date?.getTime?.();
    if (typeof t !== "number" || Number.isNaN(t)) continue;
    if (t > horizon) {
      issues.push({
        voucherId: v.id,
        code: "DATE_FAR_FUTURE",
        severity: "warning",
        message: `Voucher dated ${v.date.toISOString().slice(0, 10)} is more than a year away. Tally accepts future dates without complaint, so check the year is not a typo before posting.`,
      });
    }
  }

  return issues;
}

export function hasBlockingPushIssues(issues: PushPreflightIssue[]): boolean {
  return issues.some((i) => i.severity === "error");
}

export interface EnqueueJobInput {
  userId: string;
  clientId: string;
  tallyCompanyId?: string | null;
  kind: SyncJobKind;
  payload: Prisma.InputJsonValue;
}

export async function enqueueJob(
  db: PrismaClient,
  input: EnqueueJobInput
): Promise<SyncJob> {
  return db.syncJob.create({
    data: {
      userId: input.userId,
      clientId: input.clientId,
      tallyCompanyId: input.tallyCompanyId ?? null,
      kind: input.kind,
      payload: input.payload,
    },
  });
}

export interface VoucherPushPayload {
  companyName: string;
  vouchers: { voucherId: string; remoteId: string; xml: string }[];
}

export interface BuildVoucherPushInput {
  userId: string;
  clientId: string;
  tallyCompanyId: string;
  companyName: string;
  voucherIds: string[];
}

/**
 * One envelope per voucher.
 *
 * Tally answers an import with aggregate counters — `CREATED 4, EXCEPTIONS 1` —
 * and a list of `<LINEERROR>` strings that carry no voucher identity. Batch four
 * vouchers and the reply says one failed without saying which, so a per-voucher
 * status is not merely inconvenient to derive, it is not derivable. Tally is on
 * localhost and answers in milliseconds, so the connector loops. Masters are
 * different — they are addressed by name — and stay batched.
 *
 * Ledgers are deliberately left out of these envelopes: MASTER_CREATE runs
 * first and creates them once, rather than every voucher re-declaring them.
 */
export async function buildVoucherPushPayload(
  db: PrismaClient,
  input: BuildVoucherPushInput
): Promise<VoucherPushPayload> {
  const vouchers = await db.voucher.findMany({
    where: {
      id: { in: input.voucherIds },
      userId: input.userId,
      clientId: input.clientId,
    },
    include: {
      lines: { orderBy: { sortOrder: "asc" } },
      invoice: { select: { vendor: true, invoiceNumber: true } },
    },
    orderBy: { date: "asc" },
  });

  const payload: VoucherPushPayload = {
    companyName: input.companyName,
    vouchers: vouchers.map((v) => ({
      voucherId: v.id,
      remoteId: remoteIdFor(v.id),
      xml: buildTallyXml({
        companyName: input.companyName,
        ledgers: [],
        vouchers: [
          {
            id: v.id,
            voucherType: v.voucherType,
            date: v.date,
            narration: v.narration,
            partyName: v.invoice?.vendor,
            invoiceNumber: v.invoice?.invoiceNumber,
            lines: v.lines.map((l) => ({
              ledgerName: l.ledgerNameSnapshot || "Unknown",
              role: l.role,
              debit: l.debit,
              credit: l.credit,
              hsnCode: l.hsnCode,
              gstRate: l.gstRate,
              // Present only on lines that move stock; `exportXml` switches
              // those to an inventory entry with the ledger nested inside.
              stockItemName: l.stockItemName,
              quantity: l.quantity,
              unit: l.unit,
              rate: l.rate,
            })),
          },
        ],
      }),
    })),
  };

  // The sync row is created before the job is handed out, so a voucher shows
  // "queued" the moment the user clicks push rather than only once a connector
  // happens to pick the work up.
  const now = new Date();
  for (const v of vouchers) {
    await db.voucherSync.upsert({
      where: {
        voucherId_tallyCompanyId: {
          voucherId: v.id,
          tallyCompanyId: input.tallyCompanyId,
        },
      },
      create: {
        voucherId: v.id,
        tallyCompanyId: input.tallyCompanyId,
        remoteId: remoteIdFor(v.id),
        state: "QUEUED",
        lastAttemptAt: now,
      },
      update: {
        // Rewritten, not left alone: a row carrying anything other than
        // `RAO-<uuid>` would name a voucher Tally does not hold, and a delete
        // against it would silently miss.
        remoteId: remoteIdFor(v.id),
        state: "QUEUED",
        error: null,
        lastAttemptAt: now,
      },
    });
  }

  return payload;
}

export async function buildVoucherDeletePayload(
  db: PrismaClient,
  input: BuildVoucherPushInput
): Promise<VoucherPushPayload> {
  const vouchers = await db.voucher.findMany({
    where: {
      id: { in: input.voucherIds },
      userId: input.userId,
      clientId: input.clientId,
    },
    select: { id: true, voucherType: true },
  });

  // One envelope per voucher for the same reason a push has one: the counters
  // come back aggregated, so a batched delete of four could not say which one
  // Tally could not find. The envelope carries no dates, amounts or ledger
  // entries — Tally resolves a delete purely by REMOTEID and ignores the body,
  // which matters because by the time someone un-posts an entry they may have
  // edited it here, and a delete rebuilt from current data would no longer
  // describe what is actually in Tally.
  return {
    companyName: input.companyName,
    vouchers: vouchers.map((v) => ({
      voucherId: v.id,
      remoteId: remoteIdFor(v.id),
      xml: buildTallyDeleteXml({
        companyName: input.companyName,
        vouchers: [{ id: v.id, voucherType: v.voucherType }],
      }),
    })),
  };
}

export interface MasterCreatePayload {
  companyName: string;
  xml: string;
  ledgerIds: string[];
  /** Stock items in the same envelope, so a WITH_ITEM push has its masters. */
  stockItemIds: string[];
}

/**
 * The ledgers a push is about to reference that Tally has never heard of.
 *
 * "Never heard of" means no `tallyGuid`, not "not in our last pull": a ledger we
 * created locally after the pull has no GUID and must be created before the
 * voucher referencing it, or Tally rejects that voucher with
 * `Ledger 'X' does not exist!`. Reserved masters are excluded outright — Tally
 * refuses to create or alter its own.
 */
export async function buildMasterCreatePayload(
  db: PrismaClient,
  input: {
    userId: string;
    clientId: string;
    companyName: string;
    /** Restrict to the ledgers a specific batch needs. Omit for the whole chart. */
    ledgerIds?: string[];
    /** Same, for stock items. */
    stockItemIds?: string[];
  }
): Promise<MasterCreatePayload | null> {
  const [ledgers, stockItems] = await Promise.all([
    db.ledger.findMany({
      where: {
        userId: input.userId,
        clientId: input.clientId,
        tallyGuid: null,
        tallyReserved: false,
        ...(input.ledgerIds?.length ? { id: { in: input.ledgerIds } } : {}),
      },
      orderBy: { name: "asc" },
    }),
    /**
     * Stock items key off `tallySyncedAt`, not `tallyGuid` the way ledgers do.
     *
     * Ledgers chase a GUID because posting joins on it: Tally names are
     * case-sensitive, tolerate trailing whitespace and get renamed, and a name
     * match is the biggest source of push failures in this product category.
     * A stock item is only ever *named* on a voucher — `<STOCKITEMNAME>` — so a
     * GUID would buy nothing at posting time, and MASTER_PULL does not read
     * stock items back.
     *
     * The cost is the same rename fragility ledgers used to have: rename an
     * item inside Tally and we would create a second one under the old name
     * rather than recognising it. Worth fixing when MASTER_PULL learns to read
     * stock items; not worth blocking this on.
     */
    db.stockItem.findMany({
      where: {
        userId: input.userId,
        clientId: input.clientId,
        tallySyncedAt: null,
        ...(input.stockItemIds?.length ? { id: { in: input.stockItemIds } } : {}),
      },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!ledgers.length && !stockItems.length) return null;

  return {
    companyName: input.companyName,
    xml: buildTallyXml({
      companyName: input.companyName,
      ledgers: ledgers.map((l) => ({
        name: l.name,
        group: l.group,
        ledgerType: l.ledgerType,
        gstRate: l.gstRate,
        gstin: l.parentGstin,
      })),
      stockItems: stockItems.map((i) => ({
        name: i.name,
        unit: i.unit,
        hsnCode: i.hsnCode,
        gstRate: i.gstRate,
        alias: i.alias,
      })),
      vouchers: [],
    }),
    ledgerIds: ledgers.map((l) => l.id),
    stockItemIds: stockItems.map((i) => i.id),
  };
}

export interface ApplyJobResultOutcome {
  /** False when the job was already terminal — a replayed result changes nothing. */
  applied: boolean;
  state: "DONE" | "FAILED";
  posted?: number;
  failed?: number;
}

type JobRow = Pick<
  SyncJob,
  "id" | "userId" | "clientId" | "tallyCompanyId" | "deviceId" | "kind" | "payload"
>;

/**
 * Record the connector's report and apply the per-kind effects.
 *
 * Idempotency is enforced by the guarded transition at the top rather than by
 * making every downstream write idempotent: a job that is already DONE or
 * FAILED loses the `updateMany` race, returns `applied: false`, and no effect
 * runs twice. The connector retries results after a network drop, and a job
 * requeued by the 5-minute reaper can genuinely be reported twice by two
 * different devices, so this path is exercised in normal operation, not only
 * under abuse.
 */
export async function applyJobResult(
  db: PrismaClient,
  job: JobRow,
  body: JobResultBody
): Promise<ApplyJobResultOutcome> {
  const transportError = body.error?.trim() || null;
  const jobOk = body.ok !== false && !transportError;
  const state: "DONE" | "FAILED" = jobOk ? "DONE" : "FAILED";

  const claim = await db.syncJob.updateMany({
    where: { id: job.id, state: { in: ["QUEUED", "CLAIMED"] } },
    data: {
      state,
      result: body as unknown as Prisma.InputJsonValue,
      error: transportError,
      finishedAt: new Date(),
    },
  });

  if (claim.count === 0) {
    const current = await db.syncJob.findUnique({
      where: { id: job.id },
      select: { state: true },
    });
    return {
      applied: false,
      state: current?.state === "DONE" ? "DONE" : "FAILED",
    };
  }

  switch (job.kind) {
    case "PING":
      await applyPingResult(db, job, body, jobOk);
      break;
    case "MASTER_PULL":
      await applyMasterPullResult(db, job, body, jobOk);
      break;
    case "MASTER_CREATE":
      await applyMasterCreateResult(db, job, body, jobOk);
      break;
    case "VOUCHER_PUSH":
    case "VOUCHER_DELETE":
      return {
        applied: true,
        state,
        ...(await applyVoucherResults(db, job, body, transportError)),
      };
  }

  return { applied: true, state };
}

async function applyPingResult(
  db: PrismaClient,
  job: JobRow,
  body: JobResultBody,
  ok: boolean
) {
  if (!job.deviceId) return;
  await db.connectorDevice.update({
    where: { id: job.deviceId },
    data: {
      tallyReachable: ok,
      tallyMessage: body.error?.trim() || (ok ? "Tally answered the ping." : null),
      lastSeenAt: new Date(),
    },
  });
}

async function applyMasterPullResult(
  db: PrismaClient,
  job: JobRow,
  body: JobResultBody,
  ok: boolean
) {
  if (!job.tallyCompanyId) return;

  if (!ok) {
    await db.tallyCompany.update({
      where: { id: job.tallyCompanyId },
      data: { status: "ERROR" },
    });
    return;
  }

  const payload = (job.payload ?? {}) as { companyName?: string };
  const company = await db.tallyCompany.findUnique({
    where: { id: job.tallyCompanyId },
    select: { companyName: true },
  });

  await applyMasterPull(db, {
    userId: job.userId,
    clientId: job.clientId,
    tallyCompanyId: job.tallyCompanyId,
    companyName: company?.companyName ?? payload.companyName ?? "",
    companies: body.companies ?? null,
    ledgers: body.ledgers ?? null,
  });
}

async function applyMasterCreateResult(
  db: PrismaClient,
  job: JobRow,
  body: JobResultBody,
  jobOk: boolean
) {
  const payload = (job.payload ?? {}) as {
    ledgerIds?: string[];
    stockItemIds?: string[];
    companyName?: string;
  };
  const ledgerIds = body.ledgerIds?.length ? body.ledgerIds : payload.ledgerIds ?? [];
  const stockItemIds = payload.stockItemIds ?? [];
  const ok = jobOk && isTallySuccess(body.tally);

  if (!ok || (!ledgerIds.length && !stockItemIds.length)) return;

  const now = new Date();

  if (ledgerIds.length) {
    await db.ledger.updateMany({
      where: { id: { in: ledgerIds }, userId: job.userId, clientId: job.clientId },
      data: { tallyCompanyId: job.tallyCompanyId, tallySyncedAt: now },
    });
  }

  if (stockItemIds.length) {
    await db.stockItem.updateMany({
      where: { id: { in: stockItemIds }, userId: job.userId, clientId: job.clientId },
      data: { tallyCompanyId: job.tallyCompanyId, tallySyncedAt: now },
    });
  }

  if (!ledgerIds.length) return;

  // Tally does not return GUIDs on import, so identity is only ever learnt by
  // reading back. Without this follow-up the ledgers we just created stay
  // GUID-less and the next push would try to create them a second time.
  await enqueueJob(db, {
    userId: job.userId,
    clientId: job.clientId,
    tallyCompanyId: job.tallyCompanyId,
    kind: "MASTER_PULL",
    payload: { companyName: payload.companyName ?? "" },
  });
}

async function applyVoucherResults(
  db: PrismaClient,
  job: JobRow,
  body: JobResultBody,
  transportError: string | null
): Promise<{ posted: number; failed: number }> {
  const payload = (job.payload ?? {}) as {
    vouchers?: { voucherId: string }[];
  };
  const sent = payload.vouchers?.map((v) => v.voucherId) ?? [];
  const entries = body.results ?? [];
  const byId = new Map(entries.map((e) => [e.voucherId, e]));

  // A job that never reached Tally reports no per-voucher results at all. Every
  // voucher it carried has to be failed explicitly, or it sits at SENDING for
  // ever and the UI spins on a job that is already dead.
  const voucherIds = sent.length ? sent : entries.map((e) => e.voucherId);
  const deleting = job.kind === "VOUCHER_DELETE";
  const now = new Date();

  /**
   * Which of these vouchers move stock — looked up only if it turns out to
   * matter, which is when Tally rejects one and gives no reason.
   *
   * The happy path is the overwhelmingly common one, and it does not need this
   * at all; a query on every push to serve an error message that usually never
   * appears would be the wrong trade. Resolved once per batch and cached.
   */
  let stockVoucherIds: Set<string> | null = null;
  const movesStock = async (id: string): Promise<boolean> => {
    if (stockVoucherIds === null) {
      const rows = await db.voucherLine.findMany({
        where: { voucherId: { in: voucherIds }, stockItemId: { not: null } },
        select: { voucherId: true },
        distinct: ["voucherId"],
      });
      stockVoucherIds = new Set(rows.map((l) => l.voucherId));
    }
    return stockVoucherIds.has(id);
  };

  let posted = 0;
  let failed = 0;
  let sawEducationMode = false;

  for (const voucherId of voucherIds) {
    const entry = byId.get(voucherId);
    const counters = entry?.tally ?? null;

    // The connector's own `ok` is not trusted over the counters: `ok: true` with
    // `exceptions: 1` is exactly the bug this predicate exists to prevent.
    //
    // A delete of a voucher Tally has never heard of is the one rejection that
    // counts as success — the books already look the way the user asked for.
    const success = counters
      ? (isTallySuccess(counters) && entry?.ok !== false) ||
        (deleting && isAlreadyAbsent(counters))
      : entry?.ok === true;

    if (looksLikeEducationMode(counters)) sawEducationMode = true;

    if (success) {
      posted += 1;
      await db.voucherSync.updateMany({
        where: { voucherId, tallyCompanyId: job.tallyCompanyId ?? undefined },
        data: {
          state: deleting ? "DELETED" : "POSTED",
          error: null,
          jobId: job.id,
          tallyMasterId: toTallyId(counters?.lastVchId),
          syncedAt: now,
          lastAttemptAt: now,
        },
      });
      await db.voucher.updateMany({
        where: { id: voucherId, userId: job.userId, clientId: job.clientId },
        data: {
          status: deleting ? "APPROVED" : "POSTED",
          ...(deleting ? {} : { exportedAt: now }),
        },
      });
    } else {
      failed += 1;
      // A reason from Tally is always better than either of ours. Only when
      // there is none does it matter whether the voucher carried stock, and
      // only then is the lookup paid for.
      let reason = rejectionReason(entry, transportError);
      if (reason === BLANK_REJECTION_REASON && (await movesStock(voucherId))) {
        reason = BLANK_REJECTION_REASON_INVENTORY;
      }
      await db.voucherSync.updateMany({
        where: { voucherId, tallyCompanyId: job.tallyCompanyId ?? undefined },
        data: {
          state: "FAILED",
          error: reason,
          jobId: job.id,
          lastAttemptAt: now,
        },
      });
    }
  }

  if (sawEducationMode && job.tallyCompanyId) {
    await db.tallyCompany.update({
      where: { id: job.tallyCompanyId },
      data: { educationMode: true },
    });
  }

  return { posted, failed };
}
