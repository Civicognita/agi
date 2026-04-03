/**
 * RustDeskPasswordSection — set permanent password for the RustDesk client.
 */

import { useCallback, useState } from "react";
import { Input } from "@/components/ui/input";
import { setRustDeskPassword } from "../../api.js";

export function RustDeskPasswordSection() {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!password.trim()) return;
    setSaving(true);
    setMessage(null);
    try {
      await setRustDeskPassword(password);
      setMessage({ type: "success", text: "Password updated successfully." });
      setPassword("");
    } catch (err) {
      setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed to set password" });
    } finally {
      setSaving(false);
    }
  }, [password]);

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12px] text-muted-foreground m-0">
        Set the permanent password for the local RustDesk client. This password is used for unattended access.
      </p>
      <div className="flex gap-2 items-start">
        <Input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="New password"
          className="font-mono max-w-xs"
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSubmit();
          }}
        />
        <button
          type="button"
          onClick={() => void handleSubmit()}
          disabled={saving || !password.trim()}
          className="px-3 py-2 text-[13px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 cursor-pointer border-none shrink-0"
        >
          {saving ? "Setting..." : "Set Password"}
        </button>
      </div>
      {message && (
        <div className={`text-[12px] ${message.type === "success" ? "text-green" : "text-red"}`}>
          {message.text}
        </div>
      )}
    </div>
  );
}
