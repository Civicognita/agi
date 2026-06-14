/**
 * LoginPage — shown when dashboardAuth is enabled and the user is not
 * authenticated. Authenticates with local credentials (username/password)
 * against the gateway's own user store.
 *
 * (Historically this page also offered "Login with Aionima ID" via a popup
 * handoff to the Local-ID service. Local-ID was folded into AGI, the
 * `/api/auth/login-via-id` endpoint was retired, and the gateway never
 * advertises a `local-id` auth provider — so that branch was dead and has
 * been removed. If a native dashboard-login-via-Aionima-ID is wanted later,
 * it should be built in-gateway like the GitHub device flow, not resurrected
 * against an external identity service.)
 */

import { useCallback, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { loginDashboard } from "@/api.js";

interface LoginPageProps {
  onLogin: (token: string) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

        {/* Local credentials form — the gateway's native auth */}
        <form onSubmit={(e) => void handleLocalSubmit(e)} className="grid gap-4">
          <div>
            <label className="text-[11px] text-muted-foreground mb-1 block">Username</label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
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

          <Button type="submit" disabled={loading || !username || !password} className="w-full">
            {loading ? "Signing in..." : "Sign In"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
