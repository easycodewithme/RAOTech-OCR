"use client";

import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import {
  UploadCloud,
  Loader2,
  CheckCircle2,
  FileText,
  ImageIcon,
  X,
  Plus,
  AlertCircle,
} from "lucide-react";

interface IntakeUploaderProps {
  token: string;
  clientName: string;
  accountantName: string;
}

interface StagedFile {
  file: File;
  id: string;
  previewUrl?: string;
}

async function compressImageIfNeeded(file: File): Promise<File> {
  if (!file.type.startsWith("image/") || file.size <= 2 * 1024 * 1024) {
    return file;
  }
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      const MAX_DIM = 2200; // High resolution for clear OCR reading
      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const compressed = new File([blob], file.name, { type: "image/jpeg" });
          resolve(compressed);
        },
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export function IntakeUploader({
  token,
  clientName,
  accountantName,
}: IntakeUploaderProps) {
  const [stagedFiles, setStagedFiles] = useState<StagedFile[]>([]);
  const [notes, setNotes] = useState("");
  const [status, setStatus] = useState<"idle" | "uploading" | "done" | "error">("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [uploadProgress, setUploadProgress] = useState("");
  const [uploadedDocs, setUploadedDocs] = useState<{ id: string; fileName: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  function handleFileSelect(files: FileList | null) {
    if (!files?.length) return;
    const newItems: StagedFile[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const previewUrl = file.type.startsWith("image/")
        ? URL.createObjectURL(file)
        : undefined;
      newItems.push({
        file,
        id: `${file.name}-${file.size}-${Date.now()}-${i}`,
        previewUrl,
      });
    }

    setStagedFiles((prev) => [...prev, ...newItems]);
    setErrorMessage("");
  }

  function removeFile(id: string) {
    setStagedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((f) => f.id !== id);
    });
  }

  async function handleUpload() {
    if (stagedFiles.length === 0) return;

    setStatus("uploading");
    setErrorMessage("");
    const allUploaded: { id: string; fileName: string }[] = [];

    try {
      for (let i = 0; i < stagedFiles.length; i++) {
        const item = stagedFiles[i];
        setUploadProgress(`Uploading ${i + 1} of ${stagedFiles.length}: ${item.file.name}...`);

        // Check if single PDF exceeds Vercel 4.5MB limit
        if (item.file.type === "application/pdf" && item.file.size > 4.5 * 1024 * 1024) {
          throw new Error(
            `"${item.file.name}" is ${(item.file.size / 1024 / 1024).toFixed(1)}MB. Vercel serverless limit is 4.5MB per PDF. Please compress or choose a smaller PDF.`
          );
        }

        // Auto-compress large phone camera photos to stay safely under 2MB
        const fileToUpload = await compressImageIfNeeded(item.file);

        const formData = new FormData();
        formData.append("file", fileToUpload);
        if (i === 0 && notes.trim()) {
          formData.append("notes", notes.trim());
        }

        const res = await fetch(`/api/intake/${token}/upload`, {
          method: "POST",
          body: formData,
        });

        const data = await res.json();

        if (!res.ok) {
          throw new Error(data.error || `Failed to upload "${item.file.name}".`);
        }

        if (data.documents?.length) {
          allUploaded.push(...data.documents);
        }
      }

      setUploadedDocs(allUploaded);
      setStatus("done");
      setStagedFiles([]);
      setNotes("");
      setUploadProgress("");
    } catch (err) {
      console.error(err);
      setStatus("error");
      setErrorMessage(err instanceof Error ? err.message : "Upload failed.");
    }
  }

  function resetToUploadMore() {
    setStatus("idle");
    setStagedFiles([]);
    setErrorMessage("");
  }

  if (status === "done") {
    return (
      <div className="text-center py-6 space-y-5 animate-in fade-in zoom-in-95 duration-200">
        <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
          <CheckCircle2 className="w-9 h-9" />
        </div>

        <div className="space-y-1">
          <h2 className="text-xl font-bold text-slate-900">Documents Received!</h2>
          <p className="text-sm text-slate-500 max-w-sm mx-auto">
            {uploadedDocs.length} file{uploadedDocs.length === 1 ? "" : "s"} successfully submitted for{" "}
            <span className="font-semibold text-slate-700">{clientName}</span>. {accountantName} has been notified.
          </p>
        </div>

        <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-4 text-left max-h-48 overflow-y-auto space-y-2">
          {uploadedDocs.map((doc, idx) => (
            <div key={doc.id || idx} className="flex items-center gap-2.5 text-xs text-slate-700 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span className="truncate">{doc.fileName}</span>
            </div>
          ))}
        </div>

        <Button
          onClick={resetToUploadMore}
          className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-6 font-medium shadow-md"
        >
          <Plus className="w-4 h-4 mr-2" /> Upload more documents
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Drag and drop zone */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFileSelect(e.dataTransfer.files);
        }}
        onClick={() => fileInputRef.current?.click()}
        className={`flex flex-col items-center justify-center border-2 border-dashed rounded-2xl p-8 cursor-pointer transition-all duration-150 text-center ${
          isDragging
            ? "border-slate-900 bg-slate-100/60 scale-[0.99]"
            : "border-slate-200 hover:border-slate-400 hover:bg-slate-50/80 bg-slate-50/40"
        }`}
      >
        <div className="w-12 h-12 rounded-full bg-slate-100 text-slate-800 flex items-center justify-center mb-3">
          <UploadCloud className="h-6 w-6" />
        </div>
        <p className="text-sm font-semibold text-slate-800">
          Tap to photograph or select invoices
        </p>
        <p className="text-xs text-slate-400 mt-1">
          Supports camera photos, PDF, PNG, JPG (up to 20MB each)
        </p>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => handleFileSelect(e.target.files)}
        />
      </div>

      {/* Selected Files Preview List */}
      {stagedFiles.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs font-semibold text-slate-500 px-1">
            <span>Ready to submit ({stagedFiles.length})</span>
            <button
              type="button"
              onClick={() => setStagedFiles([])}
              className="text-red-500 hover:text-red-600 text-xs font-medium"
            >
              Clear all
            </button>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {stagedFiles.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-3 p-2.5 rounded-xl border border-slate-200 bg-white shadow-xs"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  {item.file.type.startsWith("image/") ? (
                    item.previewUrl ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={item.previewUrl}
                        alt="preview"
                        className="w-9 h-9 object-cover rounded-md border border-slate-200 shrink-0"
                      />
                    ) : (
                      <div className="w-9 h-9 rounded-md bg-slate-100 text-slate-800 flex items-center justify-center shrink-0">
                        <ImageIcon className="w-4 h-4" />
                      </div>
                    )
                  ) : (
                    <div className="w-9 h-9 rounded-md bg-amber-50 text-amber-600 flex items-center justify-center shrink-0">
                      <FileText className="w-4 h-4" />
                    </div>
                  )}

                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-slate-800 truncate">
                      {item.file.name}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {(item.file.size / 1024 / 1024).toFixed(2)} MB
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeFile(item.id);
                  }}
                  className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Optional notes */}
          <div className="pt-2">
            <label className="block text-xs font-medium text-slate-600 mb-1">
              Note for Accountant (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. September office supplies and electricity bill"
              rows={2}
              className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/20 focus:border-slate-900 transition-all resize-none"
            />
          </div>
        </div>
      )}

      {/* Error display */}
      {status === "error" && errorMessage && (
        <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700 text-xs">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Submit button */}
      <Button
        type="button"
        disabled={stagedFiles.length === 0 || status === "uploading"}
        onClick={handleUpload}
        className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-6 font-semibold shadow-md shadow-slate-900/20 transition-all disabled:opacity-50"
      >
        {status === "uploading" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            {uploadProgress || `Uploading ${stagedFiles.length} files...`}
          </>
        ) : (
          <>Submit {stagedFiles.length > 0 ? `${stagedFiles.length} ` : ""}Document{stagedFiles.length === 1 ? "" : "s"} Directly</>
        )}
      </Button>
    </div>
  );
}
