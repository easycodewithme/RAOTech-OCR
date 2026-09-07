import { prisma } from "@/lib/prisma";
import { IntakeUploader } from "./IntakeUploader";
import { AlertCircle, Building2, ShieldCheck } from "lucide-react";

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const link = await prisma.intakeLink.findUnique({
    where: { token },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          gstin: true,
        },
      },
      user: {
        select: {
          name: true,
          email: true,
        },
      },
    },
  });

  if (!link) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border bg-white shadow-xl p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-red-100 text-red-600 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Intake Link Not Found</h1>
          <p className="text-sm text-gray-500">
            This upload link is invalid or has been removed. Please check the URL or request a new link from your accountant.
          </p>
        </div>
      </div>
    );
  }

  if (!link.enabled) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border bg-white shadow-xl p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Link Deactivated</h1>
          <p className="text-sm text-gray-500">
            This upload link has been paused or deactivated by your accountant. Please contact {link.user.name || "your accounting team"}.
          </p>
        </div>
      </div>
    );
  }

  const isExpired = link.expiresAt && new Date(link.expiresAt) < new Date();
  if (isExpired) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-2xl border bg-white shadow-xl p-8 text-center space-y-4">
          <div className="mx-auto w-12 h-12 bg-amber-100 text-amber-600 rounded-full flex items-center justify-center">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-xl font-bold text-gray-900">Link Expired</h1>
          <p className="text-sm text-gray-500">
            This upload link expired on {new Date(link.expiresAt!).toLocaleDateString()}. Please request a fresh link from your accountant.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-slate-100 to-indigo-50/30 flex flex-col justify-between p-4 sm:p-6 md:p-10">
      <div className="w-full max-w-xl mx-auto space-y-6">
        {/* Header Branding */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-indigo-600 font-semibold tracking-tight">
            <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-md">
              R
            </div>
            <span>RAOTech OCR</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200/60 px-2.5 py-1 rounded-full font-medium">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Secure 256-bit Intake</span>
          </div>
        </div>

        {/* Main Card */}
        <div className="rounded-3xl border border-slate-200/80 bg-white shadow-xl shadow-slate-200/50 p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-5">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-indigo-600 mb-1">
              <Building2 className="w-3.5 h-3.5" />
              <span>{link.label || "Document Submission"}</span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
              Upload for {link.client.name}
            </h1>
            {link.client.gstin && (
              <p className="text-xs text-slate-500 font-mono mt-1">
                GSTIN: <span className="font-semibold text-slate-700">{link.client.gstin}</span>
              </p>
            )}
            <p className="text-xs text-slate-500 mt-2">
              Assigned CA: <span className="font-medium text-slate-700">{link.user.name || "RAOTech Accounting"}</span>
            </p>
          </div>

          <IntakeUploader
            token={token}
            clientName={link.client.name}
            accountantName={link.user.name || "your CA"}
          />
        </div>

        <p className="text-center text-xs text-slate-400">
          Uploaded documents are safely encrypted and transferred directly to your accountant&apos;s ledger portal.
        </p>
      </div>

      <footer className="text-center text-xs text-slate-400 mt-8">
        Powered by RAOTech OCR &amp; Accounting Platform
      </footer>
    </div>
  );
}
