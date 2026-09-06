"use client";

import { useState, useRef, useEffect } from "react";
import { Send, User, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// Define the shape of a message
type Message = {
  role: "user" | "assistant";
  content: string;
};

function formatTime(d: Date) {
  return d.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hello! I am RAO AI. Ask about this client's ITC, drafts, vendors, or reconciliation." }
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  // Terminal-log timestamps — display only, doesn't touch message data/logic.
  const [sessionStart] = useState(() => formatTime(new Date()));
  const [timestamps, setTimestamps] = useState<string[]>([formatTime(new Date())]);

  // Auto-scroll to bottom logic
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim() || isLoading) return;

    const userMessage = input;
    setInput(""); // Clear input immediately

    // 1. Add User Message to UI
    setMessages((prev) => [...prev, { role: "user", content: userMessage }]);
    setTimestamps((prev) => [...prev, formatTime(new Date())]);
    setIsLoading(true);

    try {
      // 2. Call API with conversation history for context
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMessage, history }),
      });

      const data = await res.json();

      // 3. Add AI Response to UI
      setMessages((prev) => [...prev, { role: "assistant", content: data.reply }]);
      setTimestamps((prev) => [...prev, formatTime(new Date())]);
    } catch (error) {
      console.error(error);
      setMessages((prev) => [...prev, { role: "assistant", content: "Sorry, I encountered an error." }]);
      setTimestamps((prev) => [...prev, formatTime(new Date())]);
    } finally {
      setIsLoading(false);
    }
  };

  const labelStyle = {
    fontSize: "11px",
    letterSpacing: "1.5px",
    fontWeight: 500,
    textTransform: "uppercase" as const,
    fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif",
  };

  return (
    <div
      className="flex flex-col h-[calc(100vh-theme(spacing.16))] md:h-[calc(100vh-50px)]"
      style={{ background: "var(--spx-canvas)" }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between shrink-0"
        style={{ height: "48px", borderBottom: "1px solid var(--spx-border)", background: "var(--spx-card)", padding: "0 24px" }}
      >
        <div className="flex items-center gap-2">
          <span style={{ fontSize: "16px" }}>🤖</span>
          <span style={{ fontSize: "14px", fontWeight: 600, color: "var(--spx-text)", fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif" }}>
            AI Assistant
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex h-2 w-2 relative">
            <span
              className="animate-ping absolute inline-flex h-full w-full"
              style={{ borderRadius: "50%", background: "#22c55e", opacity: 0.4 }}
            />
            <span
              className="relative inline-flex h-2 w-2"
              style={{ borderRadius: "50%", background: "#22c55e" }}
            />
          </span>
          <span style={{ ...labelStyle, color: "var(--spx-text)" }}>
            {isLoading ? "Typing..." : "Online"}
          </span>
        </div>
      </div>

      {/* Chat / Log Area */}
      <div
        className="flex-1 overflow-y-auto flex flex-col gap-8"
        style={{ padding: "24px", fontFamily: "'Inter', 'Geist Sans', system-ui, sans-serif" }}
      >
        {messages.map((msg, index) => (
          <div key={index} className="flex gap-4">
            <div className="w-20 text-right shrink-0" style={{ color: "var(--spx-muted)", fontSize: "12px" }}>
              [{timestamps[index] ?? sessionStart}]
            </div>

            {msg.role === "user" ? (
              <div
                className="flex-1"
                style={{ background: "var(--spx-card)", border: "1px solid var(--spx-border)", padding: "16px" }}
              >
                <div
                  className="flex items-center gap-2"
                  style={{
                    marginBottom: "8px",
                    color: "var(--spx-muted)",
                    borderBottom: "1px solid var(--spx-border)",
                    paddingBottom: "8px",
                  }}
                >
                  <User style={{ width: "14px", height: "14px" }} strokeWidth={1.5} />
                  <span style={labelStyle}>You</span>
                </div>
                <div style={{ color: "var(--spx-text)", fontSize: "13px", lineHeight: 1.7 }}>
                  <span style={{ color: "var(--spx-muted)" }}>&gt;</span> {msg.content}
                </div>
              </div>
            ) : (
              <div
                className="flex-1 relative overflow-hidden"
                style={{ background: "var(--spx-card)", border: "1px solid var(--spx-border)", padding: "16px" }}
              >
                <div
                  className="absolute left-0 top-0 bottom-0"
                  style={{ width: "3px", background: "var(--spx-text)", opacity: 0.5 }}
                />
                <div
                  className="flex items-center gap-2"
                  style={{
                    marginBottom: "12px",
                    color: "var(--spx-text)",
                    borderBottom: "1px solid var(--spx-border)",
                    paddingBottom: "8px",
                  }}
                >
                  <span style={{ fontSize: "14px" }}>🤖</span>
                  <span style={labelStyle}>AI Assistant</span>
                </div>
                <div style={{ color: "var(--spx-text)", fontSize: "13px", lineHeight: 1.7, whiteSpace: "pre-wrap" }}>
                  {msg.content}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Loading Indicator */}
        {isLoading && (
          <div className="flex gap-4">
            <div className="w-20 text-right shrink-0" style={{ color: "var(--spx-muted)", fontSize: "12px" }}>
              [{formatTime(new Date())}]
            </div>
            <div
              className="flex-1 flex items-center gap-2"
              style={{ background: "var(--spx-card)", border: "1px solid var(--spx-border)", padding: "12px 16px" }}
            >
              <Loader2 className="animate-spin" style={{ width: "14px", height: "14px", color: "var(--spx-text)" }} />
              <span style={{ color: "var(--spx-muted)", fontSize: "13px" }}>Thinking...</span>
            </div>
          </div>
        )}

        {/* Invisible div to scroll to */}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div
        className="shrink-0"
        style={{ padding: "24px", borderTop: "1px solid var(--spx-border)", background: "var(--spx-card)" }}
      >
        <form
          onSubmit={handleSubmit}
          className="relative flex items-center w-full max-w-4xl mx-auto"
        >
          <span
            className="absolute left-4 pointer-events-none"
            style={{ color: "var(--spx-muted)", fontSize: "13px" }}
          >
            &gt;
          </span>
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about invoices, Tally, GST, or vendors..."
            disabled={isLoading}
            className={cn(
              "w-full outline-none transition-colors disabled:opacity-50",
              "focus:border-white"
            )}
            style={{
              background: "var(--spx-canvas)",
              border: "1px solid var(--spx-border)",
              color: "var(--spx-text)",
              fontSize: "13px",
              padding: "12px 44px 12px 32px",
            }}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="absolute right-3 transition-colors disabled:opacity-40"
            style={{ color: "var(--spx-muted)" }}
          >
            <Send style={{ width: "16px", height: "16px" }} />
          </button>
        </form>
        <div
          className="max-w-4xl mx-auto flex justify-between items-center"
          style={{ marginTop: "8px", fontSize: "10px", letterSpacing: "1px", color: "var(--spx-muted)", textTransform: "uppercase" }}
        >
          <span>
            Press{" "}
            <kbd style={{ padding: "1px 4px", border: "1px solid var(--spx-border)", background: "var(--spx-input-bg)" }}>
              Cmd
            </kbd>{" "}
            +{" "}
            <kbd style={{ padding: "1px 4px", border: "1px solid var(--spx-border)", background: "var(--spx-input-bg)" }}>
              K
            </kbd>{" "}
            for quick actions
          </span>
          <span>{isLoading ? "Typing..." : "Online"}</span>
        </div>
      </div>
    </div>
  );
}
