"use client";

import { useState } from "react";
import { Mail, Send, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function InviteUsersPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);

  async function sendInvite(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setStatus("");
    try {
      const response = await fetch("/api/invitations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json();
      if (!response.ok) {
        setStatus(data.error || "Could not send invitation.");
        return;
      }
      setEmail("");
      setStatus("Invitation sent successfully.");
    } catch {
      setStatus("Could not reach the invitation service.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
      <div className="flex items-center gap-3">
        <UserPlus className="h-6 w-6" />
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Invite Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">Invite someone to discover RAO AI with you.</p>
        </div>
      </div>

      <section className="mt-8 rounded-[14px] border border-border bg-card p-6">
        <div className="flex gap-3 text-sm text-muted-foreground">
          <Mail className="h-5 w-5 shrink-0 text-foreground" />
          <p>We will send your friend a short introduction to RAO AI and a link to try the platform. You can invite one person at a time.</p>
        </div>
        <form onSubmit={sendInvite} className="mt-8 flex flex-col gap-3 sm:flex-row">
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="friend@example.com"
            required
            className="h-11 flex-1 rounded-[10px] border border-border bg-background px-4 text-sm outline-none focus:ring-2 focus:ring-ring/40"
          />
          <Button type="submit" disabled={sending} className="h-11 rounded-[10px] sm:px-6">
            <Send className="mr-2 h-4 w-4" />
            {sending ? "Sending..." : "Invite"}
          </Button>
        </form>
        {status && <p className="mt-4 text-sm text-muted-foreground">{status}</p>}
      </section>
    </main>
  );
}