/**
 * WhoDBFlyout — right-side iframe panel embedding the WhoDB database UI.
 *
 * WhoDB runs as always-on infrastructure (see hosting-manager.ts → ensureWhoDB).
 * Caddy reverse-proxies `db.{baseDomain}` to the WhoDB container, so the iframe
 * loads through the same-origin-ish reverse proxy. Falls back to an error state
 * with a retry button if the iframe fails to load.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks.js";

export interface WhoDBFlyoutProps {
  open: boolean;
  onClose: () => void;
  /** URL of the WhoDB instance (defaults to https://db.ai.on). */
  url?: string;
}

const DEFAULT_WHODB_URL = "https://db.ai.on";

export function WhoDBFlyout({ open, onClose, url = DEFAULT_WHODB_URL }: WhoDBFlyoutProps) {
  const isMobile = useIsMobile();
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  useEffect(() => {
    if (!open) {
      setLoadError(null);
    }
  }, [open]);

  if (!open) return null;

  const handleRetry = () => {
    setLoadError(null);
    setReloadKey((k) => k + 1);
  };

  return (
    <div data-testid="whodb-flyout" className="fixed inset-0 z-[190] flex justify-end">
      <div
        className={cn("bg-black/30", isMobile ? "absolute inset-0" : "flex-1")}
        onClick={onClose}
      />
      <div
        className={cn(
          "flex flex-col bg-background",
          isMobile
            ? "fixed bottom-0 left-0 right-0 h-[90dvh] border-t border-border rounded-t-2xl"
            : "h-screen w-[66vw] max-w-full border-l border-border",
        )}
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-blue" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <ellipse cx="12" cy="5" rx="9" ry="3" />
              <path d="M3 5V19A9 3 0 0 0 21 19V5" />
              <path d="M3 12A9 3 0 0 0 21 12" />
            </svg>
            <span className="text-sm font-semibold">WhoDB</span>
            <span className="text-[10px] text-muted-foreground">{url}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={handleRetry}
              className="px-2 py-1 text-[11px] rounded hover:bg-secondary text-muted-foreground"
              title="Reload WhoDB"
            >
              Reload
            </button>
            <button
              onClick={onClose}
              className="px-2 py-1 text-[11px] rounded hover:bg-secondary text-muted-foreground"
              title="Close"
            >
              x
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 relative">
          {loadError !== null && (
            <div className="absolute inset-0 flex items-center justify-center bg-background">
              <div className="max-w-[320px] text-center p-4">
                <div className="text-sm font-semibold mb-1">WhoDB is unavailable</div>
                <div className="text-[12px] text-muted-foreground mb-3">{loadError}</div>
                <button
                  onClick={handleRetry}
                  className="px-3 py-1.5 text-[12px] rounded bg-primary text-primary-foreground hover:opacity-90"
                >
                  Retry
                </button>
              </div>
            </div>
          )}
          <iframe
            key={reloadKey}
            ref={iframeRef}
            data-testid="whodb-iframe"
            src={url}
            className="w-full h-full border-0"
            title="WhoDB"
            onError={() => setLoadError("Failed to load WhoDB. Check that the container is running and db.ai.on resolves.")}
          />
        </div>
      </div>
    </div>
  );
}
