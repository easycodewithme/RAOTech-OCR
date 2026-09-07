"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Copy,
  Check,
  Plus,
  Building2,
  FileText,
  ImageIcon,
  Eye,
  Download,
  Trash2,
  Share2,
  Sparkles,
  Inbox,
  Clock,
  CheckCircle2,
  X,
  Loader2,
  Search,
  MessageCircle,
  AlertCircle,
} from "lucide-react";

type ClientItem = {
  id: string;
  name: string;
  gstin: string | null;
  email: string | null;
  phone: string | null;
  _count: {
    intakeDocuments: number;
    intakeLinks: number;
  };
};

type LinkItem = {
  id: string;
  token: string;
  label: string | null;
  enabled: boolean;
  createdAt: string;
  client: {
    id: string;
    name: string;
    gstin: string | null;
  };
  _count: {
    documents: number;
  };
};

type DocumentItem = {
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  status: string;
  notes: string | null;
  createdAt: string;
  client: {
    id: string;
    name: string;
    gstin: string | null;
  };
  intakeLink: {
    id: string;
    label: string | null;
    token: string;
  };
};

type OcrExtractedData = {
  invoice_number?: string | null;
  date?: string | null;
  vendor?: string | null;
  vendor_gstin?: string | null;
  subtotal?: number | string | null;
  total_amount?: number | string | null;
  [key: string]: unknown;
};

export default function IntakePage() {
  const [clients, setClients] = useState<ClientItem[]>([]);
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [clientDocs, setClientDocs] = useState<DocumentItem[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingInitial, setLoadingInitial] = useState(true);

  // Search & filter
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "PENDING" | "PROCESSED">("ALL");

  // Create Link Modal State
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [targetClientId, setTargetClientId] = useState("");
  const [linkLabel, setLinkLabel] = useState("");
  const [creatingLink, setCreatingLink] = useState(false);
  const [newlyCreatedLink, setNewlyCreatedLink] = useState<{ token: string; url: string; clientName: string } | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);

  // Document Preview Modal State
  const [previewDoc, setPreviewDoc] = useState<{ id: string; fileName: string; mimeType: string; fileData?: string } | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // OCR Processing State
  const [ocrLoadingDocId, setOcrLoadingDocId] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<{ docId: string; data: OcrExtractedData } | null>(null);

  // Error state
  const [apiError, setApiError] = useState<string | null>(null);

  // Copy feedback tracking
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const loadInitial = useCallback(async () => {
    setLoadingInitial(true);
    setApiError(null);
    try {
      const res = await fetch("/api/intake");
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setClients(data.clients || []);
        setLinks(data.links || []);
        if (data.clients?.length > 0 && !selectedClientId) {
          // Select client with most docs or first client
          const best = data.clients.find((c: ClientItem) => c._count.intakeDocuments > 0) || data.clients[0];
          setSelectedClientId(best.id);
        }
      } else {
        setApiError(data.error || `Server responded with status ${res.status}`);
      }
    } catch (err) {
      console.error(err);
      setApiError(err instanceof Error ? err.message : "Failed to load intake data");
    } finally {
      setLoadingInitial(false);
    }
  }, [selectedClientId]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // Fetch documents whenever selectedClientId changes
  useEffect(() => {
    if (!selectedClientId) {
      setClientDocs([]);
      return;
    }
    async function loadDocuments() {
      setLoadingDocs(true);
      try {
        const res = await fetch(`/api/intake/documents?clientId=${selectedClientId}`);
        if (res.ok) {
          const data = await res.json();
          setClientDocs(data.documents || []);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoadingDocs(false);
      }
    }
    loadDocuments();
  }, [selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((c) => c.id === selectedClientId),
    [clients, selectedClientId]
  );

  const selectedClientLinks = useMemo(
    () => links.filter((l) => l.client.id === selectedClientId),
    [links, selectedClientId]
  );

  const filteredClients = useMemo(() => {
    if (!searchQuery.trim()) return clients;
    const q = searchQuery.toLowerCase();
    return clients.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.gstin && c.gstin.toLowerCase().includes(q))
    );
  }, [clients, searchQuery]);

  const filteredDocs = useMemo(() => {
    if (statusFilter === "ALL") return clientDocs;
    return clientDocs.filter((d) => d.status === statusFilter);
  }, [clientDocs, statusFilter]);

  async function handleCreateLink() {
    const effectiveClientId = targetClientId || selectedClientId || clients[0]?.id;
    if (!effectiveClientId) {
      setModalError("Please select a client to create an intake link.");
      return;
    }
    setCreatingLink(true);
    setModalError(null);
    try {
      const res = await fetch("/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: effectiveClientId,
          label: linkLabel.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.link) {
        const fullUrl = `${window.location.origin}/intake/${data.link.token}`;
        setNewlyCreatedLink({
          token: data.link.token,
          url: fullUrl,
          clientName: data.link.client?.name || "Client",
        });
        setLinkLabel("");
        // Refresh links list
        await loadInitial();
      } else {
        setModalError(data.error || `Server error (${res.status}). Please try again.`);
      }
    } catch (err) {
      console.error(err);
      setModalError(err instanceof Error ? err.message : "Failed to generate link");
    } finally {
      setCreatingLink(false);
    }
  }

  function copyToClipboard(url: string, token: string) {
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    setTimeout(() => setCopiedToken(null), 2000);
  }

  function shareToWhatsApp(url: string, clientName: string) {
    const text = encodeURIComponent(
      `Hi ${clientName}! Please upload your invoices & expense bills securely using this link: ${url}`
    );
    window.open(`https://api.whatsapp.com/send?text=${text}`, "_blank");
  }

  async function openDocPreview(doc: DocumentItem) {
    setLoadingPreview(true);
    setPreviewDoc({
      id: doc.id,
      fileName: doc.fileName,
      mimeType: doc.mimeType,
    });
    try {
      const res = await fetch(`/api/intake/documents/${doc.id}`);
      if (res.ok) {
        const data = await res.json();
        setPreviewDoc({
          id: doc.id,
          fileName: doc.fileName,
          mimeType: doc.mimeType,
          fileData: data.document.fileData,
        });
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingPreview(false);
    }
  }

  async function updateDocStatus(docId: string, newStatus: string) {
    try {
      const res = await fetch(`/api/intake/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (res.ok) {
        setClientDocs((prev) =>
          prev.map((d) => (d.id === docId ? { ...d, status: newStatus } : d))
        );
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function deleteDoc(docId: string) {
    if (!confirm("Are you sure you want to delete this intake document?")) return;
    try {
      const res = await fetch(`/api/intake/documents/${docId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        setClientDocs((prev) => prev.filter((d) => d.id !== docId));
        setClients((prev) =>
          prev.map((c) =>
            c.id === selectedClientId
              ? { ...c, _count: { ...c._count, intakeDocuments: Math.max(0, c._count.intakeDocuments - 1) } }
              : c
          )
        );
        if (previewDoc?.id === docId) setPreviewDoc(null);
      }
    } catch (err) {
      console.error(err);
    }
  }

  async function triggerOcr(docId: string) {
    setOcrLoadingDocId(docId);
    setOcrResult(null);
    try {
      // 1. Get full fileData
      const docRes = await fetch(`/api/intake/documents/${docId}`);
      if (!docRes.ok) throw new Error("Could not fetch document");
      const docData = await docRes.json();
      const fileData = docData.document.fileData;

      // 2. Convert base64 data URL to Blob/File
      const blobRes = await fetch(fileData);
      const blob = await blobRes.blob();
      const file = new File([blob], docData.document.fileName, { type: docData.document.mimeType });

      // 3. Send to /api/process-invoice
      const formData = new FormData();
      formData.append("file", file);

      const ocrRes = await fetch("/api/process-invoice", {
        method: "POST",
        body: formData,
      });

      const ocrJson = await ocrRes.json();
      if (!ocrRes.ok) {
        alert(ocrJson.error || "OCR extraction failed");
        return;
      }

      setOcrResult({
        docId,
        data: ocrJson.data || {},
      });
      // Mark as processed
      await updateDocStatus(docId, "PROCESSED");
    } catch (err) {
      console.error(err);
      alert(err instanceof Error ? err.message : "OCR processing failed");
    } finally {
      setOcrLoadingDocId(null);
    }
  }

  function downloadBase64File(fileData: string, fileName: string) {
    const a = document.createElement("a");
    a.href = fileData;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200/80 pb-6">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
              <Inbox className="w-5 h-5" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900">
              Intake Documents
            </h1>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            Send client-specific intake links to collect invoices directly into your accounting pipeline.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => {
              setTargetClientId(selectedClientId || clients[0]?.id || "");
              setNewlyCreatedLink(null);
              setModalError(null);
              setShowCreateModal(true);
            }}
            className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl shadow-sm px-4 py-2 font-medium"
          >
            <Plus className="mr-2 h-4 w-4" /> Create Client Link
          </Button>
        </div>
      </div>

      {/* Error Alert Banner */}
      {apiError && (
        <div className="flex items-center justify-between p-4 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs">
          <div className="flex items-center gap-2.5">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            <span>Could not load intake data: {apiError}</span>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={loadInitial}
            className="h-7 text-xs border-red-200 text-red-700 hover:bg-red-100"
          >
            Retry
          </Button>
        </div>
      )}

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Clients List */}
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-2xl shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 bg-slate-50/50">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
              <Input
                placeholder="Search clients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-white text-xs rounded-xl"
              />
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[640px] overflow-y-auto">
            {loadingInitial ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                <Loader2 className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-500" />
                Loading clients...
              </div>
            ) : filteredClients.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-sm">
                No clients found
              </div>
            ) : (
              filteredClients.map((client) => {
                const isSelected = client.id === selectedClientId;
                const docCount = client._count.intakeDocuments;
                return (
                  <div
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className={`p-3.5 flex items-center justify-between cursor-pointer transition-all ${
                      isSelected
                        ? "bg-indigo-50/80 border-l-4 border-indigo-600 pl-3"
                        : "hover:bg-slate-50"
                    }`}
                  >
                    <div className="min-w-0 pr-2">
                      <div className="flex items-center gap-2">
                        <Building2 className={`w-4 h-4 shrink-0 ${isSelected ? "text-indigo-600" : "text-slate-400"}`} />
                        <span className={`font-semibold text-xs sm:text-sm truncate ${isSelected ? "text-indigo-950" : "text-slate-800"}`}>
                          {client.name}
                        </span>
                      </div>
                      {client.gstin && (
                        <p className="text-[11px] text-slate-400 font-mono mt-0.5 ml-6 truncate">
                          {client.gstin}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {docCount > 0 ? (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          isSelected
                            ? "bg-indigo-600 text-white shadow-xs"
                            : "bg-indigo-100 text-indigo-700"
                        }`}>
                          {docCount} {docCount === 1 ? "doc" : "docs"}
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">0 docs</span>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Column: Selected Client's Document Stream */}
        <div className="lg:col-span-8 space-y-5">
          {selectedClient ? (
            <>
              {/* Client Banner & Link Bar */}
              <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-xs space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      {selectedClient.name}
                      <span className="text-xs font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-md">
                        {clientDocs.length} total received
                      </span>
                    </h2>
                    {selectedClient.gstin && (
                      <p className="text-xs text-slate-500 font-mono mt-0.5">
                        GSTIN: {selectedClient.gstin}
                      </p>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setTargetClientId(selectedClient.id);
                      setNewlyCreatedLink(null);
                      setModalError(null);
                      setShowCreateModal(true);
                    }}
                    className="rounded-xl text-xs shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5 mr-1" /> New Link for this Client
                  </Button>
                </div>

                {/* Active links for this client */}
                {selectedClientLinks.length > 0 && (
                  <div className="pt-2 border-t border-slate-100 space-y-2">
                    <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">
                      Active Intake Links ({selectedClientLinks.length})
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {selectedClientLinks.map((link) => {
                        const fullUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/intake/${link.token}`;
                        const isCopied = copiedToken === link.token;
                        return (
                          <div
                            key={link.id}
                            className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-100 bg-slate-50/70 text-xs"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-800 truncate">
                                {link.label || "Upload Link"}
                              </p>
                              <p className="text-[11px] text-slate-400 font-mono truncate">
                                /intake/{link.token.slice(0, 8)}…
                              </p>
                            </div>

                            <div className="flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                title="Copy Link"
                                onClick={() => copyToClipboard(fullUrl, link.token)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-white transition-colors"
                              >
                                {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                              </button>
                              <button
                                type="button"
                                title="Share via WhatsApp"
                                onClick={() => shareToWhatsApp(fullUrl, selectedClient.name)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-emerald-600 hover:bg-white transition-colors"
                              >
                                <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Status Filter Tabs */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 bg-slate-100/80 p-1 rounded-xl">
                  {(["ALL", "PENDING", "PROCESSED"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                        statusFilter === st
                          ? "bg-white text-slate-900 shadow-xs font-semibold"
                          : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      {st === "ALL" ? "All Documents" : st === "PENDING" ? "Pending Review" : "Processed"}
                    </button>
                  ))}
                </div>

                <span className="text-xs text-slate-400">
                  Showing {filteredDocs.length} doc{filteredDocs.length === 1 ? "" : "s"}
                </span>
              </div>

              {/* Documents Grid / List */}
              {loadingDocs ? (
                <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm shadow-xs">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
                  Loading client documents...
                </div>
              ) : filteredDocs.length === 0 ? (
                <div className="bg-white border border-dashed border-slate-200 rounded-2xl p-12 text-center space-y-3 shadow-xs">
                  <div className="w-12 h-12 rounded-full bg-indigo-50 text-indigo-600 flex items-center justify-center mx-auto">
                    <FileText className="w-6 h-6" />
                  </div>
                  <h3 className="font-semibold text-slate-800">No documents received yet</h3>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Share an intake link with <span className="font-medium text-slate-700">{selectedClient.name}</span> so they can upload their invoices.
                  </p>
                  <Button
                    size="sm"
                    onClick={() => {
                      setTargetClientId(selectedClient.id);
                      setNewlyCreatedLink(null);
                      setModalError(null);
                      setShowCreateModal(true);
                    }}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs"
                  >
                    <Share2 className="w-3.5 h-3.5 mr-1.5" /> Share Intake Link
                  </Button>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredDocs.map((doc) => {
                    const isImage = doc.mimeType.startsWith("image/");
                    const isProcessed = doc.status === "PROCESSED";
                    const isOcrRunning = ocrLoadingDocId === doc.id;

                    return (
                      <div
                        key={doc.id}
                        className="bg-white border border-slate-200 rounded-2xl p-4 shadow-xs hover:shadow-md transition-all space-y-3 flex flex-col justify-between"
                      >
                        <div className="space-y-2.5">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                                  isImage
                                    ? "bg-indigo-50 text-indigo-600"
                                    : "bg-amber-50 text-amber-600"
                                }`}
                              >
                                {isImage ? <ImageIcon className="w-5 h-5" /> : <FileText className="w-5 h-5" />}
                              </div>

                              <div className="min-w-0">
                                <h4 className="text-xs font-bold text-slate-900 truncate" title={doc.fileName}>
                                  {doc.fileName}
                                </h4>
                                <p className="text-[11px] text-slate-400">
                                  {(doc.fileSize / 1024 / 1024).toFixed(2)} MB · {new Date(doc.createdAt).toLocaleDateString()}
                                </p>
                              </div>
                            </div>

                            <span
                              className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full shrink-0 ${
                                isProcessed
                                  ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60"
                                  : "bg-amber-50 text-amber-700 border border-amber-200/60"
                              }`}
                            >
                              {isProcessed ? "Processed" : "Pending"}
                            </span>
                          </div>

                          {doc.notes && (
                            <div className="bg-slate-50 border border-slate-100 rounded-lg p-2 text-[11px] text-slate-600 italic">
                              &ldquo;{doc.notes}&rdquo;
                            </div>
                          )}

                          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                            <Clock className="w-3 h-3" />
                            <span>Received {new Date(doc.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                            {doc.intakeLink?.label && (
                              <span className="truncate">· via {doc.intakeLink.label}</span>
                            )}
                          </div>
                        </div>

                        {/* Card Actions */}
                        <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openDocPreview(doc)}
                              className="h-8 rounded-lg text-xs px-2.5"
                            >
                              <Eye className="w-3.5 h-3.5 mr-1" /> Preview
                            </Button>

                            <Button
                              size="sm"
                              onClick={() => triggerOcr(doc.id)}
                              disabled={isOcrRunning}
                              className="h-8 rounded-lg text-xs px-2.5 bg-indigo-600 hover:bg-indigo-700 text-white"
                            >
                              {isOcrRunning ? (
                                <>
                                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> OCR...
                                </>
                              ) : (
                                <>
                                  <Sparkles className="w-3.5 h-3.5 mr-1" /> Run OCR
                                </>
                              )}
                            </Button>
                          </div>

                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateDocStatus(
                                  doc.id,
                                  isProcessed ? "PENDING" : "PROCESSED"
                                )
                              }
                              title={isProcessed ? "Mark as Pending" : "Mark as Processed"}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-slate-100"
                            >
                              <CheckCircle2 className={`w-4 h-4 ${isProcessed ? "text-emerald-600" : ""}`} />
                            </button>

                            <button
                              type="button"
                              onClick={() => deleteDoc(doc.id)}
                              title="Delete Document"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-slate-100"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl p-12 text-center text-slate-400 text-sm">
              Please select a client from the left list.
            </div>
          )}
        </div>
      </div>

      {/* Modal: Create Client Link */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-bold text-lg text-slate-900">
                Generate Client Intake Link
              </h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {newlyCreatedLink ? (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-emerald-800 text-xs flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
                  <span>
                    Link ready for <strong>{newlyCreatedLink.clientName}</strong>!
                  </span>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Shareable URL</label>
                  <div className="flex items-center gap-2">
                    <Input
                      readOnly
                      value={newlyCreatedLink.url}
                      className="text-xs font-mono bg-slate-50"
                    />
                    <Button
                      size="sm"
                      onClick={() => copyToClipboard(newlyCreatedLink.url, newlyCreatedLink.token)}
                      className="bg-slate-900 text-white shrink-0"
                    >
                      {copiedToken === newlyCreatedLink.token ? (
                        <>
                          <Check className="w-3.5 h-3.5 mr-1 text-emerald-400" /> Copied
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 mr-1" /> Copy
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => shareToWhatsApp(newlyCreatedLink.url, newlyCreatedLink.clientName)}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl py-5 font-semibold"
                  >
                    <MessageCircle className="w-4 h-4 mr-2" /> 1-Click WhatsApp Share
                  </Button>
                </div>

                <Button
                  variant="outline"
                  onClick={() => setShowCreateModal(false)}
                  className="w-full rounded-xl text-xs"
                >
                  Done
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                {modalError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                    <span>{modalError}</span>
                  </div>
                )}

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Select Client</label>
                  <select
                    value={targetClientId || selectedClientId || clients[0]?.id || ""}
                    onChange={(e) => setTargetClientId(e.target.value)}
                    className="w-full text-xs p-2.5 rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    {clients.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name} {c.gstin ? `(${c.gstin})` : ""}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Link Label / Purpose (optional)</label>
                  <Input
                    placeholder="e.g. September 2026 Invoices"
                    value={linkLabel}
                    onChange={(e) => setLinkLabel(e.target.value)}
                    className="text-xs rounded-xl"
                  />
                </div>

                <Button
                  onClick={handleCreateLink}
                  disabled={creatingLink || clients.length === 0}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-5 font-semibold"
                >
                  {creatingLink ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin mr-2" /> Generating Link...
                    </>
                  ) : (
                    <>Generate &amp; Get Share Link</>
                  )}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Document Preview */}
      {previewDoc && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <div className="min-w-0 pr-4">
                <h3 className="font-bold text-slate-900 truncate text-sm sm:text-base">
                  {previewDoc.fileName}
                </h3>
                <p className="text-xs text-slate-400">{previewDoc.mimeType}</p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {previewDoc.fileData && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadBase64File(previewDoc.fileData!, previewDoc.fileName)}
                    className="rounded-xl text-xs h-8"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> Download
                  </Button>
                )}
                <button
                  type="button"
                  onClick={() => setPreviewDoc(null)}
                  className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Content */}
            <div className="p-4 overflow-y-auto flex-1 flex items-center justify-center bg-slate-100/50 min-h-[400px]">
              {loadingPreview ? (
                <div className="text-center text-slate-400 text-sm">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-indigo-600" />
                  Loading document preview...
                </div>
              ) : previewDoc.fileData ? (
                previewDoc.mimeType.startsWith("image/") ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={previewDoc.fileData}
                    alt={previewDoc.fileName}
                    className="max-h-[600px] w-auto object-contain rounded-xl shadow-xs"
                  />
                ) : (
                  <iframe
                    src={previewDoc.fileData}
                    title={previewDoc.fileName}
                    className="w-full h-[600px] rounded-xl border border-slate-200 bg-white"
                  />
                )
              ) : (
                <div className="text-slate-400 text-sm">Failed to load preview data.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Modal: OCR Extraction Result */}
      {ocrResult && (
        <div className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                <h3 className="font-bold text-lg text-slate-900">OCR Extraction Completed</h3>
              </div>
              <button
                type="button"
                onClick={() => setOcrResult(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-slate-500">
              Key invoice attributes were successfully extracted from the customer document:
            </p>

            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100 space-y-2 text-xs">
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-500">Invoice Number:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {String(ocrResult.data.invoice_number || "Not detected")}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-500">Invoice Date:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {String(ocrResult.data.date || "Not detected")}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-500">Vendor:</span>
                <span className="font-semibold text-slate-800">
                  {String(ocrResult.data.vendor || "Not detected")}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-500">Vendor GSTIN:</span>
                <span className="font-semibold text-slate-800 font-mono">
                  {String(ocrResult.data.vendor_gstin || "Not detected")}
                </span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-200/50">
                <span className="text-slate-500">Taxable Subtotal:</span>
                <span className="font-semibold text-slate-800">
                  ₹{String(ocrResult.data.subtotal || "0")}
                </span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-500 font-bold">Total Amount:</span>
                <span className="font-bold text-indigo-600 text-sm">
                  ₹{String(ocrResult.data.total_amount || "0")}
                </span>
              </div>
            </div>

            <Button
              onClick={() => setOcrResult(null)}
              className="w-full bg-slate-900 hover:bg-slate-800 text-white rounded-xl py-5 text-xs font-semibold"
            >
              Close &amp; Mark as Reviewed
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
