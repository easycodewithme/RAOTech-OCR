# Running and testing Rao-Tech locally

Everything below assumes a Windows machine with TallyPrime on it, because that is
what a CA firm actually has. The web app itself runs anywhere; only the Tally
half needs Windows.

Read this top to bottom the first time. After that, [Part 3](#3-testing-each-feature)
is the part you come back to.

---

## 1. Setup

### 1.1 What you need installed

| Thing | Why | Notes |
|---|---|---|
| Node.js 20+ | runs the app | `node -v` |
| PostgreSQL | the database | a Supabase or Neon connection string is fine — no local install needed |
| TallyPrime | the thing we post into | only for the Tally features; everything else works without it |
| Go 1.22+ | builds the desktop connector | optional — a prebuilt `connector.exe` is committed |

### 1.2 Install and configure

```bash
cd invoice-management
npm install                     # `postinstall` runs `prisma generate` for you
cp .env.example .env.local
```

Then fill in `.env.local`:

```ini
# Clerk — sign in at clerk.com, create an app, copy the two keys
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up

# Postgres — Supabase pooler string works as-is
DATABASE_URL=postgresql://user:password@host:5432/postgres

# The Python OCR service. Only needed for scanned-invoice upload;
# Excel and bank features do not touch it.
BACKEND_URL=https://your-backend.onrender.com
BACKEND_API_KEY=<same value as BACKEND_API_KEY in the OCR service>
```

### 1.3 Create the tables

```bash
npx prisma migrate deploy       # applies every migration, additively
npx prisma generate             # regenerates the typed client
```

> **If `prisma generate` fails with `EPERM`**, the dev server is holding
> `query_engine-windows.dll.node`. Stop it first, then re-run.

> **The migrations are hand-written and additive on purpose.** This database is
> shared with an older inventory project, so `prisma migrate diff` will happily
> propose dropping thirteen tables that have nothing to do with us. Never run
> `prisma migrate dev` against it — write the SQL by hand.

### 1.4 Start it

```bash
npm run dev
```

Next picks the first free port, normally <http://localhost:3000>. If something
else is on 3000 it will say so and use 3001 — read the banner, don't assume.

Sign up through the UI. Your Clerk account becomes a `User` row on first request.

### 1.5 Get a workspace with data in it

An empty account shows empty screens. This gives you a realistic one:

```bash
npx tsx scripts/demo-workspace.mts setup you@example.com
```

It creates a client called **Tally Demo (RAOTECH)** with a chart of accounts, a
`TallyCompany` pointing at a company named `RAOTECH`, and some vouchers. It
appears in the workspace switcher next to your real clients and touches nothing
else. To remove it:

```bash
npx tsx scripts/demo-workspace.mts reset you@example.com
```

`reset` takes the vouchers back out of Tally *before* deleting the local rows —
see [the orphan warning](#the-one-thing-that-can-actually-hurt-a-client).

---

## 2. Connecting TallyPrime

The cloud never dials your desktop. A small agent on the PC polls the cloud for
work and talks to Tally over `localhost`. That means no port forwarding, no
inbound firewall rule, and no exposure of the client's books to the internet.

### 2.1 Turn on Tally's gateway

In TallyPrime: `F1 → Settings → Connectivity → Client/Server configuration`

- **TallyPrime acts as:** `Both`
- **Enable ODBC:** `Yes`
- **Port:** `9000`

Open the company you want to post into and leave TallyPrime running. Check it:

```bash
curl -m 5 -X POST -H "Content-Type: text/xml" \
  -d '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>List of Companies</ID></HEADER><BODY></BODY></ENVELOPE>' \
  http://localhost:9000
```

Any XML back means the gateway is up.

> `tally.ini` is not a reliable source of truth here — it can say the gateway is
> enabled when it is not. The curl above is the only answer that counts.

### 2.2 Pair the connector

1. In the app, go to **Settings → Tally**. Click **Pair a device**. You get an
   eight-character code, good for two hours.
2. Run the agent and enter the code:

   ```powershell
   ..\tally-connector\bin\connector.exe
   ```

   It sits in the tray, reports Tally's reachability every 30 seconds, and polls
   for jobs.

For debugging there is a Node implementation of the same protocol, which is
easier to read the output of:

```bash
# mint a code without the UI
npx tsx scripts/demo-workspace.mts code you@example.com

npx tsx scripts/ref-connector.mts pair L3RS-RRVA
npx tsx scripts/ref-connector.mts run          # long-polls until you stop it
npx tsx scripts/ref-connector.mts run --once   # drains what is queued, then exits
```

If the app is not on port 3000, tell it: `CLOUD_URL=http://localhost:3001 npx tsx ...`

**When a push fails, run the reference connector first.** If it succeeds where
the `.exe` failed, the fault is in the desktop binary; if both fail the same
way, it is the cloud or Tally. That one comparison saves a lot of guessing.

---

## 3. Testing each feature

Each section says what to do and, more usefully, **what wrong looks like**.

### 3.1 Scanned invoice → voucher

**Needs:** `BACKEND_URL` + `BACKEND_API_KEY`.

1. **Upload** → drop a PDF or photo of a purchase bill.
2. Watch it move across the **Pipeline** board: Uploaded → Processed → Draft.
3. Open it under **Invoices**. Check the vendor, GSTIN, invoice number, taxable
   value and each tax component against the paper.
4. Open the **Voucher**. It should show a party line, one or more item lines,
   CGST/SGST *or* IGST (never both), and balance to the paisa.
5. **Approve**.

**What wrong looks like:** a voucher line with no ledger against it. That is the
app refusing to invent a master, not a bug — pick the ledger, or create it. A
voucher with any unmapped line cannot be approved, deliberately: Tally would
answer `Ledger 'Unknown' does not exist!` and the reason would be a mystery.

### 3.2 Spreadsheet ingestion — the volume path

This is how a firm actually moves a month of purchases. A sample sheet is
committed at `scripts/demo-purchase-register.xlsx`; it is deliberately awkward —
three rows of preamble above the header, and a grand-total row at the bottom.

1. **Sheets → Upload**, pick the file.
2. **Step 1 (File):** confirm it found the header row (row 4, not row 1) and
   dropped the totals row.
3. **Step 2 (Columns):** it guesses each column. Check the confidence numbers;
   anything under ~0.7 is worth a look.
4. **Step 3 (GST):** it decides whether the sheet is *long* (one `Tax Rate` /
   `Tax Amount` pair) or *wide* (a `5%`, `12%`, `18%`, `28%` column each). Getting
   this wrong is the single most common failure in this category of product —
   the competitor has 26 separate FAQ articles about it. Override if it guessed
   wrong.
5. **Step 4 (Ledgers):** pick the purchase, CGST, SGST and IGST ledgers. Any
   party the sheet names that you have never seen is listed here — create it,
   with a group, or the rows referencing it will not commit.
6. **Step 5 (Review):** errors block, warnings do not. Commit.

**Reconciliation check:** the taxable total on the review screen must equal the
grand total printed in the sheet. For the demo file that is exactly
`136300.00`. If it does not match, something was dropped or double-counted, and
committing would put a wrong number in a client's books.

Or run the whole thing headless:

```bash
npx tsx scripts/e2e-excel.mts you@example.com
```

### 3.3 Bank statement → Payment / Receipt / Contra

1. **Bank → Upload** a statement (CSV or PDF).
2. **Set the bank ledger at the top of the statement.** Nothing can be built
   until you do — every Payment needs the bank account on one side, and a
   statement row only ever shows you the other side.
3. Check the **reconcile banner**. It walks from the printed opening balance to
   the printed closing balance. If a row is missing or duplicated it names the
   first row where the arithmetic and the printed running balance diverge —
   that is where to look, not the total.
4. **Rules** (right-hand panel). Add a few:

   | Field | Condition | Value | Ledger |
   |---|---|---|---|
   | narration | contains | `RENT` | Rent A/c |
   | amount | lt | `100` | Bank Charges |
   | type | equals | `RECEIPT` | Consulting Income |

   Click **Preview** first. It tells you how many rows it would touch and which
   ledger each would get, *before* touching anything. Then apply.
5. Assign the rest by hand. **Split** a row across two ledgers to test that path.
6. **Save** the rows you are happy with. Save and Send are separate steps on
   purpose — a half-assigned statement has to be resumable tomorrow without
   anything having been posted.
7. **Build vouchers**, then **Send to Tally**.

**Things worth deliberately breaking:**

- Make a split total less than the row. It must **refuse**, and say by how much.
  A round-off plug here would leave the books quietly wrong by whatever you
  failed to allocate.
- Write a rule naming a ledger that does not exist. It should store, be listed
  as unresolved, and start working the moment you create the ledger. It must
  never auto-create the ledger.
- Mark a transfer to the cash box as **Contra**. Nothing infers Contra for you:
  a transfer between the firm's own accounts is indistinguishable from an
  ordinary payment when you can only see one side of it.
- Assign a ledger to a recurring narration, save, then upload next month's
  statement. The same counterparty should come back pre-assigned with a
  confidence score. *(Known limit: this matches on the counterparty text, so
  "OFFICE RENT AUG" and "OFFICE RENT SEP" are two different memories.)*

Or headless:

```bash
npx tsx scripts/e2e-bank.mts run       # 18 assertions, no Tally needed
npx tsx scripts/e2e-bank.mts check     # after the connector has drained
npx tsx scripts/e2e-bank.mts cleanup   # unposts from Tally, then offers to delete
```

### 3.4 Bulk master upload — ledgers and stock items

The first hour of every new client. A firm taking one on has a chart of
accounts and an item list in a sheet already; without this they retype it.

1. **Sheets → Upload**, and pick **Ledgers (masters)** or **Stock items
   (masters)** as the document type. The item-detail question disappears — a
   master sheet has no invoices in it — and the wizard drops from five steps to
   two.
2. Name the columns. The server has already guessed, so you land on a preview of
   your own data rather than an empty form.
3. Read the four counters: **rows**, **will create**, **already here**,
   **blocked**. Nothing is written until you press the button.

**Things worth deliberately breaking:**

- Put a nonsense group ("Wibble") in a ledger sheet's *Under* column. It should
  **warn**, file the ledger under Current Assets, and still create it. Current
  Assets is deliberately not a posting default anywhere, so a misfiled ledger
  shows up under an odd heading instead of quietly becoming the default purchase
  account for the whole client.
- Leave an item's **Unit** blank. It should **refuse that row**. Tally cannot
  change a stock item's base unit once stock has moved against it, so defaulting
  to "Nos" would not be a guess anyone could take back — it would be a permanent
  wrong unit on the client's master.
- Upload the same sheet twice. The second run should report every row as
  "already here" and change nothing. An existing master is never overwritten:
  re-uploading a chart must not re-file a ledger someone has since corrected by
  hand, or move a party that vouchers already post against.
- Put the same name in two rows. Both are blocked, not silently deduplicated.

Nothing is pushed to Tally from this screen. The rows land locally and the
ordinary `MASTER_CREATE` job carries them over on the next sync — one path to
Tally, not two.

### 3.5 Stock: vouchers that move inventory

**This only matters for clients who keep stock in Tally**, and it is switched on
by the presence of masters rather than by a setting: an item line gets an
inventory allocation only if the workspace has a stock item of that name. A
services client never has any, so nothing about their vouchers changes.

1. Upload item masters ([3.4](#34-bulk-master-upload--ledgers-and-stock-items)).
2. Upload a `WITH_ITEM` purchase sheet whose item names match those masters.
3. Push, then check in TallyPrime: `Gateway → Stock Summary`. The quantities
   should have moved, not just the money.

**What wrong looks like:** the expense doubled. An item line's accounting ledger
belongs *inside* its inventory entry; emitted both there and beside it, Tally
accepts the voucher, the books still balance, and the purchase account is
debited twice. There is a unit test pinning this
(`exportXml.inventory.test.ts`) and an assertion in the end-to-end script,
because nothing on our side would ever report it — the client would just find
their expenses doubled.

**Two company settings have to be on, and they are separate.**

`F11 → Inventory Features → Maintain Stock` lets stock exist at all. Without it
a company accepts stock item masters quite happily and then refuses every
voucher that names one, *with no reason given*.

But that alone is not enough. Measured on a company with Maintain Stock **on**:
a Stock Journal — a pure inventory voucher — posts fine, while a Purchase or a
Sales voucher carrying the same item is rejected with a blank reason, in every
XML shape tried. Stock can move; an *item invoice* cannot be recorded. That is
governed separately, by invoicing being enabled for the company
(`F11 → Accounting Features → Enable Invoicing`, and purchases recorded in
invoice mode).

The quick way to tell the two apart, if a stock push is failing:

```bash
npx tsx scripts/probe-inventory.mts
```

A Stock Journal that posts while Purchase-with-items does not means stock is
fine and invoicing is the thing to switch on.

Headless:

```bash
npx tsx scripts/e2e-inventory.mts run       # 16 local checks, no Tally needed
npx tsx scripts/e2e-inventory.mts check     # after the connector drains
npx tsx scripts/e2e-inventory.mts cleanup
npx tsx scripts/probe-inventory.mts         # what Tally accepts, measured live
```

### 3.6 All Clients — the portfolio view

Every other screen is scoped to the client in the switcher, which is right for
doing the work and useless for deciding what work to do. **All Clients** is the
screen a firm owner opens on a Monday.

1. **All Clients** in the sidebar (or ⌘K → "All clients").
2. Rows are sorted by **what needs attention, not alphabetically**. The order is
   by consequence, not volume: a rejected voucher is wrong books right now; one
   stuck sending may be wrong books and we cannot tell, which is worse than
   knowing; work merely waiting is not a problem at all.
3. Clicking a row **switches the whole app** to that client and lands on its
   dashboard — it does not just navigate, because every other screen reads
   whichever client is active server-side.

**Worth checking:** a client with one rejected voucher must sort above a client
with a thousand drafts. There is a test pinning that (`portfolio.test.ts`),
because it is the kind of ordering that gets "improved" into a total.

### 3.7 Stock items

**Settings → Ledgers & Rules → Stock Items.** These masters are the switch for
the whole inventory feature: a voucher line becomes an inventory allocation only
if an item of that name exists here, so a services client has an empty tab and
nothing about their vouchers changes.

- Add an item without a unit. It should refuse — the reason is on the screen.
- Edit the unit of an item that is not yet on any voucher: allowed.
- Edit the unit of one that **is**: the field is closed and says why. Tally will
  not alter a base unit once stock has moved, so an edit here would only make
  the next push fail.
- Change an HSN on an item Tally already has. It should say it is queued to
  update on the next sync — the master goes back into `MASTER_CREATE`, which is
  idempotent, so Tally alters rather than duplicating.
- Try to delete an item that is on a voucher: refused. Delete an unused one:
  removed here only, never from Tally.

### 3.8 Pushing to Tally

1. Approve some vouchers.
2. **Send to Tally.** A badge tracks each one: grey queued → amber sending →
   green posted → red rejected.
3. On red, the badge carries **Tally's own words** — `Ledger 'Acme' does not
   exist!` — rather than a generic failure. Fix and re-send.
4. Verify in TallyPrime: `Gateway → Day Book`, or `Display → Account Books`.

**The check runs before you click, not after.** Select some vouchers and a panel
appears above the button saying what a push would do. It is a courtesy, not the
authority — the server runs the same checks and answers 422 regardless — so if
it cannot run, the button stays enabled and the server does its job.

Worth provoking:

- Select an unbalanced or unmapped voucher. The panel turns red, says how many
  would be rejected, and **Push is disabled** with the reason on hover. Expand
  it for the per-voucher list, so you are not hunting six bad rows out of forty.
- Stop the connector and select anything. The panel warns that nothing is
  listening — these would queue and sit. Push stays enabled, because queueing
  is legitimate; you just get told.
- Select vouchers for a client whose masters are not in Tally yet. It says how
  many will be created first, which is why the first push of a new client runs
  two jobs.
- Select a voucher that moves stock. It reminds you the company needs inventory
  *and* invoicing on, because Tally rejects those without saying why.

**Test that a re-push is safe.** Send the same voucher twice. Tally must show
**one** voucher, altered, not two. Each voucher carries a `RAO-<uuid>` REMOTEID
and that is what Tally matches on:

```bash
npx tsx scripts/e2e-idempotency.mts
```

**Test the delete.** Unsync a posted voucher; it should disappear from the Day
Book. Unsync it again; that must also report success — a voucher that is already
gone is the state you asked for.

### 3.9 GST 2B reconciliation

1. **GST → Upload** a GSTR-2B JSON.
2. It matches each row against your purchase invoices and buckets them:
   matched, value mismatch, missing in 2B, missing in books, duplicate.
3. Check a value mismatch by hand — the two amounts are shown side by side.

### 3.10 Ledger rules (invoice side)

**Settings → Ledger Rules.** These are the invoice-side rules: match on GSTIN,
vendor name or HSN. They are a different mechanism from the banking rule list —
these target a ledger by **id** and are not portable between clients; bank rules
target by **name** so a whole ruleset can be cloned across two hundred clients.

Worth confirming they stay separate: create a bank rule whose narration contains
`RENT`, then process a purchase bill from a vendor called "Rent A Car Pvt Ltd".
The bill must **not** get the rent ledger.

---

## 4. The automated tests

```bash
npm test                        # 620 unit tests, no database, no Tally, ~3s
npx tsc --noEmit                # types
npm run lint
```

The scripted end-to-end harnesses need a real database, and the Tally half of
each needs TallyPrime running:

| Script | What it proves | Needs Tally |
|---|---|---|
| `scripts/e2e-tally.mts` | connector loop: seed → enqueue → check → cleanup | yes |
| `scripts/e2e-excel.mts` | sheet → mapped → vouchers → queued | no |
| `scripts/e2e-bank.mts` | statement → rules → save → vouchers → queued | no |
| `scripts/e2e-inventory.mts` | stock masters → a purchase that moves stock | no |
| `scripts/probe-inventory.mts` | what Tally accepts for stock items and inventory vouchers | yes |
| `scripts/e2e-idempotency.mts` | a re-push alters, it does not duplicate | yes |
| `scripts/probe-bank-voucher.mts` | Tally accepts all four bank voucher shapes | yes |

They drive the library functions the API routes call, rather than the routes
themselves, because the routes sit behind a Clerk session a script cannot forge.
Everything below HTTP is the real thing.

---

## 5. When something goes wrong

### The one thing that can actually hurt a client

**Never delete a voucher row locally while it might still be in Tally.**

The `REMOTEID` we send is the only identifier a Tally delete will accept, and
Tally does not give it back to us — it exports a different one. So the id lives
in exactly one place: our `Voucher` row. Delete that row and the voucher stays
in the client's books forever, addressable only by hand in the Day Book.

Cascading deletes make this easy to do by accident: dropping a `Client` takes
its invoices, which takes its vouchers. Always unpost first. Every teardown path
in `scripts/` does this, and refuses to proceed if anything is still `POSTED` —
or still `SENDING`, which means a device took the job and we do not know what
happened next. "Not sure" has to be treated as "it is in there".

### Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Push rejected with **no reason at all** | usually an unbalanced voucher, or Tally is in education mode | check the voucher totals; check the Tally licence |
| `Ledger 'Unknown' does not exist!` | a voucher line had no ledger and the XML writer substituted a placeholder | find the unmapped line; approval should have blocked this |
| `Ledger 'X' does not exist!` | the ledger exists here but not in Tally | run **Sync masters** before pushing |
| `Stock Item 'X' does not exist!` | same, for a stock item | run **Sync masters**; Tally invents neither |
| Stock voucher rejected with **no reason** | the company has inventory off | `F11 → Inventory Features → Maintain Stock` |
| A master create keeps failing with a stale error | Tally poisons a name that has ever failed | fix the cause, then restart TallyPrime — retrying the same name replays the old error |
| Voucher stuck on **amber / sending** | the connector took the job and never reported back | check the agent is running; re-push — it is idempotent |
| Nothing happens on push | no connector paired, or Tally not running | Settings → Tally shows last-seen and Tally reachability |
| `prisma generate` → `EPERM` | dev server holding the query engine DLL | stop the dev server first |
| Port 3000 taken | another project | read the banner; Next will use 3001 |

### Reading the state directly

```bash
npx prisma studio               # browse every table
```

The rows worth knowing: `SyncJob` (what the connector was asked to do),
`VoucherSync` (per-voucher outcome, with Tally's verbatim error), and
`ConnectorDevice` (when the agent last checked in, and whether it could see
Tally).

---

## 6. Where things live

```
src/lib/accounting/     invoice + bank -> balanced voucher drafts, ledger resolution
src/lib/bank/           statement parsing, classification, the rule engine
src/lib/excel/          spreadsheet parsing, layout detection, column mapping
src/lib/tally/          XML, the HTTP gateway client, the job queue
src/app/api/            route handlers
src/app/(dashboard)/    the screens
prisma/                 schema and hand-written migrations
scripts/                the end-to-end harnesses described above
../tally-connector/     the Go desktop agent
../tally-dev-docs/      the Tally XML notes and the connector protocol contract
```

`../tally-dev-docs/connector-protocol.md` is the binding contract between the
cloud and the agent. Its nine numbered rules were each established by measuring
a live TallyPrime, not by reading a manual. If you change a field name on either
side, change it there too.
