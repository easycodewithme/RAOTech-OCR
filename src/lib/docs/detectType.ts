/**
 * Lightweight client-side document type detection for the prototype.
 * Backend can override later via Vision classification.
 */
export type DetectedDocType = "invoice" | "bank" | "receipt" | "credit_note" | "debit_note";

export function detectDocumentType(opts: {
  fileName?: string;
  extracted?: Record<string, any> | null;
}): DetectedDocType {
  const name = (opts.fileName || "").toLowerCase();
  const data = opts.extracted || {};

  if (
    name.includes("bank") ||
    name.includes("statement") ||
    name.includes("passbook") ||
    Array.isArray(data.transactions)
  ) {
    return "bank";
  }

  const blob = JSON.stringify(data).toLowerCase();
  if (blob.includes("credit note") || name.includes("credit") || name.includes("_cn")) {
    return "credit_note";
  }
  if (blob.includes("debit note") || name.includes("debit") || name.includes("_dn")) {
    return "debit_note";
  }
  if (name.includes("receipt") || blob.includes("cash receipt")) {
    return "receipt";
  }
  return "invoice";
}

export function detectedToDocumentType(d: DetectedDocType): string {
  switch (d) {
    case "bank":
      return "BANK";
    case "credit_note":
      return "CREDIT_NOTE";
    case "debit_note":
      return "DEBIT_NOTE";
    case "receipt":
      return "RECEIPT";
    default:
      return "PURCHASE";
  }
}
