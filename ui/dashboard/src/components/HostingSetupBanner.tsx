/**
 * HostingSetupBanner — shows infrastructure status when hosting is not ready.
 * Displayed at the top of the Projects page.
 */

import { Button } from "@/components/ui/button";

export interface HostingSetupBannerProps {
  caddy: { installed: boolean; running: boolean };
  dnsmasq: { installed: boolean; running: boolean; configured: boolean };
  podman?: { installed: boolean; rootless: boolean };
  onSetup: () => Promise<unknown>;
  settingUp: boolean;
  error?: string | null;
}

export function HostingSetupBanner({ caddy, dnsmasq, podman, onSetup, settingUp, error }: HostingSetupBannerProps) {
  return (
    <div className="mb-4 px-4 py-3 rounded-xl border border-yellow bg-surface0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-[13px] font-semibold text-card-foreground mb-1">
            Development infrastructure not configured
          </div>
          <div className="flex gap-4 text-[12px] text-muted-foreground">
            <span>
              Caddy: {caddy.installed && caddy.running ? (
                <span className="text-green font-semibold">OK</span>
              ) : (
                <span className="text-red font-semibold">
                  {!caddy.installed ? "not installed" : "not running"}
                </span>
              )}
            </span>
            <span>
              DNS: {dnsmasq.installed && dnsmasq.running && dnsmasq.configured ? (
                <span className="text-green font-semibold">OK</span>
              ) : (
                <span className="text-red font-semibold">
                  {!dnsmasq.installed ? "not installed" : !dnsmasq.running ? "not running" : "not configured"}
                </span>
              )}
            </span>
            <span>
              Podman: {podman?.installed ? (
                <span className="text-green font-semibold">
                  OK{podman.rootless ? " (rootless)" : ""}
                </span>
              ) : (
                <span className="text-red font-semibold">not installed</span>
              )}
            </span>
          </div>
        </div>
        <Button
          size="sm"
          onClick={() => void onSetup()}
          disabled={settingUp}
        >
          {settingUp ? "Setting up..." : "Setup Development"}
        </Button>
      </div>
      {error && (
        <div className="mt-2 text-[12px] text-red">
          {error}
        </div>
      )}
    </div>
  );
}
