/**
 * What does TallyPrime actually accept for a voucher that moves stock?
 *
 * Nothing in the local notes covers inventory, and the shape has a trap in it:
 * an item line's accounting ledger lives *inside* the inventory entry as an
 * ACCOUNTINGALLOCATIONS.LIST. Emit it there AND as a sibling ALLLEDGERENTRIES
 * and the purchase account is hit twice — Tally accepts the voucher, the books
 * balance, and the expense is double what the bill says. That failure is
 * invisible from our side, so it gets measured here before any of it is built.
 *
 * Posts into RAOTECH and deletes everything it created.
 *
 * REMOTEID is an ATTRIBUTE on <VOUCHER>, never a child element. Sent as a child
 * Tally accepts the create and silently ignores the id, leaving a voucher that
 * no delete can ever address -- an orphan, removable only by hand in the Day
 * Book. This script made three that way before the form was corrected.
 *
 *   npx tsx scripts/probe-inventory.mts
 */
import { pushToTally, type TallyGateway } from "../src/lib/tally/connector";

const gateway: TallyGateway = { host: "localhost", port: 9000, timeoutMs: 30_000 };
const COMPANY = "RAOTECH";

const env = (body: string) => `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>All Masters</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${body}</REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

const vch = (body: string) => `<ENVELOPE>
  <HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER>
  <BODY>
    <IMPORTDATA>
      <REQUESTDESC>
        <REPORTNAME>Vouchers</REPORTNAME>
        <STATICVARIABLES><SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY></STATICVARIABLES>
      </REQUESTDESC>
      <REQUESTDATA>${body}</REQUESTDATA>
    </IMPORTDATA>
  </BODY>
</ENVELOPE>`;

async function step(label: string, xml: string) {
  const r = await pushToTally(xml, gateway);
  const ok = r.errors === 0 && r.exceptions === 0 && r.lineErrors.length === 0;
  console.log(
    `${ok ? "ACCEPT" : "REJECT"}  ${label.padEnd(46)} ` +
      `c=${r.created} a=${r.altered} d=${r.deleted} err=${r.errors} exc=${r.exceptions} ` +
      (r.lineErrors.join(" | ") || (ok ? "" : "(blank reason)"))
  );
  return { ok, r };
}

/* ------------------------------------------------------- 1. the masters */

console.log("\n--- masters ---");

// A unit has to exist before a stock item can name it as its base unit.
//
// Measured: <PARENT>Primary</PARENT> is REJECTED with "Stock Group 'Primary'
// does not exist!" -- unlike ledgers, a company with no inventory yet has no
// stock groups at all, not even Primary. Omitting PARENT works and lands the
// item at the root, which is also where an empty PARENT and Tally's own escaped
// "&#4; Primary" put it.
await step(
  "UNIT Nos",
  env(`
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <UNIT NAME="Nos" ACTION="Create">
        <NAME>Nos</NAME>
        <ISSIMPLEUNIT>Yes</ISSIMPLEUNIT>
        <DECIMALPLACES>2</DECIMALPLACES>
      </UNIT>
    </TALLYMESSAGE>`)
);

await step(
  "STOCKITEM (bare)",
  env(`
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <STOCKITEM NAME="RAO Stock Widget" ACTION="Create">
        <NAME>RAO Stock Widget</NAME>
        <BASEUNITS>Nos</BASEUNITS>
      </STOCKITEM>
    </TALLYMESSAGE>`)
);

// Does it take GST details on the master? If so, the rate lives on the item and
// not only on the voucher line.
await step(
  "STOCKITEM (with HSN + GST rate)",
  env(`
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <STOCKITEM NAME="RAO Stock Gizmo" ACTION="Create">
        <NAME>RAO Stock Gizmo</NAME>
        <BASEUNITS>Nos</BASEUNITS>
        <GSTAPPLICABLE>&#4; Applicable</GSTAPPLICABLE>
        <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
        <HSNCODE>84719000</HSNCODE>
      </STOCKITEM>
    </TALLYMESSAGE>`)
);

// Creating the same item twice: does it alter, or reject?
await step(
  "STOCKITEM again (idempotency)",
  env(`
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <STOCKITEM NAME="RAO Stock Widget" ACTION="Create">
        <NAME>RAO Stock Widget</NAME>
        <BASEUNITS>Nos</BASEUNITS>
      </STOCKITEM>
    </TALLYMESSAGE>`)
);

// The ledgers the vouchers below need.
await step(
  "LEDGERS for the probe",
  env(`
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="RAO Probe Purchase" ACTION="Create">
        <NAME>RAO Probe Purchase</NAME><PARENT>Purchase Accounts</PARENT>
      </LEDGER>
    </TALLYMESSAGE>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <LEDGER NAME="RAO Probe Supplier" ACTION="Create">
        <NAME>RAO Probe Supplier</NAME><PARENT>Sundry Creditors</PARENT>
      </LEDGER>
    </TALLYMESSAGE>`)
);

/* ------------------------------------------- 2. the voucher shapes */

console.log("\n--- vouchers ---");

const posted: string[] = [];

/**
 * The shape we believe is right: the purchase ledger appears ONLY inside the
 * inventory entry. Party as a normal ledger entry.
 *
 * 10 Nos @ 100 = 1000. If the books show 2000 against RAO Probe Purchase after
 * this, the nesting is wrong.
 */
const nested = `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER REMOTEID="RAO-PROBE-INV-1" VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>20260805</DATE>
        <EFFECTIVEDATE>20260805</EFFECTIVEDATE>
        <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
        <PARTYLEDGERNAME>RAO Probe Supplier</PARTYLEDGERNAME>
        <NARRATION>RAO inventory probe - nested accounting allocation</NARRATION>
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>RAO Stock Widget</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <RATE>100/Nos</RATE>
          <AMOUNT>-1000.00</AMOUNT>
          <ACTUALQTY>10 Nos</ACTUALQTY>
          <BILLEDQTY>10 Nos</BILLEDQTY>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>RAO Probe Purchase</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-1000.00</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>RAO Probe Supplier</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>1000.00</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`;
if ((await step("PURCHASE, inventory + nested allocation", vch(nested))).ok)
  posted.push("RAO-PROBE-INV-1");

/**
 * Two items and a tax ledger, which is the real invoice shape: the tax ledger
 * IS a sibling ALLLEDGERENTRIES, only the stock-bearing ledger moves inside.
 * 10@100 + 5@200 = 2000 taxable, 18% = 360, party 2360.
 */
const twoItems = `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER REMOTEID="RAO-PROBE-INV-2" VCHTYPE="Purchase" ACTION="Create" OBJVIEW="Invoice Voucher View">
        <DATE>20260805</DATE>
        <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
        <PARTYLEDGERNAME>RAO Probe Supplier</PARTYLEDGERNAME>
        <NARRATION>RAO inventory probe - two items plus tax</NARRATION>
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>RAO Stock Widget</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <RATE>100/Nos</RATE>
          <AMOUNT>-1000.00</AMOUNT>
          <ACTUALQTY>10 Nos</ACTUALQTY>
          <BILLEDQTY>10 Nos</BILLEDQTY>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>RAO Probe Purchase</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-1000.00</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>
        <ALLINVENTORYENTRIES.LIST>
          <STOCKITEMNAME>RAO Stock Gizmo</STOCKITEMNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <RATE>200/Nos</RATE>
          <AMOUNT>-1000.00</AMOUNT>
          <ACTUALQTY>5 Nos</ACTUALQTY>
          <BILLEDQTY>5 Nos</BILLEDQTY>
          <ACCOUNTINGALLOCATIONS.LIST>
            <LEDGERNAME>RAO Probe Purchase</LEDGERNAME>
            <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
            <AMOUNT>-1000.00</AMOUNT>
          </ACCOUNTINGALLOCATIONS.LIST>
        </ALLINVENTORYENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>RAO Probe Supplier</LEDGERNAME>
          <ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE>
          <AMOUNT>2000.00</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      </VOUCHER>
    </TALLYMESSAGE>`;
if ((await step("PURCHASE, two items", vch(twoItems))).ok) posted.push("RAO-PROBE-INV-2");

/**
 * The wrong shape, posted deliberately so the double-count can be seen rather
 * than argued about: the purchase ledger appears both nested AND as a sibling.
 */
const doubled = nested
  .replace("RAO-PROBE-INV-1", "RAO-PROBE-INV-3")
  .replace("nested accounting allocation", "DELIBERATELY DOUBLED")
  .replace(
    `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>RAO Probe Supplier</LEDGERNAME>`,
    `        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>RAO Probe Purchase</LEDGERNAME>
          <ISDEEMEDPOSITIVE>Yes</ISDEEMEDPOSITIVE>
          <AMOUNT>-1000.00</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>RAO Probe Supplier</LEDGERNAME>`
  )
  .replace("<AMOUNT>1000.00</AMOUNT>", "<AMOUNT>2000.00</AMOUNT>");
if ((await step("PURCHASE, ledger nested AND sibling (bad)", vch(doubled))).ok)
  posted.push("RAO-PROBE-INV-3");

/** An item Tally has never heard of — does it reject, or auto-create? */
const unknownItem = nested
  .replace("RAO-PROBE-INV-1", "RAO-PROBE-INV-4")
  .replace(/RAO Stock Widget/g, "RAO Stock Nonexistent");
const r4 = await step("PURCHASE naming an unknown stock item", vch(unknownItem));
if (r4.ok) posted.push("RAO-PROBE-INV-4");

/* ---------------------------------------------------------- 3. read back */

console.log("\n--- what the books say ---");

const q = `<ENVELOPE>
  <HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>RaoProbeItems</ID></HEADER>
  <BODY><DESC>
    <STATICVARIABLES>
      <SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>
      <SVCURRENTCOMPANY>${COMPANY}</SVCURRENTCOMPANY>
    </STATICVARIABLES>
    <TDL><TDLMESSAGE>
      <COLLECTION NAME="RaoProbeItems" ISMODIFY="No">
        <TYPE>StockItem</TYPE>
        <NATIVEMETHOD>Name</NATIVEMETHOD>
        <NATIVEMETHOD>BaseUnits</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingBalance</NATIVEMETHOD>
        <NATIVEMETHOD>ClosingValue</NATIVEMETHOD>
        <NATIVEMETHOD>HSNCode</NATIVEMETHOD>
      </COLLECTION>
    </TDLMESSAGE></TDL>
  </DESC></BODY>
</ENVELOPE>`;

const res = await fetch(`http://${gateway.host}:${gateway.port}`, {
  method: "POST",
  headers: { "Content-Type": "text/xml" },
  body: q,
});
const body = await res.text();
for (const m of body.matchAll(/<STOCKITEM NAME="([^"]*)"[^>]*>([\s\S]*?)<\/STOCKITEM>/g)) {
  const name = m[1].replace(/&#\d+;/g, "");
  if (!name.startsWith("RAO Probe")) continue;
  const get = (tag: string) =>
    (m[2].match(new RegExp(`<${tag}>([^<]*)</${tag}>`, "i")) ?? [])[1] ?? "";
  console.log(
    `  ${name.padEnd(24)} units=${get("BASEUNITS").padEnd(5)} ` +
      `qty=${get("CLOSINGBALANCE").padEnd(12)} value=${get("CLOSINGVALUE").padEnd(14)} hsn=${get("HSNCODE")}`
  );
}

/* ------------------------------------------------------------ 4. cleanup */

console.log("\n--- cleanup ---");
for (const id of posted) {
  await step(
    `delete ${id}`,
    vch(`
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
      <VOUCHER REMOTEID="${id}" VCHTYPE="Purchase" ACTION="Delete">
        <VOUCHERTYPENAME>Purchase</VOUCHERTYPENAME>
      </VOUCHER>
    </TALLYMESSAGE>`)
  );
}
console.log(
  "\nMasters (units, stock items, ledgers) are left in place -- deleting a stock\n" +
    "item with movement is refused by Tally anyway, and they are harmless."
);
