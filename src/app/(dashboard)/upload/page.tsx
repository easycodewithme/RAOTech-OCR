"use client";

import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
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
} from "lucide-react";

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
};

const MAX_FILES = 15;
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
const ACCEPTED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.bmp,.tiff,.webp";

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const documentsRef = useRef<UploadDoc[]>([]);
  const [documents, setDocuments] = useState<UploadDoc[]>([]);
  const [extractingAll, setExtractingAll] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const extractedCount = useMemo(
    () => documents.filter((doc) => !!doc.extractedData).length,
    [documents]
  );

  const savedCount = useMemo(
    () => documents.filter((doc) => doc.saved).length,
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

  const addFiles = (incomingFiles: File[]) => {
    if (!incomingFiles.length) return;

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
      }));

      return [...prev, ...nextDocs];
    });
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
          ? { ...d, extracting: true, error: null, extractedData: null, saved: false }
          : d
      )
    );

    const data = new FormData();
    data.append("file", doc.file);

    try {
      const res = await fetch("/api/process-invoice", { method: "POST", body: data });
      const json = await res.json();

      if (!res.ok || json.error) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, error: json.error || "Extraction failed", extracting: false } : d))
        );
        return;
      }

      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id
            ? {
                ...d,
                extractedData: json.data || json,
                gstValidation: json.gst_validation || null,
                processingTime: json.processing_time || null,
                ocrEngine: json.ocr_engine || null,
                extracting: false,
                error: null,
              }
            : d
        )
      );
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

  const saveSingle = async (id: string) => {
    const doc = documents.find((d) => d.id === id);
    if (!doc?.extractedData) return false;

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
        }),
      });

      if (res.ok) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === id ? { ...d, saving: false, saved: true, error: null } : d))
        );
        return true;
      } else {
        const err = await res.json();
        setDocuments((prev) =>
          prev.map((d) =>
            d.id === id
              ? { ...d, saving: false, saved: false, error: `Failed to save: ${err.error || "Unknown error"}` }
              : d
          )
        );
        return false;
      }
    } catch {
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === id ? { ...d, saving: false, saved: false, error: "Error saving invoice." } : d
        )
      );
      return false;
    }
  };

  const handleSaveAll = async () => {
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
      router.push("/dashboard");
    } else {
      setError(`${failed} document(s) failed to save. Fix errors and try again.`);
    }
  };

  const formatCurrency = (val: any) => {
    const num = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(num)) return val;
    return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Bulk Upload & Extract Invoices</h2>

      {/* Upload Area */}
      <div
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${
          isDragging
            ? "border-blue-500 bg-blue-50"
            : "border-gray-300 bg-white hover:border-gray-400"
        }`}
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
        <UploadCloud className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <p className="text-lg font-medium text-gray-700">
          {documents.length
            ? `${documents.length} document(s) selected`
            : "Drag & drop up to 15 invoice files here"}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Supports PDF, JPG, PNG, BMP, TIFF, WEBP (max 20MB each)
        </p>

        {documents.length > 0 && (
          <div className="mt-4 flex items-center justify-center gap-4">
            <span className="text-sm text-gray-500">Extracted {extractedCount}/{documents.length}</span>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleExtractAll();
              }}
              disabled={extractingAll}
              className="bg-blue-600 hover:bg-blue-700"
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
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleSaveAll();
              }}
              disabled={
                savingAll ||
                !documents.length ||
                extractedCount !== documents.length ||
                savedCount === documents.length
              }
              className="bg-green-600 hover:bg-green-700"
            >
              {savingAll ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
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
                  Save All Documents
                </>
              )}
            </Button>
          </div>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-4 rounded-lg bg-red-50 border border-red-200 text-red-700">
          <XCircle className="h-5 w-5 shrink-0" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {documents.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
          Added {documents.length}/{MAX_FILES} documents • Extracted {extractedCount} • Saved {savedCount}
        </div>
      )}

      {/* Results */}
      <div className="space-y-6">
        {documents.map((doc, docIndex) => (
          <div key={doc.id} className="space-y-4 border rounded-xl bg-white shadow-sm p-6 animate-in fade-in">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-lg font-bold text-blue-700 flex items-center gap-2">
                  <FileUp className="h-4 w-4" />
                  {docIndex + 1}. {doc.file.name}
                </h3>
                <p className="text-xs text-gray-500 mt-1">{(doc.file.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
              <div className="flex items-center gap-2">
                {doc.saved && (
                  <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs bg-green-100 text-green-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Saved
                  </span>
                )}
                <Button
                  variant="outline"
                  onClick={() => extractSingle(doc.id)}
                  disabled={doc.extracting}
                >
                  {doc.extracting ? (
                    <>
                      <Loader2 className="animate-spin mr-2 h-4 w-4" /> Extracting
                    </>
                  ) : (
                    <>
                      <FileText className="mr-2 h-4 w-4" /> Extract
                    </>
                  )}
                </Button>
                <Button variant="outline" onClick={() => removeDocument(doc.id)}>
                  Remove
                </Button>
              </div>
            </div>

            {doc.error && (
              <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700">
                <XCircle className="h-5 w-5 shrink-0" />
                <p className="text-sm">{doc.error}</p>
              </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-1 border rounded-xl bg-white p-4">
                <h4 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-1">
                  <ImageIcon className="h-4 w-4" /> Preview
                </h4>

                {doc.file.type === "application/pdf" && doc.previewUrl ? (
                  <iframe
                    src={doc.previewUrl}
                    title={`Preview ${doc.file.name}`}
                    className="w-full rounded-lg h-[420px] border"
                  />
                ) : doc.previewUrl ? (
                  <img
                    src={doc.previewUrl}
                    alt={doc.file.name}
                    className="w-full rounded-lg object-contain max-h-[420px]"
                  />
                ) : (
                  <p className="text-sm text-gray-500">Preview not available</p>
                )}
              </div>

              <div className="lg:col-span-2 border rounded-xl bg-white p-6">
                <div className="flex flex-wrap gap-4 items-center mb-6">
                  {doc.processingTime && (
                    <div className="flex items-center gap-1 text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                      <Clock className="h-3.5 w-3.5" />
                      {doc.processingTime.toFixed(1)}s
                    </div>
                  )}
                  {doc.ocrEngine && (
                    <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                      Model: {doc.ocrEngine}
                    </div>
                  )}
                  {doc.gstValidation && (
                    <div
                      className={`flex items-center gap-1 text-sm px-3 py-1 rounded-full ${
                        doc.gstValidation.is_valid_invoice
                          ? "bg-green-100 text-green-700"
                          : "bg-yellow-100 text-yellow-700"
                      }`}
                    >
                      {doc.gstValidation.is_valid_invoice ? (
                        <CheckCircle2 className="h-3.5 w-3.5" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5" />
                      )}
                      GST {doc.gstValidation.is_valid_invoice ? "Valid" : "Warning"}
                      {doc.gstValidation.vendor_state && ` - ${doc.gstValidation.vendor_state}`}
                    </div>
                  )}
                </div>

                {doc.extractedData ? (
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
                        <h4 className="text-sm font-semibold text-gray-700 mb-3">Line Items</h4>
                        <div className="overflow-x-auto border rounded-lg">
                          <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-600">
                              <tr>
                                <th className="px-4 py-2 text-left">#</th>
                                <th className="px-4 py-2 text-left">Description</th>
                                <th className="px-4 py-2 text-left">HSN</th>
                                <th className="px-4 py-2 text-right">Qty</th>
                                <th className="px-4 py-2 text-right">Rate</th>
                                <th className="px-4 py-2 text-right">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {doc.extractedData.items.map((item: any, i: number) => (
                                <tr key={i} className="border-t hover:bg-gray-50">
                                  <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                                  <td className="px-4 py-2 font-medium">{item.name || item.description || "-"}</td>
                                  <td className="px-4 py-2 text-gray-500">{item.hsn_code || "-"}</td>
                                  <td className="px-4 py-2 text-right">{item.qty ?? "-"}</td>
                                  <td className="px-4 py-2 text-right">{item.rate != null ? formatCurrency(item.rate) : "-"}</td>
                                  <td className="px-4 py-2 text-right font-semibold">
                                    {item.price != null
                                      ? formatCurrency(item.price)
                                      : item.amount != null
                                      ? formatCurrency(item.amount)
                                      : "-"}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="border-t pt-4">
                      <h4 className="text-sm font-semibold text-gray-700 mb-3">Amounts & Tax</h4>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
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
                      <div className="mt-4 text-sm text-gray-600 italic">
                        Amount in words: {doc.extractedData.amount_in_words}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-500">
                    Extract this document to render editable invoice fields.
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
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
      <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">{label}</Label>
      <Input
        value={String(value)}
        onChange={(e) => onChange(e.target.value)}
        className="bg-slate-50"
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
  const num = typeof value === "number" ? value : parseFloat(value);
  const display = isNaN(num) ? value : `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

  return (
    <div className={`p-3 rounded-lg ${highlight ? "bg-blue-50 border-2 border-blue-200" : "bg-gray-50"}`}>
      <p className="text-xs text-gray-500 uppercase">{label}</p>
      <p className={`text-lg font-bold ${highlight ? "text-blue-700" : "text-gray-900"}`}>
        {display}
      </p>
    </div>
  );
}
