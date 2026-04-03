/**
 * DnsSetupBanner — prompts users to configure client DNS when accessing
 * the dashboard by IP instead of via *.ai.on hostnames.
 */

import { useEffect, useState } from "react";

export interface DnsSetupBannerProps {
  baseDomain?: string;
}

const SESSION_KEY_RESULT = "dns-probe-ok";
const SESSION_KEY_DISMISSED = "dns-banner-dismissed";

function detectOS(): "windows" | "macos" | "linux" {
  const ua = navigator.userAgent;
  if (/win/i.test(ua)) return "windows";
  if (/mac/i.test(ua)) return "macos";
  return "linux";
}

function buildCommand(os: "windows" | "macos" | "linux", baseUrl: string): string {
  if (os === "windows") {
    return `powershell -ExecutionPolicy Bypass -Command "Invoke-WebRequest ${baseUrl}/api/hosting/client-setup/windows -OutFile setup.ps1; .\\setup.ps1"`;
  }
  const platform = os === "macos" ? "macos" : "linux";
  return `curl -sL ${baseUrl}/api/hosting/client-setup/${platform} | sudo bash`;
}

export function DnsSetupBanner({ baseDomain = "ai.on" }: DnsSetupBannerProps) {
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);

  // Skip entirely if already on the base domain
  const hostname = window.location.hostname;
  const onBaseDomain = hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);

  useEffect(() => {
    if (onBaseDomain) return;
    if (sessionStorage.getItem(SESSION_KEY_DISMISSED) === "1") return;

    const cached = sessionStorage.getItem(SESSION_KEY_RESULT);
    if (cached === "ok") return;
    if (cached === "fail") {
      setShow(true);
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    fetch(`http://${baseDomain}/api/hosting/status`, {
      signal: controller.signal,
      mode: "no-cors",
    })
      .then(() => {
        sessionStorage.setItem(SESSION_KEY_RESULT, "ok");
      })
      .catch(() => {
        sessionStorage.setItem(SESSION_KEY_RESULT, "fail");
        setShow(true);
      })
      .finally(() => clearTimeout(timeout));

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [baseDomain, onBaseDomain]);

  // Re-probe periodically while the banner is visible — redirect when DNS starts working
  useEffect(() => {
    if (!show || onBaseDomain) return;

    const interval = setInterval(() => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      fetch(`http://${baseDomain}/api/hosting/status`, {
        signal: controller.signal,
        mode: "no-cors",
      })
        .then(() => {
          clearTimeout(timeout);
          sessionStorage.setItem(SESSION_KEY_RESULT, "ok");
          sessionStorage.removeItem(SESSION_KEY_DISMISSED);
          // Redirect to the base domain hostname (HTTPS on port 443)
          window.location.href = `https://${baseDomain}${window.location.pathname}`;
        })
        .catch(() => {
          clearTimeout(timeout);
        });
    }, 5000);

    return () => clearInterval(interval);
  }, [show, baseDomain, onBaseDomain]);

  if (onBaseDomain || !show) return null;

  const os = detectOS();
  const baseUrl = `http://${hostname}${window.location.port ? `:${window.location.port}` : ""}`;
  const command = buildCommand(os, baseUrl);

  const handleCopy = () => {
    const textarea = document.createElement("textarea");
    textarea.value = command;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDismiss = () => {
    sessionStorage.setItem(SESSION_KEY_DISMISSED, "1");
    setShow(false);
  };

  return (
    <div className="px-4 py-3 rounded-xl border border-yellow bg-surface0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-card-foreground mb-1">
            Client setup required
          </div>
          <div className="text-[12px] text-muted-foreground mb-2">
            Configure DNS and HTTPS trust for <code className="text-blue">*.{baseDomain}</code> by running this in your terminal:
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 text-[11px] bg-mantle rounded-lg px-3 py-1.5 overflow-x-auto whitespace-nowrap text-foreground">
              {command}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 px-2.5 py-1.5 rounded-lg border border-border bg-card text-[11px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary cursor-pointer transition-colors"
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="shrink-0 p-1 rounded text-muted-foreground hover:text-foreground cursor-pointer bg-transparent border-none text-lg leading-none"
          aria-label="Dismiss"
        >
          &times;
        </button>
      </div>
    </div>
  );
}
