import { redirect } from "next/navigation";
import { getActiveClient } from "@/lib/clientContext";
import TallyConnection from "./TallyConnection";

/** Thin on purpose: every field on this screen lives behind /api/tally and
 *  /api/connector, and half of them change while the page is open. */
export default async function TallyConnectionPage() {
  const ctx = await getActiveClient();
  if (!ctx) return redirect("/sign-in");

  return <TallyConnection clientName={ctx.client.name} />;
}
