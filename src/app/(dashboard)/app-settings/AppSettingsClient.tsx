"use client";

import { User, Shield } from "lucide-react";

interface AppSettingsClientProps {
  userName: string;
  userEmail: string;
  userImageUrl: string | null;
  createdAt: string | null;
}

export function AppSettingsClient({
  userName,
  userEmail,
  userImageUrl,
  createdAt,
}: AppSettingsClientProps) {
  return (
    <div className="p-4 md:p-6 lg:p-7" style={{ maxWidth: "900px" }}>
      {/* Header */}
      <h1
        className="font-bold"
        style={{
          fontSize: "clamp(22px, 5vw, 28px)",
          letterSpacing: "0.5px",
          fontFamily: "'Inter', system-ui, sans-serif",
          color: "var(--spx-text)",
          marginBottom: "8px",
        }}
      >
        Settings
      </h1>
      <p style={{ fontSize: "13px", color: "var(--spx-muted)", marginBottom: "32px", letterSpacing: "0.3px" }}>
        Manage your account preferences and appearance.
      </p>

      {/* ── Account Info Section ── */}
      <div style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)", marginBottom: "24px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "16px 20px",
            borderBottom: "1px solid var(--spx-border)",
          }}
        >
          <User style={{ width: "18px", height: "18px", color: "var(--spx-muted)" }} strokeWidth={1.5} />
          <span
            className="uppercase"
            style={{ fontSize: "11px", letterSpacing: "1.5px", fontWeight: 600, color: "var(--spx-muted)" }}
          >
            Account
          </span>
        </div>
        <div style={{ padding: "24px 20px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "20px", flexWrap: "wrap" }}>
            {/* Avatar */}
            {userImageUrl ? (
              <img
                src={userImageUrl}
                alt={userName}
                style={{
                  width: "64px",
                  height: "64px",
                  objectFit: "cover",
                  border: "2px solid var(--spx-border)",
                }}
              />
            ) : (
              <div
                style={{
                  width: "64px",
                  height: "64px",
                  background: "var(--spx-input-bg)",
                  border: "2px solid var(--spx-border)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "24px",
                  fontWeight: 700,
                  color: "var(--spx-muted)",
                }}
              >
                {userName.charAt(0).toUpperCase()}
              </div>
            )}

            {/* Info Grid */}
            <div style={{ flex: 1, minWidth: "200px" }}>
              <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "12px 16px" }}>
                <span
                  className="uppercase"
                  style={{ fontSize: "11px", letterSpacing: "1.2px", fontWeight: 500, color: "var(--spx-muted)" }}
                >
                  Name
                </span>
                <span style={{ fontSize: "14px", fontWeight: 500, color: "var(--spx-text)" }}>
                  {userName}
                </span>

                <span
                  className="uppercase"
                  style={{ fontSize: "11px", letterSpacing: "1.2px", fontWeight: 500, color: "var(--spx-muted)" }}
                >
                  Email
                </span>
                <span
                  style={{
                    fontSize: "14px",
                    color: "var(--spx-text-secondary)",
                    fontFamily: "'Geist Mono', 'Courier New', monospace",
                  }}
                >
                  {userEmail}
                </span>

                {createdAt && (
                  <>
                    <span
                      className="uppercase"
                      style={{ fontSize: "11px", letterSpacing: "1.2px", fontWeight: 500, color: "var(--spx-muted)" }}
                    >
                      Member since
                    </span>
                    <span style={{ fontSize: "14px", color: "var(--spx-text-secondary)" }}>
                      {new Date(createdAt).toLocaleDateString("en-IN", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                      })}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Security Section ── */}
      <div style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            padding: "16px 20px",
            borderBottom: "1px solid var(--spx-border)",
          }}
        >
          <Shield style={{ width: "18px", height: "18px", color: "var(--spx-muted)" }} strokeWidth={1.5} />
          <span
            className="uppercase"
            style={{ fontSize: "11px", letterSpacing: "1.5px", fontWeight: 600, color: "var(--spx-muted)" }}
          >
            Security
          </span>
        </div>
        <div style={{ padding: "24px 20px" }}>
          <p style={{ fontSize: "13px", color: "var(--spx-muted)" }}>
            Authentication is managed by Clerk. To update your password, enable 2FA, or manage sessions,
            visit your{" "}
            <a
              href="https://accounts.clerk.dev/user"
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: "var(--spx-text)", fontWeight: 500, textDecoration: "underline" }}
            >
              Clerk account settings
            </a>
            .
          </p>
        </div>
      </div>
    </div>
  );
}
