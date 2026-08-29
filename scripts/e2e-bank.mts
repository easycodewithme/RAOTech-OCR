/**
 * End-to-end: bank statement -> rules -> save -> vouchers -> TallyPrime.
 *
 * The Excel path was proven this way already; this is the other volume path and
 * the one that had never been run against a live Tally past the shape probe.
 * It also exercises the three defects fixed alongside it, each of which is
 * invisible in a unit test:
 *
 *   1. `Voucher.invoiceId` is nullable, so no synthetic carrier `Invoice` is
 *      written. The script asserts none appears.
 *   2. Bank rules are `MappingRule` rows scoped BANK. The script writes them,
 *      reads them back through the real store, and asserts the invoice ledger
 *      resolver cannot see them.
 *   3. The narration memory is written and read under the same key. The script
 *      saves a row, then asks the reader about a different reference number on
 *      the same counterparty and expects the ledger back.
 *
 * Like the Excel harness it drives the library functions the API routes call,
 * because the routes sit behind a Clerk session a script cannot forge.
 * Everything below HTTP is real: real rules engine, real save gate, real
 * accounting pipeline, real job queue, real TallyPrime.
 *
 *   npx tsx scripts/e2e-bank.mts run       # seed -> rules -> save -> build -> queue
 *   npx tsx scripts/e2e-bank.mts check     # what the connector did with it
 *   npx tsx scripts/e2e-bank.mts cleanup   # unpost from Tally, THEN delete rows
 */
import { PrismaClient, Prisma } from "@prisma/client";
import { addRule, applyRules, listRules } from "../src/lib/bank/rules";
import { classifyBankTxn, suggestLedgerFromNarrationMemory } from "../src/lib/bank/classify";
import {
  buildVouchersForStatement,
  validateStatementBalance,
} from "../src/lib/bank/bankVouchers";
import { rememberNarrationMappings } from "../src/lib/accounting/rememberMapping";
import { resolveLedgersForInvoice } from "../src/lib/accounting/resolveLedger";
import {
  buildMasterCreatePayload,
  buildVoucherPushPayload,
  buildVoucherDeletePayload,
  enqueueJob,
} from "../src/lib/tally/syncJobs";

const prisma = new PrismaClient();
const EMAIL = process.env.E2E_EMAIL ?? "spotmefy2204@gmail.com";
const CLIENT_NAME = "Tally Demo (RAOTECH)";
const STATEMENT_FILE = "e2e-bank-aug-2026.csv";

function head(s: string) {
  console.log("\n" + "=".repeat(70) + "\n" + s + "\n" + "=".repeat(70));
}

let failures = 0;
function check(ok: boolean, label: string, detail = "") {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  -- " + detail : ""}`);
  if (!ok) failures++;
}

const ctx = async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: EMAIL } });
  const client = await prisma.client.findFirstOrThrow({
    where: { userId: user.id, name: CLIENT_NAME },
  });
  const company = await prisma.tallyCompany.findUniqueOrThrow({
    where: { clientId: client.id },
  });
  return { userId: user.id, clientId: client.id, company };
};

/* ------------------------------------------------------------------ ledgers */

const LEDGERS = [
  { name: "RAO Bank A/c", group: "BANK_ACCOUNTS", ledgerType: "BANK" },
  { name: "RAO Rent A/c", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "RAO Elec A/c", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "RAO Bank Charges", group: "INDIRECT_EXPENSES", ledgerType: "EXPENSE" },
  { name: "RAO Consulting Income", group: "INDIRECT_INCOME", ledgerType: "INCOME" },
  { name: "RAO Cash Box", group: "CASH_IN_HAND", ledgerType: "CASH" },
] as const;

/**
 * One month of a small firm's account. Deliberately ordinary: a rent standing
 * instruction, a bank charge under a hundred rupees, a client receipt, a
 * utility bill that has to be split across two heads, and a transfer to the
 * cash box that no amount of narration reading can tell apart from an ordinary
 * payment.
 */
const OPENING = 100000;
const ROWS = [
  { d: "2026-08-03", desc: "NEFT/778213991/OFFICE RENT AUG", w: 25000, dep: 0 },
  { d: "2026-08-05", desc: "BANK CHARGES GST INCL", w: 59, dep: 0 },
  { d: "2026-08-08", desc: "UPI/CR/909123456/ACME CONSULTING LLP", w: 0, dep: 45000 },
  { d: "2026-08-12", desc: "UPI/DR/402913844/RELIANCE JIO", w: 3540, dep: 0 },
  { d: "2026-08-20", desc: "SELF TRANSFER TO CASH", w: 10000, dep: 0 },
];
const CLOSING = ROWS.reduce((s, r) => s + r.dep - r.w, OPENING);

async function seed() {
  const { userId, clientId, company } = await ctx();

  head("1. SEED -- chart of accounts and one month of statement");

  const ledgerIds: Record<string, string> = {};
  for (const l of LEDGERS) {
    const row = await prisma.ledger.upsert({
      where: { userId_clientId_name: { userId, clientId, name: l.name } },
      create: {
        userId,
        clientId,
        name: l.name,
        group: l.group,
        ledgerType: l.ledgerType,
        tallyCompanyId: company.id,
      },
      update: { tallyCompanyId: company.id },
      select: { id: true },
    });
    ledgerIds[l.name] = row.id;
  }
  console.log(`ledgers          : ${LEDGERS.length}`);

  /**
   * Clear the previous run before starting a new one.
   *
   * Deleting the statement cascades to its rows, but the vouchers those rows
   * built are not the statement's children -- they are ordinary vouchers -- so
   * a naive re-run leaves five orphans behind with QUEUED sync rows and a stale
   * push job that a connector would happily drain into the client's books.
   *
   * A voucher that has been handed to a connector is a hard stop, not something
   * to tidy past: the REMOTEID we sent is the only handle Tally accepts for a
   * delete and it cannot be read back, so deleting the row here strands the
   * voucher in the books forever. Unpost first, via `cleanup`.
   *
   * SENDING counts, not just POSTED. SENDING means a device claimed the job and
   * we do not know what happened next — which is exactly the state a push
   * whose result never got recorded leaves behind, and the most likely way to
   * make an orphan by accident. "We are not sure" has to be treated as "it is
   * in there".
   */
  const prior = await prisma.bankStatement.findFirst({
    where: { userId, clientId, fileName: STATEMENT_FILE },
    select: { id: true },
  });
  if (prior) {
    const priorVoucherIds = (
      await prisma.bankTxn.findMany({
        where: { statementId: prior.id },
        select: { voucherId: true },
      })
    )
      .map((t) => t.voucherId)
      .filter((v): v is string => !!v);

    const stillPosted = await prisma.voucherSync.count({
      where: { voucherId: { in: priorVoucherIds }, state: { in: ["POSTED", "SENDING"] } },
    });
    if (stillPosted > 0) {
      throw new Error(
        `${stillPosted} voucher(s) from a previous run may still be in Tally. ` +
          `Run \`npx tsx scripts/e2e-bank.mts cleanup\` and drain the delete job first — ` +
          `deleting them here would strand them in the client's books.`
      );
    }

    if (priorVoucherIds.length) {
      await prisma.voucherSync.deleteMany({ where: { voucherId: { in: priorVoucherIds } } });
      await prisma.voucherLine.deleteMany({ where: { voucherId: { in: priorVoucherIds } } });
      await prisma.voucher.deleteMany({ where: { id: { in: priorVoucherIds } } });
    }
    // Any job still holding those voucher ids would push rows that no longer exist.
    const staleJobs = await prisma.syncJob.deleteMany({
      where: { userId, clientId, state: { in: ["QUEUED", "CLAIMED"] } },
    });
    await prisma.bankStatement.delete({ where: { id: prior.id } });
    console.log(
      `previous run     : cleared ${priorVoucherIds.length} vouchers, ${staleJobs.count} undrained jobs`
    );
  }

  // The running balance is written per row, which is what lets the reconcile
  // gate point at the first row that disagrees rather than only at the total.
  let running = OPENING;
  const statement = await prisma.bankStatement.create({
    data: {
      userId,
      clientId,
      fileName: STATEMENT_FILE,
      bankName: "HDFC Bank",
      accountNumber: "50200099887",
      bankLedgerId: ledgerIds["RAO Bank A/c"],
      openingBalance: OPENING,
      closingBalance: CLOSING,
      status: "DRAFT",
      txns: {
        create: ROWS.map((r, i) => {
          running += r.dep - r.w;
          const { classification, confidence } = classifyBankTxn({
            description: r.desc,
            withdrawal: r.w,
            deposit: r.dep,
          });
          return {
            date: new Date(`${r.d}T00:00:00`),
            description: r.desc,
            withdrawal: r.w,
            deposit: r.dep,
            balance: running,
            classification,
            confidence,
            sortOrder: i,
          };
        }),
      },
    },
    select: { id: true },
  });

  const txns = await prisma.bankTxn.findMany({
    where: { statementId: statement.id },
    orderBy: { sortOrder: "asc" },
  });
  console.log(`statement        : ${statement.id}`);
  console.log(`rows             : ${txns.length}   opening ${OPENING}  closing ${CLOSING}`);
  for (const t of txns) {
    const amount = t.withdrawal
      ? `-${t.withdrawal.toFixed(2)}`
      : `+${t.deposit.toFixed(2)}`;
    console.log(
      `  ${t.date?.toISOString().slice(0, 10)}  ${String(t.description).padEnd(40)}` +
        `${amount.padStart(12)}  bal ${t.balance?.toFixed(2).padStart(10)}  ${t.classification}`
    );
  }

  head("2. RECONCILE GATE -- do the rows walk from opening to closing?");
  const balance = validateStatementBalance(txns, OPENING, CLOSING);
  console.log(balance.note);
  check(balance.ok && balance.checked, "statement reconciles before anything is posted");

  return { userId, clientId, company, statementId: statement.id, ledgerIds };
}

type Ctx = Awaited<ReturnType<typeof seed>>;

/* -------------------------------------------------------------------- rules */

async function rules(s: Ctx) {
  head("3. RULES -- durable now, and invisible to the invoice resolver");

  const { userId, clientId, statementId } = s;

  // Start from a clean list so a re-run is idempotent.
  await prisma.mappingRule.deleteMany({ where: { userId, clientId, scope: "BANK" } });

  const DEFS = [
    {
      field: "narration",
      condition: "contains",
      value: "RENT",
      ledgerName: "RAO Rent A/c",
      priority: 10,
    },
    {
      field: "amount",
      condition: "lt",
      value: "100",
      ledgerName: "RAO Bank Charges",
      priority: 20,
    },
    {
      field: "type",
      condition: "equals",
      value: "RECEIPT",
      ledgerName: "RAO Consulting Income",
      priority: 30,
    },
  ] as const;

  for (const d of DEFS) await addRule(prisma, userId, clientId, { ...d });

  // Read back through the store, not from the objects just created -- that is
  // the whole point of the change.
  const stored = await listRules(prisma, userId, clientId);
  console.log(`stored rules     : ${stored.length}`);
  for (const r of stored) {
    console.log(
      `  [${String(r.priority).padStart(3)}] ${r.field} ${r.condition} "${r.value}" -> ${r.ledgerName}`
    );
  }
  check(stored.length === 3, "rules survive a round trip through Postgres");
  check(
    stored.every((r) => !!r.ledgerName && !!r.value),
    "every stored rule reads back complete"
  );

  const raw = await prisma.mappingRule.findMany({
    where: { userId, clientId, scope: "BANK" },
    select: { ledgerId: true, ledgerName: true, ruleType: true },
  });
  check(
    raw.every((r) => r.ledgerId === null && !!r.ledgerName),
    "bank rules target a ledger by NAME, so the set is cloneable",
    raw.map((r) => r.ruleType).join(", ")
  );

  /**
   * The correctness guard. `resolveLedgersForInvoice` used to read every
   * enabled rule in the workspace; a narration rule leaking in there would
   * start deciding party ledgers for scanned bills. This vendor name contains
   * "RENT", so a leak would show up as the rent ledger.
   */
  const resolved = await resolveLedgersForInvoice(
    prisma,
    userId,
    {
      vendor: "RENT A CAR PRIVATE LIMITED",
      vendorGstin: null,
      invoiceNumber: "X-1",
      date: new Date("2026-08-03"),
      subtotal: 1000,
      cgst: 0,
      sgst: 0,
      igst: 0,
      discount: 0,
      total: 1000,
      items: [],
      customerName: null,
      customerGstin: null,
    } as never,
    "PURCHASE",
    clientId
  );
  const partyName = resolved.party?.name ?? null;
  check(
    partyName !== "RAO Rent A/c",
    "the invoice resolver cannot see a bank rule",
    `vendor "RENT A CAR..." resolved to ${partyName ?? "(nothing)"}`
  );

  head("4. APPLY -- first matching rule wins, and rules never save");
  const [txns, ledgers] = await Promise.all([
    prisma.bankTxn.findMany({
      where: { statementId, voucherId: null },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true,
        description: true,
        withdrawal: true,
        deposit: true,
        classification: true,
        ledgerId: true,
      },
    }),
    prisma.ledger.findMany({
      where: { userId, clientId },
      select: { id: true, name: true },
    }),
  ]);

  const suggestions = applyRules(stored, txns, { ledgers, onlyUnassigned: true });
  const nameById = new Map(ledgers.map((l) => [l.id, l.name]));
  for (const sg of suggestions) {
    const t = txns.find((x) => x.id === sg.txnId)!;
    console.log(
      `  ${String(t.description).padEnd(40)} -> ${sg.ledgerName}${sg.ledgerId ? "" : "  (UNRESOLVED)"}`
    );
    if (!sg.ledgerId) continue;
    await prisma.bankTxn.update({
      where: { id: sg.txnId },
      data: {
        ledgerId: sg.ledgerId,
        ledgerNameSnapshot: nameById.get(sg.ledgerId) ?? null,
        saved: false,
      },
    });
  }
  check(suggestions.length === 3, "three rows matched a rule", `${suggestions.length} matched`);
  check(
    suggestions.every((sg) => !!sg.ledgerId),
    "every rule resolved to a ledger in this workspace"
  );

  const savedAfterRules = await prisma.bankTxn.count({
    where: { statementId, saved: true },
  });
  check(savedAfterRules === 0, "a rule assigns but never saves -- the human still commits");
}

/* ------------------------------------------------------------------ manual */

async function manual(s: Ctx) {
  head("5. THE TWO ROWS NO RULE CAN DECIDE");

  const { statementId, ledgerIds } = s;
  const txns = await prisma.bankTxn.findMany({
    where: { statementId },
    orderBy: { sortOrder: "asc" },
  });

  // A utility bill split across two cost heads. Splits must total the line
  // exactly -- `buildBankVoucher` refuses a shortfall rather than plugging it.
  const jio = txns.find((t) => t.description.includes("RELIANCE"))!;
  await prisma.bankTxn.update({
    where: { id: jio.id },
    data: {
      ledgerId: null,
      ledgerNameSnapshot: null,
      allocations: [
        { ledgerId: ledgerIds["RAO Elec A/c"], ledgerName: "RAO Elec A/c", amount: 2000 },
        { ledgerId: ledgerIds["RAO Rent A/c"], ledgerName: "RAO Rent A/c", amount: 1540 },
      ] as unknown as Prisma.InputJsonValue,
    },
  });
  console.log(`  ${jio.description.padEnd(40)} -> split 2000.00 / 1540.00 (total 3540.00)`);

  // Contra is never inferred. The classifier flagged it from "SELF TRANSFER",
  // but which account it went to is still the accountant's to choose.
  const self = txns.find((t) => t.description.includes("SELF TRANSFER"))!;
  await prisma.bankTxn.update({
    where: { id: self.id },
    data: {
      ledgerId: ledgerIds["RAO Cash Box"],
      ledgerNameSnapshot: "RAO Cash Box",
      classification: "CONTRA",
    },
  });
  console.log(`  ${self.description.padEnd(40)} -> RAO Cash Box  (CONTRA, chosen not guessed)`);
}

/* -------------------------------------------------------------------- save */

async function save(s: Ctx) {
  head("6. SAVE -- the gate, and where the narration memory learns");

  const { userId, clientId, statementId } = s;
  const all = await prisma.bankTxn.findMany({
    where: { statementId },
    orderBy: { sortOrder: "asc" },
  });

  const ready = all.filter(
    (t) => !!t.ledgerId || (Array.isArray(t.allocations) && t.allocations.length > 0)
  );
  await prisma.bankTxn.updateMany({
    where: { id: { in: ready.map((t) => t.id) } },
    data: { saved: true, savedAt: new Date() },
  });

  const learned = await rememberNarrationMappings(
    prisma,
    userId,
    clientId,
    ready
      .filter((t) => !!t.ledgerId)
      .map((t) => ({ narration: t.description, ledgerId: t.ledgerId as string }))
  );
  console.log(`saved            : ${ready.length} of ${all.length}`);
  console.log(`narrations learnt: ${learned}`);
  check(ready.length === 5, "every row is assigned and saved", `${ready.length}/5`);

  /**
   * Defect 3, end to end.
   *
   * The writer stored `normName(narration)` while the reader asked for
   * `narrationKey(narration)`. Nothing errored -- the memory simply never
   * appeared to learn. Here we ask about the SAME counterparty under a
   * different reference number, which is exactly what the memory is for.
   */
  const memoryRows = await prisma.ledgerMapping.findMany({
    where: { userId, clientId, matchType: "NARRATION" },
    select: {
      matchKey: true,
      ledgerId: true,
      hitCount: true,
      ledger: { select: { name: true } },
    },
  });
  const memory = Object.fromEntries(
    memoryRows.map((m) => [
      m.matchKey,
      { ledgerId: m.ledgerId, ledgerName: m.ledger.name, hitCount: m.hitCount },
    ])
  );
  console.log(`memory keys      : ${memoryRows.map((m) => `"${m.matchKey}"`).join(", ")}`);

  // Same counterparty, different UTR. This is the case the memory exists for
  // and the exact case the key mismatch broke.
  const sameParty = "NEFT/993388221/OFFICE RENT AUG";
  const hit = suggestLedgerFromNarrationMemory(sameParty, memory);
  console.log(`same party, new ref: "${sameParty}" -> ${hit?.ledgerName ?? "(nothing)"}`);
  check(
    hit?.ledgerName === "RAO Rent A/c",
    "what a save writes is what a later suggestion reads back",
    hit ? `confidence ${hit.confidence.toFixed(2)}` : "memory returned nothing"
  );

  /**
   * A known limit, reported rather than asserted.
   *
   * The reader falls back to a containment score, so a narration whose
   * counterparty text also changes month to month -- "OFFICE RENT AUG" ->
   * "OFFICE RENT SEP" -- shares no key and misses. Neither string contains the
   * other, and 2-of-3 token overlap is not something the current soft match
   * measures. Worth fixing, but it is a matching-quality question, not the
   * write/read agreement this section is about.
   */
  const nextMonth = "NEFT/993388221/OFFICE RENT SEP";
  const monthHit = suggestLedgerFromNarrationMemory(nextMonth, memory);
  console.log(
    `next month's rent : "${nextMonth}" -> ${monthHit?.ledgerName ?? "(nothing)"}` +
      `${monthHit ? "" : "   [known limit: the counterparty text changed too]"}`
  );
}

/* ------------------------------------------------------------------- build */

async function build(s: Ctx) {
  head("7. BUILD -- statement rows become vouchers, with no invoice behind them");

  const { userId, clientId, statementId } = s;
  const before = await prisma.invoice.count({ where: { userId, clientId } });

  const result = await buildVouchersForStatement(prisma, { userId, clientId, statementId });
  for (const b of result.built) {
    console.log(
      `  built ${b.voucherType.padEnd(8)} ${b.amount.toFixed(2).padStart(10)}  (${b.voucherId.slice(0, 8)})`
    );
  }
  for (const f of result.failed) console.log(`  FAILED  ${f.txnId}: ${f.messages.join("; ")}`);
  for (const sk of result.skipped) console.log(`  skipped ${sk.txnId}: ${sk.reason}`);

  check(result.built.length === 5, "all five rows became vouchers", `${result.built.length}/5`);
  check(result.failed.length === 0, "nothing was refused");

  const types = result.built.map((b) => b.voucherType);
  check(
    types.filter((t) => t === "PAYMENT").length === 3 &&
      types.filter((t) => t === "RECEIPT").length === 1 &&
      types.filter((t) => t === "CONTRA").length === 1,
    "directions came out right: 3 Payment, 1 Receipt, 1 Contra",
    types.join(", ")
  );

  /** Defect 1. The old code wrote one synthetic `bank://` invoice per row. */
  const after = await prisma.invoice.count({ where: { userId, clientId } });
  const carriers = await prisma.invoice.count({
    where: { userId, clientId, fileUrl: { startsWith: "bank://" } },
  });
  check(after === before, "no invoices were created", `${before} -> ${after}`);
  check(carriers === 0, "no `bank://` carrier invoice exists");

  const vouchers = await prisma.voucher.findMany({
    where: { id: { in: result.voucherIds } },
    select: {
      id: true,
      invoiceId: true,
      voucherType: true,
      totalDebit: true,
      totalCredit: true,
      lines: true,
    },
  });
  check(
    vouchers.every((v) => v.invoiceId === null),
    "every bank voucher stands on its own, with invoiceId null"
  );
  check(
    vouchers.every((v) => Math.abs(v.totalDebit - v.totalCredit) < 0.005),
    "every voucher balances"
  );
  const split = vouchers.find((v) => v.lines.length === 3);
  check(
    !!split,
    "the split row produced a three-line voucher",
    split ? `${split.lines.length} lines` : "not found"
  );

  return result.voucherIds;
}

/* ------------------------------------------------------------------- queue */

async function queue(s: Ctx, voucherIds: string[]) {
  head("8. QUEUE -- the same job pipeline every other voucher uses");

  const { userId, clientId, company } = s;

  const masters = await buildMasterCreatePayload(prisma, {
    userId,
    clientId,
    companyName: company.companyName,
  });
  if (masters) {
    const j = await enqueueJob(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      kind: "MASTER_CREATE",
      payload: { ...masters },
    });
    console.log(`queued MASTER_CREATE ${j.id}  (${masters.ledgerIds.length} ledgers)`);
  } else {
    console.log("no masters to create -- every ledger already carries a Tally GUID");
  }

  const push = await buildVoucherPushPayload(prisma, {
    userId,
    clientId,
    tallyCompanyId: company.id,
    companyName: company.companyName,
    voucherIds,
  });

  // The bank vouchers have no invoice, so the envelope must carry no
  // <PARTYLEDGERNAME> -- naming a party ledger that does not exist is a
  // guaranteed rejection.
  const withParty = push.vouchers.filter((v) => v.xml.includes("<PARTYLEDGERNAME>"));
  check(withParty.length === 0, "no envelope names a party ledger");

  const j = await enqueueJob(prisma, {
    userId,
    clientId,
    tallyCompanyId: company.id,
    kind: "VOUCHER_PUSH",
    payload: { ...push },
  });
  console.log(`queued VOUCHER_PUSH  ${j.id}  (${push.vouchers.length} vouchers)`);
  console.log("\nrun the connector now, then: npx tsx scripts/e2e-bank.mts check");
}

/* ------------------------------------------------------------------- check */

async function checkState() {
  const { userId, clientId, company } = await ctx();
  head("SYNC STATE");

  const statement = await prisma.bankStatement.findFirst({
    where: { userId, clientId, fileName: STATEMENT_FILE },
    select: { id: true },
  });
  if (!statement) {
    console.log("no e2e statement found -- run `run` first");
    return;
  }

  const txns = await prisma.bankTxn.findMany({
    where: { statementId: statement.id },
    orderBy: { sortOrder: "asc" },
    select: { description: true, voucherId: true, withdrawal: true, deposit: true },
  });

  const syncs = await prisma.voucherSync.findMany({
    where: {
      tallyCompanyId: company.id,
      voucherId: { in: txns.map((t) => t.voucherId).filter((v): v is string => !!v) },
    },
    select: {
      voucherId: true,
      state: true,
      remoteId: true,
      error: true,
    },
  });
  const byVoucher = new Map(syncs.map((x) => [x.voucherId, x]));

  let posted = 0;
  for (const t of txns) {
    const sync = t.voucherId ? byVoucher.get(t.voucherId) : null;
    if (sync?.state === "POSTED") posted++;
    console.log(
      `  ${String(t.description).padEnd(40)} ${(sync?.state ?? "NOT BUILT").padEnd(10)} ` +
        `${sync?.remoteId ?? ""}${sync?.error ? "  " + sync.error : ""}`
    );
  }
  console.log(`\nposted: ${posted} of ${txns.length}`);

  const jobs = await prisma.syncJob.findMany({
    where: { clientId, tallyCompanyId: company.id },
    orderBy: { createdAt: "desc" },
    take: 6,
    select: { kind: true, state: true, attempts: true, error: true },
  });
  console.log("\nrecent jobs:");
  for (const j of jobs) {
    console.log(
      `  ${j.kind.padEnd(14)} ${j.state.padEnd(10)} attempts=${j.attempts} ${j.error ?? ""}`
    );
  }

  check(posted === txns.length, `all ${txns.length} bank vouchers reached Tally`, `${posted} posted`);
}

/* ----------------------------------------------------------------- cleanup */

/**
 * Unpost BEFORE deleting anything.
 *
 * The REMOTEID we send is the only handle Tally accepts for a delete, and it is
 * not readable back out -- so a voucher row deleted locally leaves a voucher in
 * the client's books that nothing can ever address again. This ordering is not
 * a nicety; it is how the six orphans in RAOTECH were made.
 */
async function cleanup() {
  const { userId, clientId, company } = await ctx();
  head("CLEANUP -- unpost from Tally first, then delete locally");

  const statement = await prisma.bankStatement.findFirst({
    where: { userId, clientId, fileName: STATEMENT_FILE },
    select: { id: true },
  });
  if (!statement) {
    console.log("nothing to clean up");
    return;
  }

  const txns = await prisma.bankTxn.findMany({
    where: { statementId: statement.id },
    select: { voucherId: true },
  });
  const voucherIds = txns.map((t) => t.voucherId).filter((v): v is string => !!v);

  if (voucherIds.length && process.env.CONFIRM_DELETE !== "1") {
    const del = await buildVoucherDeletePayload(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      companyName: company.companyName,
      voucherIds,
    });
    const j = await enqueueJob(prisma, {
      userId,
      clientId,
      tallyCompanyId: company.id,
      kind: "VOUCHER_DELETE",
      payload: { ...del },
    });
    console.log(`queued VOUCHER_DELETE ${j.id} for ${voucherIds.length} vouchers`);
    console.log("run the connector, then re-run with CONFIRM_DELETE=1 to drop the local rows");
    return;
  }

  if (process.env.CONFIRM_DELETE === "1") {
    const stillPosted = await prisma.voucherSync.count({
      where: { voucherId: { in: voucherIds }, state: { in: ["POSTED", "SENDING"] } },
    });
    if (stillPosted > 0) {
      console.log(
        `REFUSING: ${stillPosted} voucher(s) may still be in Tally. Drain the ` +
          `VOUCHER_DELETE job first, or these become orphans nothing can address.`
      );
      failures++;
      return;
    }
    await prisma.bankTxn.updateMany({
      where: { statementId: statement.id },
      data: { voucherId: null },
    });
    await prisma.voucherSync.deleteMany({ where: { voucherId: { in: voucherIds } } });
    await prisma.voucherLine.deleteMany({ where: { voucherId: { in: voucherIds } } });
    await prisma.voucher.deleteMany({ where: { id: { in: voucherIds } } });
    await prisma.bankStatement.delete({ where: { id: statement.id } });
    await prisma.mappingRule.deleteMany({ where: { userId, clientId, scope: "BANK" } });
    await prisma.ledgerMapping.deleteMany({
      where: { userId, clientId, matchType: "NARRATION" },
    });
    console.log(`deleted ${voucherIds.length} vouchers, the statement, the rules and the memory`);
  }
}

/* -------------------------------------------------------------------- main */

const cmd = process.argv[2] ?? "run";

if (cmd === "run") {
  const s = await seed();
  await rules(s);
  await manual(s);
  await save(s);
  const voucherIds = await build(s);
  await queue(s, voucherIds);
  head(failures === 0 ? "ALL LOCAL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
} else if (cmd === "check") {
  await checkState();
  head(failures === 0 ? "TALLY CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
} else if (cmd === "cleanup") {
  await cleanup();
} else {
  console.error("usage: npx tsx scripts/e2e-bank.mts <run|check|cleanup>");
}

await prisma.$disconnect();
process.exit(failures === 0 ? 0 : 1);
