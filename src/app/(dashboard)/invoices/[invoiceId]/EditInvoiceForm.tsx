"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Save, Loader2, ArrowLeft } from "lucide-react";

export default function EditInvoiceForm({ invoice }: { invoice: any }) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  
  // Initialize state with the existing data from DB
  const [formData, setFormData] = useState<Record<string, any>>(
    (invoice.extractedData as Record<string, any>) || {}
  );

  const handleInputChange = (key: string, value: any) => {
    setFormData({ ...formData, [key]: value });
  };

  const handleUpdate = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${invoice.id}`, {
        method: "PATCH", // Use PATCH for updates
        body: JSON.stringify({ extractedData: formData }),
      });

      if (res.ok) {
        alert("Invoice updated successfully!");
        router.refresh(); // Refresh to show new data
        router.push("/dashboard");
      } else {
        alert("Failed to update.");
      }
    } catch (error) {
      console.error(error);
      alert("Error updating invoice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border p-6 rounded-lg bg-white shadow-sm">
      <div className="flex justify-between items-center mb-6">
        <Button variant="outline" onClick={() => router.back()}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back
        </Button>
        <Button onClick={handleUpdate} disabled={saving} className="bg-blue-600 hover:bg-blue-700">
          {saving ? <Loader2 className="animate-spin" /> : <><Save className="mr-2 h-4 w-4" /> Save Changes</>}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(formData).map(([key, value]) => (
          <div key={key} className="space-y-2">
            <Label className="capitalize font-medium text-gray-700">
                {key.replace(/_/g, " ")}
            </Label>
            
            {Array.isArray(value) || typeof value === "object" ? (
              <Textarea
                className="font-mono text-xs h-32 bg-slate-50"
                defaultValue={JSON.stringify(value, null, 2)}
                onChange={(e) => {
                    try {
                        handleInputChange(key, JSON.parse(e.target.value));
                    } catch {}
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
  );
}