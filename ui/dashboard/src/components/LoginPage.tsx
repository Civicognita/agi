/**
 * LoginPage — shown when dashboardAuth is enabled and user is not authenticated.
 * Supports two login methods:
 * 1. Login with Aionima ID (via handoff flow) — preferred when Local-ID is available
 *    On LAN: instant login (auto-approved, no popup needed)
 *    Off LAN: popup flow (user authenticates at Local-ID, dashboard polls)
 * 2. Local credentials (username/password) — fallback
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginDashboard, startIdLogin, pollIdLogin } from "@/api.js";

interface LoginPageProps {
  onLogin: (token: string) => void;
  /** Auth provider — "local-id" if Local-ID is available, "internal" otherwise. */
  provider?: "local-id" | "internal";
}

export function LoginPage({ onLogin, provider = "internal" }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [idLoginPending, setIdLoginPending] = useState(false);
  const [showLocalCreds, setShowLocalCreds] = useState(provider === "internal");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  const handleLocalSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await loginDashboard(username, password);
      localStorage.setItem("aionima-dashboard-token", result.token);
      onLogin(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }, [username, password, onLogin]);

  const handleIdLogin = useCallback(async () => {
    setError(null);
    setIdLoginPending(true);

    try {
      const result = await startIdLogin();

      // Instant login — handoff was auto-approved on LAN
      if (result.status === "completed" && result.token) {
        localStorage.setItem("aionima-dashboard-token", result.token);
        setIdLoginPending(false);
        onLogin(result.token);
        return;
      }

      // Pending — off-LAN, need popup flow
      if (result.status === "pending" && result.handoffId && result.authUrl) {
        const popup = window.open(result.authUrl, "aionima-id-login", "width=500,height=600,menubar=no,toolbar=no");
        const handoffId = result.handoffId;

        // Poll for completion
        pollRef.current = setInterval(async () => {
          try {
            const poll = await pollIdLogin(handoffId);

            if (poll.status === "completed" && poll.token) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              localStorage.setItem("aionima-dashboard-token", poll.token);
              setIdLoginPending(false);
              if (popup && !popup.closed) popup.close();
              onLogin(poll.token);
            } else if (poll.status === "expired" || poll.status === "not_found") {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setIdLoginPending(false);
              setError("Login session expired. Please try again.");
            }
          } catch {
            // Network error during poll — keep trying
          }
        }, 1500);

        // Safety timeout — 5 minutes
        setTimeout(() => {
          if (pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
            setIdLoginPending(false);
            setError("Login timed out. Please try again.");
          }
        }, 5 * 60_000);
      }
    } catch (err) {
      setIdLoginPending(false);
      setError(err instanceof Error ? err.message : "Failed to start ID login");
    }
  }, [onLogin]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <Card className="w-full max-w-sm p-6 gap-0">
        <div className="text-center mb-6">
          <h1 className="text-xl font-bold text-foreground">Aionima</h1>
          <p className="text-[13px] text-muted-foreground mt-1">Sign in to the dashboard</p>
        </div>

        {error && (
          <div className="rounded-lg bg-red/10 border border-red/30 px-3 py-2 text-[12px] text-red mb-4">
            {error}
          </div>
        )}

        {/* Login with Aionima ID — shown when Local-ID is available */}
        {provider === "local-id" && (
          <>
            <Button
              onClick={() => void handleIdLogin()}
              disabled={idLoginPending}
              className="w-full mb-4"
            >
              {idLoginPending ? "Signing in..." : "Login with Aionima ID"}
            </Button>

            {idLoginPending && (
              <p className="text-[12px] text-muted-foreground text-center mb-4">
                Authenticating with Aionima ID...
              </p>
            )}

            {/* Divider */}
            <div className="flex items-center gap-3 mb-4">
              <div className="flex-1 h-px bg-border" />
              <button
                type="button"
                onClick={() => setShowLocalCreds((p) => !p)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors"
              >
                {showLocalCreds ? "Hide local credentials" : "Use local credentials"}
              </button>
              <div className="flex-1 h-px bg-border" />
            </div>
          </>
        )}

        {/* Local credentials form */}
        {showLocalCreds && (
          <form onSubmit={(e) => void handleLocalSubmit(e)} className="grid gap-4">
            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Username</label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus={provider === "internal"}
                className="h-9"
              />
            </div>

            <div>
              <label className="text-[11px] text-muted-foreground mb-1 block">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                className="h-9"
              />
            </div>

            <Button type="submit" variant={provider === "local-id" ? "outline" : "default"} disabled={loading || !username || !password} className="w-full">
              {loading ? "Signing in..." : "Sign In"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
