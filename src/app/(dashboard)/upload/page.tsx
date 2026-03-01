"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { UploadCloud, Loader2, Save } from "lucide-react";

export default function UploadPage() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [formData, setFormData] = useState<Record<string, any> | null>(null);
  const [saving, setSaving] = useState(false);

  const handleExtract = async () => {
    if (!file) return;
    setUploading(true);
    
    const data = new FormData();
    data.append("file", file);

    try {
      const res = await fetch("/api/process-invoice", { method: "POST", body: data });
      const extractedJson = await res.json();
      setFormData(extractedJson);
    } catch (error) {
      alert("Failed to extract data");
    } finally {
      setUploading(false);
    }
  };

  // Simplified Input Change Handler
  const handleInputChange = (key: string, value: any) => {
    if (!formData) return;
    setFormData({ ...formData, [key]: value });
  };

  const handleSaveToDB = async () => {
    if (!formData) return;
    setSaving(true);

    try {
      const res = await fetch("/api/invoices/save", {
        method: "POST",
        body: JSON.stringify({
          extractedData: formData,
          fileName: file?.name || "invoice.pdf"
        }),
      });

      if (res.ok) {
        alert("Invoice saved successfully!");
        router.push("/dashboard");
      } else {
        // If it fails, we now alert the status text to help debug
        const err = await res.json();
        alert(`Failed to save: ${err.error || "Unknown error"}`);
      }
    } catch (error) {
      console.error(error);
      alert("Error saving invoice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <h2 className="text-3xl font-bold tracking-tight">Upload & Verify Invoice</h2>

      <div className="border p-6 rounded-lg bg-white shadow-sm">
        <div className="flex gap-4 items-center">
          <Input 
            type="file" 
            accept=".pdf,.png,.jpg"
            onChange={(e) => setFile(e.target.files?.[0] || null)} 
            className="flex-1"
          />
          <Button onClick={handleExtract} disabled={!file || uploading}>
            {uploading ? <Loader2 className="animate-spin" /> : "Extract Data"}
          </Button>
        </div>
      </div>

      {formData && (
        <div className="border p-6 rounded-lg bg-white shadow-sm animate-in fade-in">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-xl font-bold text-blue-600">Review Data</h3>
            <Button onClick={handleSaveToDB} disabled={saving} className="bg-green-600 hover:bg-green-700">
              {saving ? <Loader2 className="animate-spin" /> : "Save to Database"}
            </Button>
          </div>

          <div className="grid grid-cols-1 gap-6">
            {Object.entries(formData).map(([key, value]) => (
              <div key={key} className="space-y-2">
                <Label className="capitalize font-medium text-gray-700">
                    {key.replace(/_/g, " ")}
                </Label>
                
                {/* Logic: If value is an Array or Object, use Textarea. Else use Input. */}
                {Array.isArray(value) || typeof value === "object" ? (
                  <Textarea
                    className="font-mono text-xs h-40 bg-slate-50 border-slate-300"
                    // Display formatted JSON
                    defaultValue={JSON.stringify(value, null, 2)}
                    // On Change: Try to parse it back to JSON. If valid, update state.
                    onChange={(e) => {
                        try {
                            const parsed = JSON.parse(e.target.value);
                            handleInputChange(key, parsed);
                        } catch (err) {
                            // If invalid JSON, we don't update state yet to avoid crashing
                            // In a real app, you'd show a "Invalid JSON" error message here
                        }
                    }}
                  />
                ) : (
                  <Input
                    value={value as string}
                    onChange={(e) => handleInputChange(key, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}