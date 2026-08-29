/**
 * Parse Tally's reply to an Import Data request.
 *
 * This is what closes the loop. Today an export ends at EXPORTED_DEMO, which
 * only means "we generated a file" — nothing ever confirms Tally accepted it,
 * and POSTED is a status the codebase never sets. Tally does answer, and its
 * answer is the difference between "sent" and "in the books".
 *
 * A successful import replies with a flat counter block:
 *
 *   <RESPONSE>
 *     <CREATED>1</CREATED><ALTERED>0</ALTERED><DELETED>0</DELETED>
 *     <LASTVCHID>12</LASTVCHID><LASTMID>0</LASTMID><COMBINED>0</COMBINED>
 *     <IGNORED>0</IGNORED><ERRORS>0</ERRORS><CANCELLED>0</CANCELLED>
 *     <EXCEPTIONS>0</EXCEPTIONS>
 *   </RESPONSE>
 *
 * A rejection carries one or more <LINEERROR> elements instead, holding the
 * same text a user would otherwise have to dig out of Tally.imp by hand.
 *
 * The shapes are flat and the payloads small, so this reads them with regexes
 * rather than pulling in an XML parser. It is deliberately tolerant: an
 * unrecognised body is reported as a failure with the raw text attached, never
 * thrown, because a caller mid-push needs a verdict rather than an exception.
 */

export interface TallyImportResult {
  /** Tally accepted the payload and actually wrote something. */
  ok: boolean;
  created: number;
  altered: number;
  deleted: number;
  ignored: number;
  combined: number;
  cancelled: number;
  errors: number;
  exceptions: number;
  /** Tally's internal id for the last voucher written, when reported. */
  lastVoucherId: string | null;
  /** Human-readable rejection reasons, in the order Tally listed them. */
  lineErrors: string[];
  raw: string;
}

function countOf(xml: string, tag: string): number {
  const m = xml.match(new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`, "i"));
  return m ? Number(m[1]) : 0;
}

function decode(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function lineErrorsOf(xml: string): string[] {
  const out: string[] = [];
  const re = /<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const text = decode(m[1]);
    if (text) out.push(text);
  }
  return out;
}

export function parseTallyImportResponse(xml: string): TallyImportResult {
  const raw = xml ?? "";

  const empty: TallyImportResult = {
    ok: false,
    created: 0,
    altered: 0,
    deleted: 0,
    ignored: 0,
    combined: 0,
    cancelled: 0,
    errors: 0,
    exceptions: 0,
    lastVoucherId: null,
    lineErrors: [],
    raw,
  };

  if (!raw.trim()) {
    return {
      ...empty,
      lineErrors: ["Tally returned an empty response."],
    };
  }

  const lineErrors = lineErrorsOf(raw);
  const hasCounters = /<(CREATED|ALTERED|ERRORS|EXCEPTIONS)>/i.test(raw);

  // Neither a counter block nor a line error: this is not a Tally reply at all
  // (a proxy error page, an HTML login screen, a truncated body).
  if (!hasCounters && lineErrors.length === 0) {
    return {
      ...empty,
      lineErrors: [
        `Unrecognised response from Tally: ${decode(raw).slice(0, 300)}`,
      ],
    };
  }

  const created = countOf(raw, "CREATED");
  const altered = countOf(raw, "ALTERED");
  const errors = countOf(raw, "ERRORS");
  const exceptions = countOf(raw, "EXCEPTIONS");

  const lastVchMatch = raw.match(/<LASTVCHID>\s*(\d+)\s*<\/LASTVCHID>/i);
  const lastVoucherId = lastVchMatch && lastVchMatch[1] !== "0" ? lastVchMatch[1] : null;

  const wroteSomething = created + altered > 0;
  const clean = errors === 0 && exceptions === 0 && lineErrors.length === 0;

  return {
    ok: clean && wroteSomething,
    created,
    altered,
    deleted: countOf(raw, "DELETED"),
    ignored: countOf(raw, "IGNORED"),
    combined: countOf(raw, "COMBINED"),
    cancelled: countOf(raw, "CANCELLED"),
    errors,
    exceptions,
    lastVoucherId,
    lineErrors,
    raw,
  };
}

/** One-line summary suitable for a toast or an audit row. */
export function describeImportResult(r: TallyImportResult): string {
  if (r.ok) {
    const parts = [];
    if (r.created) parts.push(`${r.created} created`);
    if (r.altered) parts.push(`${r.altered} updated`);
    if (r.ignored) parts.push(`${r.ignored} ignored`);
    return `Tally accepted the import — ${parts.join(", ")}.`;
  }
  if (r.lineErrors.length) return r.lineErrors[0];
  if (r.errors || r.exceptions) {
    return `Tally reported ${r.errors} error(s) and ${r.exceptions} exception(s). Check All Exceptions (Alt+Y → All Exceptions) or Tally.imp for detail.`;
  }
  return "Tally wrote nothing. Check that the company is open and the voucher dates fall inside its book period.";
}
