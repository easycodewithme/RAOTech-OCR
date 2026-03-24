"use client";

import { useState, useRef, useCallback } from "react";
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

export default function UploadPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Backend response fields
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null);
  const [gstValidation, setGstValidation] = useState<GSTValidation | null>(null);
  const [processingTime, setProcessingTime] = useState<number | null>(null);
  const [ocrEngine, setOcrEngine] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  const handleFileSelect = (selectedFile: File) => {
    setFile(selectedFile);
    setExtractedData(null);
    setGstValidation(null);
    setError(null);

    // Generate image preview
    if (selectedFile.type.startsWith("image/")) {
      const reader = new FileReader();
      reader.onload = (e) => setImagePreview(e.target?.result as string);
      reader.readAsDataURL(selectedFile);
    } else {
      setImagePreview(null);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) handleFileSelect(droppedFile);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => setIsDragging(false), []);

  const handleExtract = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);

    const data = new FormData();
    data.append("file", file);

    try {
      const res = await fetch("/api/process-invoice", { method: "POST", body: data });
      const json = await res.json();

      if (!res.ok || json.error) {
        setError(json.error || "Extraction failed");
        return;
      }

      // Backend response: { success, message, data, gst_validation, job_id, processing_time, ocr_engine, file_metadata }
      setExtractedData(json.data || json);
      setGstValidation(json.gst_validation || null);
      setProcessingTime(json.processing_time || null);
      setOcrEngine(json.ocr_engine || null);
    } catch (err) {
      setError("Failed to connect to server. Make sure the Python backend is running.");
    } finally {
      setUploading(false);
    }
  };

  const handleFieldChange = (key: string, value: any) => {
    if (!extractedData) return;
    setExtractedData({ ...extractedData, [key]: value });
  };

  const handleSaveToDB = async () => {
    if (!extractedData) return;
    setSaving(true);

    try {
      const res = await fetch("/api/invoices/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          extractedData,
          gstValidation,
          fileName: file?.name || "invoice",
          processingTime,
          ocrEngine,
        }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        const err = await res.json();
        setError(`Failed to save: ${err.error || "Unknown error"}`);
      }
    } catch (err) {
      setError("Error saving invoice.");
    } finally {
      setSaving(false);
    }
  };

  const formatCurrency = (val: any) => {
    const num = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(num)) return val;
    return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;
  };

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <h2 className="text-3xl font-bold tracking-tight">Upload & Extract Invoice</h2>

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
          accept=".jpg,.jpeg,.png,.bmp,.tiff,.webp"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
          }}
        />
        <UploadCloud className="mx-auto h-12 w-12 text-gray-400 mb-4" />
        <p className="text-lg font-medium text-gray-700">
          {file ? file.name : "Drag & drop your invoice image here"}
        </p>
        <p className="text-sm text-gray-500 mt-1">
          Supports JPG, PNG, BMP, TIFF, WEBP (max 20MB)
        </p>

        {file && (
          <div className="mt-4 flex items-center justify-center gap-4">
            <span className="text-sm text-gray-500">
              {(file.size / 1024 / 1024).toFixed(2)} MB
            </span>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                handleExtract();
              }}
              disabled={uploading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {uploading ? (
                <>
                  <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  Extracting...
                </>
              ) : (
                <>
                  <FileText className="mr-2 h-4 w-4" />
                  Extract Data
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

      {/* Results */}
      {extractedData && (
        <div className="space-y-6 animate-in fade-in">
          {/* Metadata Bar */}
          <div className="flex flex-wrap gap-4 items-center">
            {processingTime && (
              <div className="flex items-center gap-1 text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                <Clock className="h-3.5 w-3.5" />
                {processingTime.toFixed(1)}s
              </div>
            )}
            {ocrEngine && (
              <div className="text-sm text-gray-600 bg-gray-100 px-3 py-1 rounded-full">
                Model: {ocrEngine}
              </div>
            )}
            {gstValidation && (
              <div
                className={`flex items-center gap-1 text-sm px-3 py-1 rounded-full ${
                  gstValidation.is_valid_invoice
                    ? "bg-green-100 text-green-700"
                    : "bg-yellow-100 text-yellow-700"
                }`}
              >
                {gstValidation.is_valid_invoice ? (
                  <CheckCircle2 className="h-3.5 w-3.5" />
                ) : (
                  <AlertTriangle className="h-3.5 w-3.5" />
                )}
                GST {gstValidation.is_valid_invoice ? "Valid" : "Warning"}
                {gstValidation.vendor_state && ` - ${gstValidation.vendor_state}`}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Image Preview */}
            {imagePreview && (
              <div className="lg:col-span-1 border rounded-xl bg-white shadow-sm p-4">
                <h4 className="text-sm font-medium text-gray-500 mb-3 flex items-center gap-1">
                  <ImageIcon className="h-4 w-4" /> Preview
                </h4>
                <img
                  src={imagePreview}
                  alt="Invoice preview"
                  className="w-full rounded-lg object-contain max-h-[500px]"
                />
              </div>
            )}

            {/* Extracted Fields */}
            <div className={`border rounded-xl bg-white shadow-sm p-6 ${imagePreview ? "lg:col-span-2" : "lg:col-span-3"}`}>
              <div className="flex justify-between items-center mb-6">
                <h3 className="text-xl font-bold text-blue-600">Extracted Invoice Data</h3>
                <Button
                  onClick={handleSaveToDB}
                  disabled={saving}
                  className="bg-green-600 hover:bg-green-700"
                >
                  {saving ? (
                    <Loader2 className="animate-spin mr-2 h-4 w-4" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  Save to Database
                </Button>
              </div>

              {/* Vendor & Invoice Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <Field label="Invoice Number" value={extractedData.invoice_number} onChange={(v) => handleFieldChange("invoice_number", v)} />
                <Field label="Date" value={extractedData.date} onChange={(v) => handleFieldChange("date", v)} />
                <Field label="Vendor" value={extractedData.vendor} onChange={(v) => handleFieldChange("vendor", v)} />
                <Field label="Vendor GSTIN" value={extractedData.vendor_gstin} onChange={(v) => handleFieldChange("vendor_gstin", v)} />
                <Field label="Vendor Address" value={extractedData.vendor_address} onChange={(v) => handleFieldChange("vendor_address", v)} />
                <Field label="Vendor Phone" value={extractedData.vendor_phone} onChange={(v) => handleFieldChange("vendor_phone", v)} />
                <Field label="Customer Name" value={extractedData.customer_name} onChange={(v) => handleFieldChange("customer_name", v)} />
                <Field label="Customer GSTIN" value={extractedData.customer_gstin} onChange={(v) => handleFieldChange("customer_gstin", v)} />
              </div>

              {/* Line Items Table */}
              {extractedData.items && extractedData.items.length > 0 && (
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
                        {extractedData.items.map((item: any, i: number) => (
                          <tr key={i} className="border-t hover:bg-gray-50">
                            <td className="px-4 py-2 text-gray-500">{i + 1}</td>
                            <td className="px-4 py-2 font-medium">{item.name || item.description || "-"}</td>
                            <td className="px-4 py-2 text-gray-500">{item.hsn_code || "-"}</td>
                            <td className="px-4 py-2 text-right">{item.qty ?? "-"}</td>
                            <td className="px-4 py-2 text-right">{item.rate != null ? formatCurrency(item.rate) : "-"}</td>
                            <td className="px-4 py-2 text-right font-semibold">
                              {item.price != null ? formatCurrency(item.price) : item.amount != null ? formatCurrency(item.amount) : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Totals */}
              <div className="border-t pt-4">
                <h4 className="text-sm font-semibold text-gray-700 mb-3">Amounts & Tax</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <AmountCard label="Subtotal" value={extractedData.subtotal} />
                  {extractedData.cgst != null && <AmountCard label="CGST" value={extractedData.cgst} />}
                  {extractedData.sgst != null && <AmountCard label="SGST" value={extractedData.sgst} />}
                  {extractedData.igst != null && <AmountCard label="IGST" value={extractedData.igst} />}
                  <AmountCard label="Total Tax" value={extractedData.tax} />
                  {extractedData.discount != null && <AmountCard label="Discount" value={extractedData.discount} />}
                  <AmountCard label="Grand Total" value={extractedData.total_amount} highlight />
                </div>
              </div>

              {/* Amount in Words */}
              {extractedData.amount_in_words && (
                <div className="mt-4 text-sm text-gray-600 italic">
                  Amount in words: {extractedData.amount_in_words}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
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
