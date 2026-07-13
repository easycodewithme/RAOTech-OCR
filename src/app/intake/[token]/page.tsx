import { IntakeUploader } from "./IntakeUploader";

export default async function PublicIntakePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-lg rounded-2xl border bg-white shadow-lg p-8 space-y-4">
        <h1 className="text-2xl font-bold">Upload documents</h1>
        <p className="text-sm text-gray-500">
          Secure client intake · link {token.slice(0, 8)}…
        </p>
        <IntakeUploader token={token} />
      </div>
    </div>
  );
}
