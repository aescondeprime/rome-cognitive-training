import { useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { setToken } from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";

interface Props {
  onLogin: () => void;
}

export default function Login({ onLogin }: Props) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!name.trim() || !password) {
      setError("Name and password are required.");
      return;
    }
    if (mode === "register" && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    if (mode === "register" && password.length < 4) {
      setError("Password must be at least 4 characters.");
      return;
    }

    setLoading(true);
    try {
      const endpoint = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }
      setToken(data.token);
      queryClient.clear();
      onLogin();
    } catch (err: any) {
      setError(err.message ?? "Network error.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        display: "flex", alignItems: "center", justifyContent: "center",
        background: "hsl(222 16% 6%)",
        fontFamily: "DM Sans, sans-serif",
      }}
    >
      {/* Subtle particle-like background radial */}
      <div style={{
        position: "absolute", inset: 0,
        background: "radial-gradient(ellipse 70% 60% at 50% 40%, hsl(43 30% 8% / 0.8) 0%, transparent 100%)",
        pointerEvents: "none",
      }} />

      <form
        onSubmit={handleSubmit}
        style={{
          position: "relative",
          width: "100%", maxWidth: 380,
          margin: "0 auto",
          padding: "48px 40px",
          background: "hsl(222 18% 8%)",
          border: "1px solid hsl(43 20% 16% / 0.8)",
          borderRadius: 16,
          boxShadow: "0 0 60px hsl(43 40% 8% / 0.6), 0 0 120px hsl(43 30% 5% / 0.4)",
        }}
      >
        {/* Logo mark */}
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <svg width="36" height="36" viewBox="0 0 28 28" fill="none" aria-hidden="true" style={{ margin: "0 auto 12px" }}>
            <circle cx="14" cy="14" r="12" stroke="hsl(43,88%,55%)" strokeWidth="1.2" fill="none"/>
            <path d="M7 14 C5 11 6 8 9 8 C8 11 8 13 10 14"  stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M7 14 C5 16 6 19 9 19 C8 16 8 15 10 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M21 14 C23 11 22 8 19 8 C20 11 20 13 18 14"  stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <path d="M21 14 C23 16 22 19 19 19 C20 16 20 15 18 14" stroke="hsl(43,78%,55%)" strokeWidth="1" fill="none" strokeLinecap="round"/>
            <rect x="13" y="9" width="2" height="10" rx="1" fill="hsl(43,88%,55%)" opacity="0.7"/>
          </svg>
          <h1 style={{
            fontFamily: "'Cinzel', serif",
            fontSize: 15, fontWeight: 700,
            letterSpacing: "0.22em",
            color: "hsl(43 75% 58%)",
            textTransform: "uppercase",
            margin: 0,
          }}>
            ROME
          </h1>
          <p style={{
            fontFamily: "DM Mono, monospace",
            fontSize: 9, color: "hsl(214 15% 32%)",
            letterSpacing: "0.14em", marginTop: 4, textTransform: "uppercase",
          }}>
            Cognitive Training Lab
          </p>
        </div>

        {/* Mode toggle */}
        <div style={{
          display: "flex", marginBottom: 28,
          background: "hsl(222 20% 6%)",
          borderRadius: 8, padding: 3,
          border: "1px solid hsl(43 15% 12%)",
        }}>
          {(["login", "register"] as const).map(m => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
              style={{
                flex: 1, padding: "7px 0",
                borderRadius: 6, border: "none",
                fontSize: 11, fontFamily: "'Cinzel', serif",
                letterSpacing: "0.1em", textTransform: "uppercase",
                cursor: "pointer",
                background: mode === m ? "hsl(43 30% 12%)" : "transparent",
                color: mode === m ? "hsl(43 75% 58%)" : "hsl(214 15% 36%)",
                transition: "all 0.2s ease",
              }}
            >
              {m === "login" ? "Sign In" : "New Profile"}
            </button>
          ))}
        </div>

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <label style={{ display: "block", fontSize: 10, color: "hsl(43 30% 38%)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, fontFamily: "DM Mono, monospace" }}>
              Profile Name
            </label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Marcus"
              autoFocus
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "10px 14px",
                background: "hsl(222 20% 6%)",
                border: "1px solid hsl(43 15% 14%)",
                borderRadius: 8, color: "hsl(43 30% 80%)",
                fontSize: 14, outline: "none",
                fontFamily: "DM Sans, sans-serif",
                transition: "border-color 0.2s",
              }}
              onFocus={e => e.target.style.borderColor = "hsl(43 50% 30%)"}
              onBlur={e => e.target.style.borderColor = "hsl(43 15% 14%)"}
            />
          </div>

          <div>
            <label style={{ display: "block", fontSize: 10, color: "hsl(43 30% 38%)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, fontFamily: "DM Mono, monospace" }}>
              Password
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              style={{
                width: "100%", boxSizing: "border-box",
                padding: "10px 14px",
                background: "hsl(222 20% 6%)",
                border: "1px solid hsl(43 15% 14%)",
                borderRadius: 8, color: "hsl(43 30% 80%)",
                fontSize: 14, outline: "none",
                fontFamily: "DM Sans, sans-serif",
                transition: "border-color 0.2s",
              }}
              onFocus={e => e.target.style.borderColor = "hsl(43 50% 30%)"}
              onBlur={e => e.target.style.borderColor = "hsl(43 15% 14%)"}
            />
          </div>

          {mode === "register" && (
            <div>
              <label style={{ display: "block", fontSize: 10, color: "hsl(43 30% 38%)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 6, fontFamily: "DM Mono, monospace" }}>
                Confirm Password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={e => setConfirm(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: "100%", boxSizing: "border-box",
                  padding: "10px 14px",
                  background: "hsl(222 20% 6%)",
                  border: "1px solid hsl(43 15% 14%)",
                  borderRadius: 8, color: "hsl(43 30% 80%)",
                  fontSize: 14, outline: "none",
                  fontFamily: "DM Sans, sans-serif",
                  transition: "border-color 0.2s",
                }}
                onFocus={e => e.target.style.borderColor = "hsl(43 50% 30%)"}
                onBlur={e => e.target.style.borderColor = "hsl(43 15% 14%)"}
              />
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p style={{
            marginTop: 14, fontSize: 12,
            color: "hsl(0 60% 60%)",
            fontFamily: "DM Sans, sans-serif",
            textAlign: "center",
          }}>
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading}
          style={{
            marginTop: 24,
            width: "100%", padding: "11px 0",
            background: loading ? "hsl(43 20% 10%)" : "hsl(43 35% 14%)",
            border: "1px solid hsl(43 40% 24%)",
            borderRadius: 8, cursor: loading ? "wait" : "pointer",
            color: loading ? "hsl(43 30% 36%)" : "hsl(43 80% 62%)",
            fontSize: 12, fontFamily: "'Cinzel', serif",
            letterSpacing: "0.14em", textTransform: "uppercase",
            transition: "all 0.2s ease",
          }}
          onMouseEnter={e => { if (!loading) (e.target as HTMLButtonElement).style.background = "hsl(43 35% 18%)"; }}
          onMouseLeave={e => { if (!loading) (e.target as HTMLButtonElement).style.background = "hsl(43 35% 14%)"; }}
        >
          {loading ? "…" : mode === "login" ? "Enter" : "Create Profile"}
        </button>
      </form>
    </div>
  );
}
