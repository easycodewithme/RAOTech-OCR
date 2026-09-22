"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  UploadCloud,
  Loader2,
  Save,
  CheckCircle2,
  XCircle,
  Clock,
  FileText,
  AlertTriangle,
  ImageIcon,
  FileUp,
  ArrowRight,
  History,
  Plus,
  Building2,
} from "lucide-react";
import { detectDocumentType, detectedToDocumentType } from "@/lib/docs/detectType";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { registerUnsavedWork } from "@/components/ClientSwitcher";
import { formatCount, formatMoney } from "@/lib/format";

type ExtractedData = Record<string, any>;
type GSTValidation = {
  is_valid_invoice?: boolean;
  vendor_valid?: boolean;
  vendor_state?: string;
  vendor_message?: string;
  customer_valid?: boolean;
  customer_state?: string;
  customer_message?: string;
};

type LedgerSuggestion = {
  ledgerId: string;
  ledgerName: string;
  via: string;
};

type UploadDoc = {
  id: string;
  file: File;
  previewUrl: string | null;
  extractedData: ExtractedData | null;
  gstValidation: GSTValidation | null;
  processingTime: number | null;
  ocrEngine: string | null;
  error: string | null;
  extracting: boolean;
  saving: boolean;
  saved: boolean;
  // "Similar party" prompt shown after extraction
  ledgerSuggestion: LedgerSuggestion | null;
  ledgerChoice: "previous" | "new" | null;
};

const VIA_LABEL: Record<string, string> = {
  GSTIN_MEMORY: "same GSTIN used before",
  NAME_MEMORY: "same name used before",
  FUZZY: "similar name used before",
  RULE: "matches a mapping rule",
};

const MAX_FILES = 15;
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.bmp,.tiff,.webp";

/** The workspace this batch is being filed under. */
type ActiveClient = { id: string; name: string };

/**
 * A save that has been asked for but not yet allowed to run.
 *
 * Stored as an intent rather than a captured callback: the guard can sit on
 * screen for as long as it takes someone to read it, and a closure captured
 * before the dialog opened would be holding a `documents` array from before
 * whatever they did while thinking about it.
 */
type SaveIntent =
  | { kind: "all" }
  | { kind: "invoice"; docId: string }
  | { kind: "bank"; docId: string }
  | { kind: "duplicate"; docId: string };

/**
 * How often the page re-reads which client is active while a batch is open.
 *
 * The active client can be changed from the topbar on this very screen, and
 * from another tab, and neither tells us. Fifteen seconds is short enough that
 * nobody finishes typing over a batch before the banner corrects itself, and
 * the endpoint is served from the server's in-process client-list cache, so

/**
 * OCR hands back whatever it read — a number, a string, sometimes nothing.
 * Parsing is this screen's problem; how a rupee amount is written is not, so
 * everything goes through the one shared formatter and the em dash it returns
 * for a value it cannot render.
 */
function money(value: unknown): string {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? formatMoney(n) : "—";
}

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentsRef = useRef<UploadDoc[]>([]);
  const [documents, setDocuments] = useState<UploadDoc[]>([]);
  const [extractingAll, setExtractingAll] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [docType, setDocType] = useState<"invoice" | "bank">("invoice");
  const [autoDetected, setAutoDetected] = useState<string | null>(null);
  const [classifying, setClassifying] = useState(false);
  const [pendingDuplicate, setPendingDuplicate] = useState<{
    docId: string;
    duplicateOfId: string | null;
  } | null>(null);

  /* ------------------------------------------------- which client, exactly */

  /**
   * Whose books these documents go into is decided by the server at save time,
   * from the workspace's active client — never by anything sent from here. For
   * two minutes of OCR this screen had no idea which client that was, and a
   * switch in the topbar mid-batch silently re-pointed "Save All" at another
   * company's ledgers. Three pieces of state close that:
   *
   *   activeClient — what the server would use if we saved right now.
   *   batchClient  — what it was when this batch started. The promise on screen.
   *   clientGuard  — a save held back because those two have diverged.
   */
  const [activeClient, setActiveClient] = useState<ActiveClient | null>(null);
  const [batchClient, setBatchClient] = useState<ActiveClient | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [clientGuard, setClientGuard] = useState<{
    intent: SaveIntent;
    current: ActiveClient | null;
  } | null>(null);
  const [switchingBack, setSwitchingBack] = useState(false);

  const extractedCount = useMemo(
    () => documents.filter((doc) => !!doc.extractedData).length,
    [documents]
  );

  const savedCount = useMemo(
    () => documents.filter((doc) => doc.saved).length,
    [documents]
  );

  // First extracted doc whose party matched a prior ledger and still awaits a
  // reuse/create decision — drives the popup (shown one at a time).
  const pendingSuggestionDoc = useMemo(
    () => documents.find((doc) => doc.ledgerSuggestion && !doc.ledgerChoice) ?? null,
    [documents]
  );

  /**
   * Documents that exist only in this tab: extracted (so OCR time has been
   * spent on them) but not written anywhere, or mid-flight right now. This is
   * what a client switch or a closed tab would throw away.
   */
  const unsavedCount = useMemo(
    () =>
      documents.filter(
        (doc) => (!!doc.extractedData && !doc.saved) || doc.extracting || doc.saving
      ).length,
    [documents]
  );

  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  useEffect(() => {
    return () => {
      documentsRef.current.forEach((doc) => {
        if (doc.previewUrl) URL.revokeObjectURL(doc.previewUrl);
      });
    };
  }, []);

  /** The active client as the server sees it. Null on any failure — a guess
   *  here is worse than an admission, because the whole point is to be right
   *  about which company we are naming. */
  const readActiveClient = useCallback(async (): Promise<ActiveClient | null> => {
    try {
      const res = await fetch("/api/clients", { cache: "no-store" });
      if (!res.ok) return null;
      const data = await res.json();
      const match = (data.clients ?? []).find(
        (c: { id: string }) => c.id === data.activeClientId
      );
      return match ? { id: match.id, name: match.name } : null;
    } catch {
      return null;
    }
  }, []);

  // Read active client on mount, and re-sync on window focus (e.g. returning from another tab)
  useEffect(() => {
    let alive = true;
    async function sync() {
      const next = await readActiveClient();
      if (!alive) return;
      setActiveClient(next);
      setClientError(next ? null : "Could not read which client is active.");
    }
    void sync();
    window.addEventListener("focus", sync);
    return () => {
      alive = false;
      window.removeEventListener("focus", sync);
    };
  }, [readActiveClient]);

  // Pin the client the moment a batch starts, and let go once the batch is
  // gone. Pinning here rather than inside addFiles covers the case where the
  // first read of /api/clients has not landed yet when the files are dropped.
  useEffect(() => {
    if (!documents.length) {
      if (batchClient) setBatchClient(null);
      return;
    }
    if (!batchClient && activeClient) setBatchClient(activeClient);
  }, [documents.length, batchClient, activeClient]);

  /**
   * Tell the client switcher there is something to lose, and the browser too.
   *
   * Registered only while something is actually unsaved, so a clean screen
   * never makes anyone dismiss a prompt, and torn down in the effect's own
   * cleanup so neither registration can outlive the state it speaks for.
   */
  useEffect(() => {
    if (!unsavedCount) return;
    const noun = docType === "bank" ? "bank statement" : "invoice";
    const describe = () =>
      `${unsavedCount} extracted ${noun}${unsavedCount === 1 ? "" : "s"} on the upload screen ${unsavedCount === 1 ? "has" : "have"} not been saved`;
    const unregister = registerUnsavedWork(describe);
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Older browsers only show the prompt if returnValue is set; the string
      // itself has been ignored by every browser for years.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [unsavedCount, docType]);

  /** The batch was started for one client and another is active now. */
  const clientDrifted =
    !!batchClient && !!activeClient && batchClient.id !== activeClient.id;

  const addFiles = async (incomingFiles: File[]) => {
    if (!incomingFiles.length) return;

    // Filename heuristic first (instant)
    const guess = detectDocumentType({ fileName: incomingFiles[0].name });
    if (guess === "bank") {
      setDocType("bank");
      setAutoDetected("Bank statement (from filename)");
    } else {
      setDocType("invoice");
      setAutoDetected(
        guess === "credit_note"
          ? "Credit note (from filename)"
          : guess === "debit_note"
            ? "Debit note (from filename)"
            : "Invoice (from filename) — refining with OCR…"
      );
    }

    const supported = incomingFiles.filter(
      (f) => f.type.startsWith("image/") || f.type === "application/pdf"
    );
    const allowed = supported.filter((f) => f.size <= MAX_FILE_SIZE_BYTES);
    const unsupportedCount = incomingFiles.length - supported.length;
    const oversizedCount = supported.length - allowed.length;

    if (!allowed.length) {
      if (unsupportedCount > 0 && oversizedCount > 0) {
        setError(
          `Only PDF/image files are supported and each file must be <= ${MAX_FILE_SIZE_MB}MB.`
        );
      } else if (unsupportedCount > 0) {
        setError("Only PDF and image files are supported.");
      } else {
        setError(`Each file must be <= ${MAX_FILE_SIZE_MB}MB.`);
      }
      return;
    }

    const warnings: string[] = [];
    if (unsupportedCount > 0) {
      warnings.push(`${unsupportedCount} unsupported file(s) skipped`);
    }
    if (oversizedCount > 0) {
      warnings.push(`${oversizedCount} oversized file(s) skipped (max ${MAX_FILE_SIZE_MB}MB)`);
    }

    setDocuments((prev) => {
      const availableSlots = MAX_FILES - prev.length;
      if (availableSlots <= 0) {
        setError(`You can upload a maximum of ${MAX_FILES} documents.`);
        return prev;
      }

      const filesToAdd = allowed.slice(0, availableSlots);
      if (allowed.length > availableSlots) {
        warnings.push(`Only first ${availableSlots} file(s) were added due to ${MAX_FILES} document limit`);
      }

      setError(warnings.length ? warnings.join(". ") + "." : null);

      const nextDocs = filesToAdd.map((file, idx) => ({
        id: `${file.name}-${file.size}-${Date.now()}-${idx}`,
        file,
        previewUrl: URL.createObjectURL(file),
        extractedData: null,
        gstValidation: null,
        processingTime: null,
        ocrEngine: null,
        error: null,
        extracting: false,
        saving: false,
        saved: false,
        ledgerSuggestion: null,
        ledgerChoice: null,
      }));

      return [...prev, ...nextDocs];
    });

    // Vision classify first file (async refine)
    void classifyFirstFile(allowed[0]);
  };

  const classifyFirstFile = async (file: File) => {
    setClassifying(true);
    try {
      const data = new FormData();
      data.append("file", file);
      const res = await fetch("/api/classify-doc", { method: "POST", body: data });
      const json = await res.json();
      if (!res.ok) return;
      const t = json.doc_type as string;
      const conf = Math.round((json.confidence || 0) * 100);
      const src = json.source === "ocr" ? "OCR" : "filename";
      if (t === "bank") {
        setDocType("bank");
        setAutoDetected(`Bank statement (${src}, ${conf}% conf)`);
      } else {
        setDocType("invoice");
        setAutoDetected(
          `${String(t).replace("_", " ")} (${src}, ${conf}% conf)`
        );
      }
    } catch {
      /* keep filename guess */
    } finally {
      setClassifying(false);
    }
  };

  const removeDocument = (id: string) => {
    setDocuments((prev) => {
      const docToRemove = prev.find((doc) => doc.id === id);
      if (docToRemove?.previewUrl) {
        URL.revokeObjectURL(docToRemove.previewUrl);
      }
      return prev.filter((doc) => doc.id !== id);
    });
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFiles = Array.from(e.dataTransfer.files);
    addFiles(droppedFiles);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const extractSingle = async (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc) return;

    setDocuments((prev) =>
      prev.map((d) =>
        d.id === id
          ? {
              ...d,
              extracting: true,
              error: null,
              extractedData: null,
              saved: false,
              ledgerSuggestion: null,
              ledgerChoice: null,
            }
          : d
      )
    );

    const data = new FormData();
    data.append("file", doc.file);

    try {
      const endpoint = docType === "bank" ? "/api/process-bank" : "/api/process-invoice";
      const res = await fetch(endpoint, { method: "POST", body: data });
      const json = await res.json();

      if (!res.ok || json.error) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, error: json.error || "Extraction failed", extracting: false } : d))
        );
        return;
      }

      const extracted = json.data || json;
      // Refine type from extracted content
      const refined = detectDocumentType({ fileName: doc.file.name, extracted });
      if (refined === "bank") setDocType("bank");
      setAutoDetected(`Detected: ${refined.replace("_", " ")}`);

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                extractedData: extracted,
                gstValidation: json.gst_validation || null,
                processingTime: json.processing_time || null,
                ocrEngine: json.ocr_engine || null,
                extracting: false,
                error: null,
              }
            : d
        )
      );

      // Invoices only: check whether this party was mapped before and, if so,
      // prompt the user to reuse that ledger or create a new one.
      if (docType === "invoice") {
        void fetchLedgerSuggestion(id, extracted);
      }
    } catch {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                extracting: false,
                error: "Failed to connect to server. Make sure OCR backend is running.",
              }
            : d
        )
      );
    }
  };

  // Ask the backend whether this vendor was mapped to a ledger before.
  const fetchLedgerSuggestion = async (id: string, extracted: ExtractedData) => {
    try {
      const res = await fetch("/api/ledgers/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          vendor: extracted?.vendor ?? null,
          vendorGstin: extracted?.vendor_gstin ?? null,
        }),
      });
      if (!res.ok) return;
      const json = await res.json();
      if (json?.match) {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === id && !d.ledgerChoice
              ? { ...d, ledgerSuggestion: json.match as LedgerSuggestion }
              : d
          )
        );
      }
    } catch {
      /* suggestion is best-effort — never block the flow */
    }
  };

  // Record the user's answer to the "reuse ledger?" popup.
  const resolveLedgerChoice = (id: string, choice: "previous" | "new") => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, ledgerChoice: choice } : d))
    );
  };

  const handleExtractAll = async () => {
    if (!documents.length) return;
    setExtractingAll(true);
    setError(null);
    for (const doc of documents) {
      await extractSingle(doc.id);
    }
    setExtractingAll(false);
  };

  const handleFieldChange = (id: string, key: string, value: any) => {
    setDocuments((prev) =>
      prev.map((doc) => {
        if (doc.id !== id || !doc.extractedData) return doc;
        return {
          ...doc,
          extractedData: {
            ...doc.extractedData,
            [key]: value,
          },
          saved: false,
        };
      })
    );
  };

  const saveSingle = async (
    id: string,
    opts?: { allowDuplicate?: boolean }
  ): Promise<{ voucherId: string | null } | null> => {
    const doc = documents.find((d) => d.id === id);
    if (!doc?.extractedData) return null;

    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, saving: true, error: null } : d)));

    try {
      const res = await fetch("/api/invoices/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extractedData: doc.extractedData,
          gstValidation: doc.gstValidation,
          fileName: doc.file.name || "invoice",
          processingTime: doc.processingTime,
          ocrEngine: doc.ocrEngine,
          documentType: detectedToDocumentType(
            detectDocumentType({ fileName: doc.file.name, extracted: doc.extractedData })
          ),
          partyLedgerId:
            doc.ledgerChoice === "previous" ? doc.ledgerSuggestion?.ledgerId ?? null : null,
          forceNewParty: doc.ledgerChoice === "new",
          allowDuplicate: !!opts?.allowDuplicate,
        }),
      });

      const json = await res.json().catch(() => ({}));

      if (res.status === 409 && json.code === "DUPLICATE_INVOICE") {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, saving: false } : d))
        );
        setPendingDuplicate({ docId: id, duplicateOfId: json.duplicateOfId ?? null });
        return null;
      }

      if (res.ok) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, saving: false, saved: true, error: null } : d))
        );
        return { voucherId: json.voucherId ?? null };
      } else {
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, saving: false, saved: false, error: `Failed to save: ${json.error || "Unknown error"}` }
              : d
          )
        );
        return null;
      }
    } catch {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, saving: false, saved: false, error: "Error saving invoice." } : d
        )
      );
      return null;
    }
  };

  const runSaveDuplicate = async (docId: string) => {
    const result = await saveSingle(docId, { allowDuplicate: true });
    if (result?.voucherId) router.push(`/vouchers/${result.voucherId}`);
  };

  // Save a single document and jump straight to its ledger-mapping screen
  const runSaveAndMap = async (id: string) => {
    const result = await saveSingle(id);
    if (result?.voucherId) {
      router.push(`/vouchers/${result.voucherId}`);
    } else if (result) {
      router.push("/transactions");
    }
  };

  // Bank statement: save the extracted transactions and open its mapping screen
  const runSaveBankAndMap = async (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc?.extractedData) return;
    setDocuments((prev) => prev.map((d) => (d.id === id ? { ...d, saving: true, error: null } : d)));
    try {
      const res = await fetch("/api/bank-statements", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileName: doc.file.name || "bank-statement", data: doc.extractedData }),
      });
      const json = await res.json();
      if (res.ok && json.statementId) {
        router.push(`/bank/${json.statementId}`);
      } else {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, saving: false, error: json.error || "Failed to save" } : d))
        );
      }
    } catch {
      setDocuments((prev) =>
        prev.map((d) => (d.id === id ? { ...d, saving: false, error: "Error saving statement." } : d))
      );
    }
  };

  const runSaveAll = async () => {
    if (!documents.length) {
      setError("Add documents before saving.");
      return;
    }

    if (documents.some((doc) => !doc.extractedData)) {
      setError("Extract all documents before Save All.");
      return;
    }

    const readyToSave = documents.filter((doc) => !!doc.extractedData && !doc.saved);
    if (!readyToSave.length) {
      setError("All extracted documents are already saved.");
      return;
    }

    setSavingAll(true);
    setError(null);

    let failed = 0;
    for (const doc of readyToSave) {
      const ok = await saveSingle(doc.id);
      if (!ok) failed += 1;
    }

    setSavingAll(false);

    if (failed === 0) {
      router.push("/transactions");
    } else {
      setError(`${failed} document(s) failed to save. Fix errors and try again.`);
    }
  };

  const runIntent = async (intent: SaveIntent) => {
    if (intent.kind === "all") return runSaveAll();
    if (intent.kind === "bank") return runSaveBankAndMap(intent.docId);
    if (intent.kind === "duplicate") return runSaveDuplicate(intent.docId);
    return runSaveAndMap(intent.docId);
  };

  /**
   * The only way a save starts on this screen.
   *
   * `/api/invoices/save` resolves the client itself, from the workspace, at
   * the moment it runs — so the only check worth making is the one made
   * immediately before the request, against the same source the route will
   * read. A value cached when the files were dropped would prove nothing.
   *
   * When that read fails we refuse rather than proceed: an unverifiable save
   * is the exact case this guard exists for, and the recheck above puts the
   * screen right again within fifteen seconds without anyone reloading.
   */
  const requestSave = async (intent: SaveIntent) => {
    const current = await readActiveClient();
    setActiveClient(current);
    if (!current) {
      setClientError("Could not read which client is active.");
      setError(
        "Could not confirm which client these documents would be filed under. Nothing was saved — check your connection and try again."
      );
      return;
    }
    setClientError(null);
    if (batchClient && current.id !== batchClient.id) {
      setClientGuard({ intent, current });
      return;
    }
    if (!batchClient) setBatchClient(current);
    await runIntent(intent);
  };

  /**
   * Move the workspace's active client — the same write the topbar switcher
   * makes, because that setting is the only lever that decides where a save
   * lands. Returns whether it took.
   */
  const switchWorkspaceTo = async (client: ActiveClient): Promise<boolean> => {
    setSwitchingBack(true);
    try {
      const res = await fetch("/api/clients", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      if (!res.ok) {
        setError(`Could not switch back to ${client.name}. Nothing was saved.`);
        return false;
      }
      setActiveClient(client);
      // The topbar switcher renders from server props; without this it would
      // keep showing the client we just moved away from.
      router.refresh();
      return true;
    } catch {
      setError(`Could not switch back to ${client.name}. Nothing was saved.`);
      return false;
    } finally {
      setSwitchingBack(false);
    }
  };

  /** Banner action: put the workspace back, no save attached. */
  const switchBackToBatchClient = async () => {
    if (!batchClient) return;
    await switchWorkspaceTo(batchClient);
  };

  /** Dialog action: put the workspace back, then run the save that was held. */
  const switchBackAndSave = async () => {
    if (!clientGuard || !batchClient) return;
    if (!(await switchWorkspaceTo(batchClient))) return;
    const { intent } = clientGuard;
    setClientGuard(null);
    await runIntent(intent);
  };

  /** The deliberate other answer: re-pin the batch to whoever is active now. */
  const refileUnderActive = async () => {
    if (!clientGuard?.current) return;
    const { intent, current } = clientGuard;
    setBatchClient(current);
    setClientGuard(null);
    await runIntent(intent);
  };

  return (
    // p-4 below 640px: 32px of gutter on a 375px screen left the line-item
    // table and the amount grid with nowhere to go.
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8" style={{ background: "var(--spx-canvas)" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2
            className="font-bold uppercase text-[var(--spx-text)]"
            style={{ fontSize: "22px", letterSpacing: "2px", fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif" }}
          >
            Upload &amp; Extract {docType === "bank" ? "Bank Statements" : "Invoices"}
          </h2>
          <p
            className="mt-1"
            style={{ fontSize: "11px", letterSpacing: "1.5px", color: "var(--spx-muted)", textTransform: "uppercase" as const }}
          >
            AI ingestion &amp; OCR extraction pipeline
          </p>
        </div>
        <div
          role="radiogroup"
          aria-label="Document type"
          className="flex overflow-hidden text-sm"
          style={{ border: "1px solid var(--spx-border)" }}
        >
          {([["invoice", "Invoice"], ["bank", "Bank Statement"]] as const).map(([val, label]) => (
            <button
              key={val}
              type="button"
              role="radio"
              aria-checked={docType === val}
              onClick={() => {
                setDocType(val);
                setAutoDetected(null);
              }}
              className="min-h-11 cursor-pointer uppercase transition-colors duration-150 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
              style={{
                padding: "9px 18px",
                fontSize: "11px",
                letterSpacing: "1.2px",
                fontWeight: 500,
                background: docType === val ? "var(--spx-text)" : "transparent",
                color: docType === val ? "var(--spx-canvas)" : "var(--spx-muted)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* UX-03: which company's books these documents are going into, named on
          screen for the whole life of the batch. It is the one fact the save
          depends on and the one fact the screen never used to state. */}
      <ClientBanner
        batchClient={batchClient}
        activeClient={activeClient}
        drifted={clientDrifted}
        error={clientError}
        batchSize={documents.length}
        busy={switchingBack}
        onSwitchBack={() => {
          // Put the workspace back and stop there. Nothing is saved from the
          // banner: the point of noticing early is to be able to carry on
          // working, not to be pushed into a save.
          if (batchClient) void switchBackToBatchClient();
        }}
        onAdopt={() => {
          if (activeClient) setBatchClient(activeClient);
        }}
      />

      {autoDetected && (
        <div
          className="flex items-center gap-2 text-sm"
          style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)", padding: "10px 14px", color: "var(--spx-text-secondary)" }}
        >
          {classifying && <Loader2 className="h-4 w-4 animate-spin shrink-0 text-[var(--spx-text)]" />}
          <span>
            <span className="text-[var(--spx-text)]">Auto-detected:</span> {autoDetected}{" "}
            <span style={{ color: "var(--spx-muted)" }}>(you can override with the toggle)</span>
          </span>
        </div>
      )}

      {/* Upload Area */}
      <div
        className="text-center transition-all cursor-pointer"
        style={{
          border: `1px dashed ${isDragging ? "var(--spx-text)" : "var(--spx-border)"}`,
          background: isDragging ? "var(--spx-input-bg)" : "var(--spx-card)",
          padding: "40px 32px",
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept={ACCEPTED_EXTENSIONS}
          className="hidden"
          onChange={(e) => {
            const selectedFiles = Array.from(e.target.files || []);
            addFiles(selectedFiles);
            e.currentTarget.value = "";
          }}
        />
        <UploadCloud className="mx-auto h-10 w-10 mb-4" style={{ color: "var(--spx-muted)" }} strokeWidth={1.5} />
        <p className="text-[var(--spx-text)]" style={{ fontSize: "15px", fontWeight: 500 }}>
          {documents.length
            ? `${documents.length} document(s) selected`
            : `Drag & drop up to ${MAX_FILES} files here`}
        </p>
        <p className="mt-1" style={{ fontSize: "12px", color: "var(--spx-muted)" }}>
          Supports PDF, JPG, PNG, BMP, TIFF, WEBP (max {MAX_FILE_SIZE_MB}MB each)
        </p>

        {/* The surrounding div takes a click for convenience, but a div is not
            reachable by keyboard and cannot carry a role while it also contains
            these buttons. This is the focusable way in. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            fileInputRef.current?.click();
          }}
          className="mt-4 inline-flex min-h-11 cursor-pointer items-center justify-center border border-[var(--spx-border)] px-4 text-[11px] font-semibold uppercase tracking-[1.2px] text-[var(--spx-text)] transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
        >
          Choose files
        </button>

        {documents.length > 0 && (
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            <span
              role="status"
              aria-live="polite"
              style={{ fontSize: "12px", color: "var(--spx-muted)" }}
            >
              Extracted {extractedCount}/{documents.length}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleExtractAll();
              }}
              disabled={extractingAll}
              className="inline-flex min-h-11 cursor-pointer items-center uppercase transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              style={{
                background: "var(--spx-text)",
                color: "var(--spx-canvas)",
                padding: "9px 18px",
                fontSize: "11px",
                letterSpacing: "1.2px",
                fontWeight: 600,
              }}
            >
              {extractingAll ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Extracting All...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Extract All
                </>
              )}
            </button>
            {docType === "invoice" && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  void requestSave({ kind: "all" });
                }}
                disabled={
                  savingAll ||
                  switchingBack ||
                  !documents.length ||
                  extractedCount !== documents.length ||
                  savedCount === documents.length
                }
                // Names the destination, so the button and the banner agree
                // even for someone reading only the control they are about to
                // press.
                title={batchClient ? `Save into ${batchClient.name}` : undefined}
                className="inline-flex min-h-11 cursor-pointer items-center uppercase transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                style={{
                  background: "transparent",
                  color: "var(--spx-text)",
                  border: "1px solid var(--spx-border)",
                  padding: "9px 18px",
                  fontSize: "11px",
                  letterSpacing: "1.2px",
                  fontWeight: 600,
                }}
              >
                {savingAll ? (
                  <>
                    <Loader2 className="animate-spin mr-2 h-4 w-4 motion-reduce:animate-none" />
                    Saving All...
                  </>
                ) : savedCount === documents.length ? (
                  <>
                    <CheckCircle2 className="mr-2 h-4 w-4" />
                    All Saved
                  </>
                ) : (
                  <>
                    <Save className="mr-2 h-4 w-4" />
                    {batchClient
                      ? `Save all into ${batchClient.name}`
                      : "Save All Invoices"}
                  </>
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div
          // Was a fixed pale red on a dark wash: unreadable against the white
          // card of the light theme. Per-theme now, both sides above 4.5:1.
          className="flex items-center gap-2 border border-red-300 bg-red-50 px-4 py-3 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          <XCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {documents.length > 0 && (
        // Every number here moves on its own as extraction and saving run.
        <div
          role="status"
          aria-live="polite"
          style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)", padding: "10px 14px", fontSize: "12px", color: "var(--spx-text-secondary)" }}
        >
          Added {formatCount(documents.length)}/{MAX_FILES} documents &middot; Extracted{" "}
          {formatCount(extractedCount)} &middot; Saved {formatCount(savedCount)}
          {batchClient ? ` · Filing into ${batchClient.name}` : ""}
        </div>
      )}

      {/* Results */}
      <div className="space-y-6">
        {documents.map((doc, docIndex) => (
          <div
            key={doc.id}
            className="space-y-4 animate-in fade-in motion-reduce:animate-none"
            style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)", padding: "24px" }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="flex items-center gap-2 text-[var(--spx-text)]" style={{ fontSize: "15px", fontWeight: 600 }}>
                  <FileUp className="h-4 w-4" style={{ color: "var(--spx-muted)" }} />
                  {docIndex + 1}. {doc.file.name}
                </h3>
                <p className="mt-1" style={{ fontSize: "11px", color: "var(--spx-muted)" }}>
                  {(doc.file.size / 1024 / 1024).toFixed(2)} MB
                </p>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                {/* Status chips: the old fixed pairs (#7dd3fc on #1e3a5f and so
                    on) were built for the dark card only and washed out on the
                    light one. Per-theme, and the same three tones the rest of
                    the app uses. */}
                {doc.ledgerChoice === "previous" && doc.ledgerSuggestion && (
                  <span className="inline-flex items-center gap-1 border border-sky-300 px-2.5 py-1 text-[10px] uppercase tracking-[0.8px] text-sky-800 dark:border-sky-900 dark:text-sky-300">
                    <History className="h-3 w-3" /> Reusing {doc.ledgerSuggestion.ledgerName}
                  </span>
                )}
                {doc.ledgerChoice === "new" && (
                  <span className="inline-flex items-center gap-1 border border-amber-400 px-2.5 py-1 text-[10px] uppercase tracking-[0.8px] text-amber-800 dark:border-amber-800 dark:text-amber-300">
                    <Plus className="h-3 w-3" /> New ledger
                  </span>
                )}
                {doc.saved && (
                  <span
                    role="status"
                    className="inline-flex items-center gap-1 border border-emerald-400 px-2.5 py-1 text-[10px] uppercase tracking-[0.8px] text-emerald-800 dark:border-emerald-800 dark:text-emerald-300"
                  >
                    <CheckCircle2 className="h-3 w-3" /> Saved
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => extractSingle(doc.id)}
                  disabled={doc.extracting}
                  aria-label={`${doc.extractedData ? "Re-extract" : "Extract"} ${doc.file.name}`}
                  className="inline-flex min-h-11 cursor-pointer items-center uppercase transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                  style={{ border: "1px solid var(--spx-border)", color: "var(--spx-text)", background: "transparent", padding: "8px 14px", fontSize: "11px", letterSpacing: "1px" }}
                >
                  {doc.extracting ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4 motion-reduce:animate-none" /> Extracting
                    </>
                  ) : (
                    <>
                      <FileText className="mr-2 h-4 w-4" /> {doc.extractedData ? "Re-extract" : "Extract"}
                    </>
                  )}
                </button>
                {doc.extractedData && (
                  <button
                    type="button"
                    onClick={() =>
                      void requestSave({
                        kind: docType === "bank" ? "bank" : "invoice",
                        docId: doc.id,
                      })
                    }
                    disabled={doc.saving || switchingBack}
                    aria-label={`Save ${doc.file.name}${batchClient ? ` into ${batchClient.name}` : ""} and map its ledgers`}
                    className="inline-flex min-h-11 cursor-pointer items-center uppercase transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
                    style={{ background: "var(--spx-text)", color: "var(--spx-canvas)", padding: "8px 14px", fontSize: "11px", letterSpacing: "1px", fontWeight: 600 }}
                  >
                    {doc.saving ? (
                      <>
                        <Loader2 className="animate-spin mr-2 h-4 w-4 motion-reduce:animate-none" /> Saving
                      </>
                    ) : (
                      <>
                        {docType === "bank" ? "Map Transactions" : "Map Ledgers"}{" "}
                        <ArrowRight className="ml-2 h-4 w-4" />
                      </>
                    )}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removeDocument(doc.id)}
                  aria-label={`Remove ${doc.file.name} from this batch`}
                  className="inline-flex min-h-11 cursor-pointer items-center uppercase transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] hover:text-[var(--spx-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
                  style={{ border: "1px solid var(--spx-border)", color: "var(--spx-muted)", background: "transparent", padding: "8px 14px", fontSize: "11px", letterSpacing: "1px" }}
                >
                  Remove
                </button>
              </div>
            </div>

            {doc.error && (
              <div
                className="flex items-center gap-2 border border-red-300 bg-red-50 px-3.5 py-2.5 text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300"
                role="alert"
              >
                <XCircle className="h-5 w-5 shrink-0" />
                <p className="text-sm">{doc.error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1" style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)", padding: "16px" }}>
                <h4
                  className="mb-3 flex items-center gap-1 uppercase"
                  style={{ fontSize: "11px", letterSpacing: "1.2px", color: "var(--spx-muted)" }}
                >
                  <ImageIcon className="h-3.5 w-3.5" /> Preview
                </h4>

                {doc.file.type === "application/pdf" && doc.previewUrl ? (
                  <iframe
                    src={doc.previewUrl}
                    title={`Preview ${doc.file.name}`}
                    className="w-full h-[420px]"
                    style={{ border: "1px solid var(--spx-border)" }}
                  />
                ) : doc.previewUrl ? (
                  <img
                    src={doc.previewUrl}
                    alt={doc.file.name}
                    className="w-full object-contain max-h-[420px]"
                    style={{ border: "1px solid var(--spx-border)" }}
                  />
                ) : (
                  <p style={{ fontSize: "12px", color: "var(--spx-muted)" }}>Preview not available</p>
                )}
              </div>

              <div className="lg:col-span-2" style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)", padding: "24px" }}>
                <div className="flex flex-wrap gap-3 items-center mb-6">
                  {doc.processingTime && (
                    <div
                      className="flex items-center gap-1 uppercase"
                      style={{ border: "1px solid var(--spx-border)", color: "var(--spx-text-secondary)", padding: "5px 12px", fontSize: "10px", letterSpacing: "0.8px" }}
                    >
                      <Clock className="h-3 w-3" />
                      {doc.processingTime.toFixed(1)}s
                    </div>
                  )}
                  {doc.ocrEngine && (
                    <div
                      className="uppercase"
                      style={{ border: "1px solid var(--spx-border)", color: "var(--spx-text-secondary)", padding: "5px 12px", fontSize: "10px", letterSpacing: "0.8px" }}
                    >
                      Model: {doc.ocrEngine}
                    </div>
                  )}
                  {doc.gstValidation && (
                    <div
                      className={`flex items-center gap-1 border px-3 py-[5px] text-[10px] uppercase tracking-[0.8px] ${
                        doc.gstValidation.is_valid_invoice
                          ? "border-emerald-400 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300"
                          : "border-amber-400 text-amber-800 dark:border-amber-800 dark:text-amber-300"
                      }`}
                    >
                      {doc.gstValidation.is_valid_invoice ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <AlertTriangle className="h-3 w-3" />
                      )}
                      GST {doc.gstValidation.is_valid_invoice ? "Valid" : "Warning"}
                      {doc.gstValidation.vendor_state && ` - ${doc.gstValidation.vendor_state}`}
                    </div>
                  )}
                </div>

                {doc.extractedData ? (
                  docType === "bank" ? (
                    <BankSummary data={doc.extractedData} />
                  ) : (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                      <Field label="Invoice Number" value={doc.extractedData.invoice_number} onChange={(v) => handleFieldChange(doc.id, "invoice_number", v)} />
                      <Field label="Date" value={doc.extractedData.date} onChange={(v) => handleFieldChange(doc.id, "date", v)} />
                      <Field label="Vendor" value={doc.extractedData.vendor} onChange={(v) => handleFieldChange(doc.id, "vendor", v)} />
                      <Field label="Vendor GSTIN" value={doc.extractedData.vendor_gstin} onChange={(v) => handleFieldChange(doc.id, "vendor_gstin", v)} />
                      <Field label="Vendor Address" value={doc.extractedData.vendor_address} onChange={(v) => handleFieldChange(doc.id, "vendor_address", v)} />
                      <Field label="Vendor Phone" value={doc.extractedData.vendor_phone} onChange={(v) => handleFieldChange(doc.id, "vendor_phone", v)} />
                      <Field label="Customer Name" value={doc.extractedData.customer_name} onChange={(v) => handleFieldChange(doc.id, "customer_name", v)} />
                      <Field label="Customer GSTIN" value={doc.extractedData.customer_gstin} onChange={(v) => handleFieldChange(doc.id, "customer_gstin", v)} />
                    </div>

                    {doc.extractedData.items && doc.extractedData.items.length > 0 && (
                      <div className="mb-6">
                        <h4 className="mb-3 uppercase" style={{ fontSize: "11px", letterSpacing: "1.2px", color: "var(--spx-muted)" }}>
                          Line Items
                        </h4>
                        <div className="overflow-x-auto" style={{ border: "1px solid var(--spx-border)" }}>
                          <table className="w-full text-sm">
                            <thead style={{ background: "var(--spx-input-bg)" }}>
                              <tr>
                                <th className="px-4 py-2 text-left uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>#</th>
                                <th className="px-4 py-2 text-left uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Description</th>
                                <th className="px-4 py-2 text-left uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>HSN</th>
                                <th className="px-4 py-2 text-right uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Qty</th>
                                <th className="px-4 py-2 text-right uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Rate</th>
                                <th className="px-4 py-2 text-right uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {doc.extractedData.items.map((item: any, i: number) => (
                                <tr key={i} style={{ borderTop: "1px solid var(--spx-border)" }}>
                                  <td className="px-4 py-2" style={{ color: "var(--spx-muted)" }}>{i + 1}</td>
                                  <td className="px-4 py-2 text-[var(--spx-text)] font-medium">{item.name || item.description || "-"}</td>
                                  <td className="px-4 py-2" style={{ color: "var(--spx-text-secondary)" }}>{item.hsn_code || "-"}</td>
                                  <td className="px-4 py-2 text-right" style={{ color: "var(--spx-text-secondary)" }}>{item.qty || "-"}</td>
                                  <td className="px-4 py-2 text-right" style={{ color: "var(--spx-text-secondary)" }}>{item.rate != null ? money(item.rate) : "-"}</td>
                                  <td className="px-4 py-2 text-right text-[var(--spx-text)] font-semibold">
                                    {item.price != null
                                      ? money(item.price)
                                      : item.amount != null
                                      ? money(item.amount)
                                      : "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="pt-4" style={{ borderTop: "1px solid var(--spx-border)" }}>
                      <h4 className="mb-3 uppercase" style={{ fontSize: "11px", letterSpacing: "1.2px", color: "var(--spx-muted)" }}>
                        Amounts &amp; Tax
                      </h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <AmountCard label="Subtotal" value={doc.extractedData.subtotal} />
                        {doc.extractedData.cgst != null && <AmountCard label="CGST" value={doc.extractedData.cgst} />}
                        {doc.extractedData.sgst != null && <AmountCard label="SGST" value={doc.extractedData.sgst} />}
                        {doc.extractedData.igst != null && <AmountCard label="IGST" value={doc.extractedData.igst} />}
                        <AmountCard label="Total Tax" value={doc.extractedData.tax} />
                        {doc.extractedData.discount != null && <AmountCard label="Discount" value={doc.extractedData.discount} />}
                        <AmountCard label="Grand Total" value={doc.extractedData.total_amount} highlight />
                      </div>
                    </div>

                    {doc.extractedData.amount_in_words && (
                      <div className="mt-4 text-sm italic" style={{ color: "var(--spx-muted)" }}>
                        Amount in words: {doc.extractedData.amount_in_words}
                      </div>
                    )}
                  </>
                  )
                ) : (
                  <div style={{ border: "1px dashed var(--spx-border)", background: "var(--spx-card)", padding: "20px", fontSize: "13px", color: "var(--spx-muted)" }}>
                    Extract this document to render editable fields.
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {pendingSuggestionDoc && pendingSuggestionDoc.ledgerSuggestion && (
        <LedgerReusePopup
          fileName={pendingSuggestionDoc.file.name}
          vendor={pendingSuggestionDoc.extractedData?.vendor || "this party"}
          suggestion={pendingSuggestionDoc.ledgerSuggestion}
          onReuse={() => resolveLedgerChoice(pendingSuggestionDoc.id, "previous")}
          onCreateNew={() => resolveLedgerChoice(pendingSuggestionDoc.id, "new")}
        />
      )}

      {/* This was a hand-rolled overlay with no role, no focus trap and no
          Escape, guarding a write to a client's books. ConfirmDialog already
          solved all three for the Tally screens. */}
      {pendingDuplicate && (
        <ConfirmDialog
          title="Possible duplicate"
          body={
            <>
              An invoice with the same number, vendor and amount already exists for{" "}
              <strong className="text-[var(--spx-text)]">
                {batchClient?.name ?? "this client"}
              </strong>
              . Saving again creates a second voucher, marked as a duplicate.
            </>
          }
          confirmLabel="Save anyway"
          onConfirm={() => {
            const { docId } = pendingDuplicate;
            setPendingDuplicate(null);
            // Back through the guard: this dialog can sit open for as long as
            // someone takes to check, and the active client can move under it.
            void requestSave({ kind: "duplicate", docId });
          }}
          onCancel={() => setPendingDuplicate(null)}
        />
      )}

      {clientGuard && batchClient && (
        <ConfirmDialog
          title={`These documents were started for ${batchClient.name}`}
          body={
            <>
              <p>
                The active client changed while this batch was open. Saving now would file{" "}
                <strong className="text-[var(--spx-text)]">
                  {formatCount(documents.filter((d) => !!d.extractedData && !d.saved).length)}
                </strong>{" "}
                document(s) into the wrong company&apos;s books.
              </p>
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 border border-[var(--spx-border)] bg-[var(--spx-input-bg)] p-3">
                <dt className="text-[var(--spx-muted)]">Batch started for</dt>
                <dd className="font-semibold text-[var(--spx-text)]">{batchClient.name}</dd>
                <dt className="text-[var(--spx-muted)]">Active now</dt>
                <dd className="font-semibold text-[var(--spx-text)]">
                  {clientGuard.current?.name ?? "unknown"}
                </dd>
              </dl>
              <button
                type="button"
                onClick={() => void refileUnderActive()}
                disabled={switchingBack || !clientGuard.current}
                className="mt-3 inline-flex min-h-11 w-full cursor-pointer items-center justify-center border border-[var(--spx-border)] px-3 text-xs font-semibold uppercase tracking-[1px] text-[var(--spx-text-secondary)] transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none"
              >
                File under {clientGuard.current?.name ?? "the active client"} instead
              </button>
            </>
          }
          confirmLabel={
            switchingBack ? "Switching back…" : `Switch back to ${batchClient.name} and save`
          }
          busy={switchingBack}
          onConfirm={() => void switchBackAndSave()}
          onCancel={() => setClientGuard(null)}
        />
      )}
    </div>
  );
}

/**
 * The client line. Permanent, at the top, above the drop zone — not a tooltip
 * and not a badge tucked beside the title, because it is the one fact that
 * decides whose books the next two minutes of work land in.
 *
 * It has three states, and the difference between them is the whole point:
 * naming the client while everything agrees; saying "still checking" rather
 * than guessing while the first read is in flight; and, when the active client
 * has moved out from under an open batch, saying both names and offering the
 * two answers instead of picking one silently.
 */
function ClientBanner({
  batchClient,
  activeClient,
  drifted,
  error,
  batchSize,
  busy,
  onSwitchBack,
  onAdopt,
}: {
  batchClient: ActiveClient | null;
  activeClient: ActiveClient | null;
  drifted: boolean;
  error: string | null;
  batchSize: number;
  busy: boolean;
  onSwitchBack: () => void;
  onAdopt: () => void;
}) {
  const named = batchClient ?? activeClient;

  return (
    // role="status" because this is read after mount and can change on its own
    // while someone is looking somewhere else on the page.
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-wrap items-center gap-x-3 gap-y-2 border p-3 sm:px-4 ${
        drifted
          ? "border-amber-400 bg-amber-50 dark:border-amber-500/50 dark:bg-amber-500/10"
          : "border-[var(--spx-border)] bg-[var(--spx-card)]"
      }`}
    >
      {drifted ? (
        <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
      ) : (
        <Building2 className="h-5 w-5 shrink-0 text-[var(--spx-muted)]" strokeWidth={1.5} />
      )}

      <div className="min-w-0 flex-1">
        <p
          className="uppercase"
          style={{ fontSize: "10px", letterSpacing: "1.2px", color: "var(--spx-muted)" }}
        >
          {batchSize > 0 ? "Filing into the books of" : "Documents will be filed into"}
        </p>
        <p
          className="truncate font-semibold text-[var(--spx-text)]"
          style={{ fontSize: "16px" }}
          title={named?.name}
        >
          {named?.name ?? (error ? "Unknown — could not read the active client" : "Checking…")}
        </p>
        {drifted && (
          <p className="mt-1 text-[13px] text-amber-800 dark:text-amber-200">
            The active client is now{" "}
            <strong>{activeClient?.name ?? "another client"}</strong>. Save without choosing and
            these {batchSize} document(s) go into <strong>{activeClient?.name}</strong>&apos;s
            books, not <strong>{batchClient?.name}</strong>&apos;s.
          </p>
        )}
        {!drifted && error && (
          <p className="mt-1 text-[13px] text-[var(--spx-text-secondary)]">
            {error} Saving is blocked until it can be confirmed.
          </p>
        )}
      </div>

      {drifted && (
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button
            type="button"
            onClick={onSwitchBack}
            disabled={busy}
            className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center whitespace-nowrap border border-amber-500 bg-amber-500 px-4 text-[11px] font-semibold uppercase tracking-[1px] text-amber-950 transition-colors duration-150 hover:bg-amber-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none sm:flex-none"
          >
            {busy ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" />
            ) : null}
            Back to {batchClient?.name}
          </button>
          <button
            type="button"
            onClick={onAdopt}
            disabled={busy}
            className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center whitespace-nowrap border border-amber-600/60 px-4 text-[11px] font-semibold uppercase tracking-[1px] text-amber-900 transition-colors duration-150 hover:bg-amber-500/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] disabled:cursor-not-allowed disabled:opacity-60 dark:text-amber-200 motion-reduce:transition-none sm:flex-none"
          >
            File under {activeClient?.name}
          </button>
        </div>
      )}
    </div>
  );
}

function LedgerReusePopup({
  fileName,
  vendor,
  suggestion,
  onReuse,
  onCreateNew,
}: {
  fileName: string;
  vendor: string;
  suggestion: LedgerSuggestion;
  onReuse: () => void;
  onCreateNew: () => void;
}) {
  const reason = VIA_LABEL[suggestion.via] || "matched from history";
  return (
    // Not a ConfirmDialog: both buttons are real answers and neither is a
    // cancel, so there is nothing for Escape or a backdrop click to mean.
    // Everything else that dialog does — the role, the label, the reduced-motion
    // opt-out — this needs just as much.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm animate-in fade-in motion-reduce:animate-none"
      style={{ background: "var(--spx-overlay)" }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Party seen before: ${vendor}`}
        className="w-full max-w-md animate-in zoom-in-95 duration-200 motion-reduce:animate-none motion-reduce:duration-0"
        style={{ background: "var(--spx-card)", border: "1px solid var(--spx-border)" }}
      >
        <div className="p-6">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center border border-sky-300 text-sky-700 dark:border-sky-900 dark:text-sky-300">
              <History className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h3 className="text-[var(--spx-text)]" style={{ fontSize: "16px", fontWeight: 700 }}>Party seen before</h3>
              <p className="mt-0.5 truncate" style={{ fontSize: "12px", color: "var(--spx-muted)" }}>{fileName}</p>
            </div>
          </div>

          <div className="mt-4 space-y-3 text-sm">
            <p style={{ color: "var(--spx-text-secondary)" }}>
              <span className="font-semibold text-[var(--spx-text)]">{vendor}</span> looks like a party you&apos;ve
              already mapped ({reason}).
            </p>
            <div className="border border-sky-300 bg-sky-50 px-4 py-3 dark:border-sky-900 dark:bg-sky-950/40">
              <p className="uppercase text-sky-800 dark:text-sky-300" style={{ fontSize: "10px", letterSpacing: "1px" }}>Previously used ledger</p>
              <p className="mt-0.5 text-[var(--spx-text)]" style={{ fontSize: "15px", fontWeight: 600 }}>
                {suggestion.ledgerName}
              </p>
            </div>
            <p style={{ color: "var(--spx-muted)" }}>
              Reuse this ledger for consistency, or create a new one for this invoice.
            </p>
          </div>
        </div>

        <div className="flex gap-3 p-4" style={{ borderTop: "1px solid var(--spx-border)" }}>
          <button
            type="button"
            className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center uppercase transition-colors duration-150 hover:bg-[var(--spx-hover-bg)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
            style={{ border: "1px solid var(--spx-border)", color: "var(--spx-text)", background: "transparent", padding: "10px", fontSize: "11px", letterSpacing: "1px" }}
            onClick={onCreateNew}
          >
            <Plus className="mr-2 h-4 w-4" /> Create new
          </button>
          <button
            type="button"
            className="inline-flex min-h-11 flex-1 cursor-pointer items-center justify-center uppercase transition-opacity duration-150 hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--spx-active-border)] motion-reduce:transition-none"
            style={{ background: "var(--spx-text)", color: "var(--spx-canvas)", padding: "10px", fontSize: "11px", letterSpacing: "1px", fontWeight: 600 }}
            onClick={onReuse}
            autoFocus
          >
            <CheckCircle2 className="mr-2 h-4 w-4" /> Use previous
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: any;
  onChange: (v: string) => void;
}) {
  if (value == null || value === "") return null;
  return (
    <div className="space-y-1">
      <Label className="uppercase" style={{ fontSize: "10px", letterSpacing: "1px", color: "var(--spx-muted)", fontWeight: 500 }}>{label}</Label>
      <Input
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="text-[var(--spx-text)]"
        style={{ background: "var(--spx-canvas)", border: "1px solid var(--spx-border)", borderRadius: 0 }}
      />
    </div>
  );
}

function AmountCard({
  label,
  value,
  highlight = false,
}: {
  label: string;
  value: any;
  highlight?: boolean;
}) {
  if (value == null) return null;

  return (
    <div
      className="p-3"
      style={{
        border: highlight ? "1px solid var(--spx-active-border)" : "1px solid var(--spx-border)",
        background: highlight ? "var(--spx-input-bg)" : "var(--spx-card)",
      }}
    >
      <p className="uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>{label}</p>
      {/* Was a hardcoded near-white, which is 1.2:1 on the light theme's white
          card. Both weights are token colours now. */}
      <p
        style={{
          fontSize: "16px",
          fontWeight: 700,
          color: highlight ? "var(--spx-text)" : "var(--spx-text-secondary)",
        }}
      >
        {money(value)}
      </p>
    </div>
  );
}

function BankSummary({ data }: { data: any }) {
  const txns: any[] = Array.isArray(data?.transactions) ? data.transactions : [];
  // A zero withdrawal on a deposit row is noise, not information, so an empty
  // cell rather than the em dash `money()` would give.
  const fmt = (n: any) => {
    const num = typeof n === "number" ? n : parseFloat(n);
    return !Number.isFinite(num) || num === 0 ? "" : formatMoney(num);
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        <span className="uppercase" style={{ border: "1px solid var(--spx-border)", color: "var(--spx-text-secondary)", padding: "5px 12px", fontSize: "10px", letterSpacing: "0.8px" }}>
          Bank: {data?.bank_name || "—"}
        </span>
        <span className="uppercase" style={{ border: "1px solid var(--spx-border)", color: "var(--spx-text-secondary)", padding: "5px 12px", fontSize: "10px", letterSpacing: "0.8px" }}>
          A/C: {data?.account_number || "—"}
        </span>
        <span className="border border-emerald-400 px-3 py-[5px] text-[10px] font-medium uppercase tracking-[0.8px] text-emerald-800 dark:border-emerald-800 dark:text-emerald-300">
          {txns.length} transactions
        </span>
      </div>
      <div className="overflow-auto max-h-80" style={{ border: "1px solid var(--spx-border)" }}>
        <table className="w-full text-sm">
          <thead className="sticky top-0" style={{ background: "var(--spx-input-bg)" }}>
            <tr>
              <th className="px-3 py-2 text-left uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Date</th>
              <th className="px-3 py-2 text-left uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Description</th>
              <th className="px-3 py-2 text-right uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Withdrawal</th>
              <th className="px-3 py-2 text-right uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Deposit</th>
              <th className="px-3 py-2 text-right uppercase" style={{ fontSize: "10px", letterSpacing: "0.8px", color: "var(--spx-muted)" }}>Balance</th>
            </tr>
          </thead>
          <tbody>
            {txns.map((t, i) => (
              <tr key={i} style={{ borderTop: "1px solid var(--spx-border)" }}>
                <td className="px-3 py-2 whitespace-nowrap" style={{ color: "var(--spx-text-secondary)" }}>{t.date || "—"}</td>
                <td className="px-3 py-2 text-[var(--spx-text)]">{t.description || "—"}</td>
                {/* red-700/emerald-700 in light, -400 in dark: money columns
                    have to be readable on both card colours. */}
                <td className="px-3 py-2 text-right text-red-700 dark:text-red-400">{fmt(t.withdrawal)}</td>
                <td className="px-3 py-2 text-right text-emerald-700 dark:text-emerald-400">{fmt(t.deposit)}</td>
                <td className="px-3 py-2 text-right" style={{ color: "var(--spx-text-secondary)" }}>{fmt(t.balance)}</td>
              </tr>
            ))}
            {txns.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center" style={{ color: "var(--spx-muted)" }}>No transactions detected.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2" style={{ fontSize: "11px", color: "var(--spx-muted)" }}>
        Click <strong className="text-[var(--spx-text)]">Map Transactions</strong> to assign a ledger to each row and send to Tally.
      </p>
    </div>
  );
}
