/**
 * ChannelWizard — Step-by-step channel setup wizard.
 *
 * Renders the appropriate wizard steps for a given channel:
 * - instructions: static content with links/code snippets
 * - credentials: form fields for tokens/keys
 * - oauth: popup-based OAuth via ID service
 * - configure: optional post-auth configuration fields
 * - test: live connection test with save-on-success
 *
 * OAuth channels (Gmail) open a popup and poll for completion,
 * matching the AionimaIdStep pattern from onboarding.
 */

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.js";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { CHANNEL_DEFS } from "@/components/channel-defs.js";
import {
  startChannelSetup,
  pollChannelSetup,
  testChannelCredentials,
  saveChannelConfig,
} from "@/api.js";

interface ChannelWizardProps {
  channelId: string;
  onBack: () => void;
  onComplete: () => void;
}

type OAuthStatus = "idle" | "waiting" | "complete" | "error";

export function ChannelWizard({ channelId, onBack, onComplete }: ChannelWizardProps) {
  const def = CHANNEL_DEFS.find((d) => d.id === channelId);
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState<Record<string, string>>({});
  const [ownerChannelId, setOwnerChannelId] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    ok: boolean;
    error?: string;
    details?: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [oauthStatus, setOauthStatus] = useState<OAuthStatus>("idle");
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  if (!def) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Unknown channel: {channelId}
      </div>
    );
  }

  const currentStep = def.steps[step];
  const isLastStep = step === def.steps.length - 1;
  const isFirstStep = step === 0;

  const updateConfig = (key: string, value: string) => {
    setConfig((prev) => ({ ...prev, [key]: value }));
  };

  const handleOauthConnect = async () => {
    setOauthStatus("waiting");
    setOauthError(null);

    try {
      const { handoffId, popupUrl } = await startChannelSetup(channelId);
      const popup = window.open(popupUrl, "channel-oauth", "width=600,height=700");

      if (!popup) {
        setOauthStatus("error");
        setOauthError("Popup blocked. Please allow popups for this site.");
        return;
      }

      pollRef.current = setInterval(async () => {
        if (popup.closed) {
          if (pollRef.current) clearInterval(pollRef.current);
          if (oauthStatus !== "complete") {
            setOauthStatus("idle");
          }
          return;
        }

        try {
          const data = await pollChannelSetup(handoffId);
          if (data.status === "complete") {
            if (pollRef.current) clearInterval(pollRef.current);
            popup.close();
            if (data.tokens) {
              setConfig((prev) => ({ ...prev, ...data.tokens }));
            }
            if (data.accountLabel) {
              setAccountLabel(data.accountLabel);
            }
            setOauthStatus("complete");
          } else if (data.status === "error" || data.status === "expired") {
            if (pollRef.current) clearInterval(pollRef.current);
            popup.close();
            setOauthStatus("error");
            setOauthError("Authentication failed. Please try again.");
          }
        } catch {
          // keep polling
        }
      }, 2000);
    } catch {
      setOauthStatus("error");
      setOauthError("Failed to start authentication. Is the ID service running?");
    }
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const result = await testChannelCredentials(channelId, config);
      setTestResult(result);
    } catch {
      setTestResult({ ok: false, error: "Test request failed — backend may be unavailable." });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveChannelConfig(channelId, config, ownerChannelId);
      onComplete();
    } catch {
      // Save failed — stay on step so user can retry
    } finally {
      setSaving(false);
    }
  };

  const canAdvance = () => {
    if (!currentStep) return false;

    switch (currentStep.type) {
      case "instructions":
        return true;
      case "credentials":
      case "configure": {
        const fields = currentStep.fields ?? [];
        return fields.every((f) => !f.key || (config[f.key] ?? "").trim() !== "");
      }
      case "oauth":
        return oauthStatus === "complete";
      case "test":
        return testResult?.ok === true && ownerChannelId.trim() !== "";
      default:
        return true;
    }
  };

  const handleNext = () => {
    if (isLastStep) return;
    setStep((s) => s + 1);
  };

  const handleBack = () => {
    if (isFirstStep) {
      onBack();
    } else {
      setStep((s) => s - 1);
      setTestResult(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-secondary transition-colors text-muted-foreground hover:text-foreground"
          aria-label="Go back"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 19l-7-7 7-7"
            />
          </svg>
        </button>
        <div
          className={cn(
            "w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0",
            def.color,
          )}
        >
          {def.icon}
        </div>
        <div>
          <h2 className="text-base font-semibold leading-tight">{def.label} Setup</h2>
          <p className="text-xs text-muted-foreground">{currentStep?.title}</p>
        </div>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-1.5">
        {def.steps.map((s, i) => (
          <div
            key={s.title}
            className={cn(
              "h-1.5 rounded-full transition-all",
              i === step
                ? "w-6 bg-primary"
                : i < step
                ? "w-3 bg-primary/40"
                : "w-3 bg-secondary",
            )}
          />
        ))}
      </div>

      {/* Step content */}
      <div className="flex flex-col gap-4">
        {/* instructions */}
        {currentStep?.type === "instructions" && currentStep.content}

        {/* credentials or configure */}
        {(currentStep?.type === "credentials" || currentStep?.type === "configure") &&
          (currentStep.fields ?? []).map((field) => (
            <div key={field.key} className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {field.label}
              </label>
              <Input
                type={field.secret ? "password" : "text"}
                placeholder={field.placeholder}
                value={config[field.key] ?? ""}
                onChange={(e) => updateConfig(field.key, e.target.value)}
                className="font-mono text-sm"
              />
              {field.helpText && (
                <p className="text-[11px] text-muted-foreground">{field.helpText}</p>
              )}
            </div>
          ))}

        {/* oauth */}
        {currentStep?.type === "oauth" && (
          <div className="flex flex-col gap-3">
            {currentStep.oauthDescription && (
              <p className="text-sm text-muted-foreground">
                {currentStep.oauthDescription}
              </p>
            )}

            {oauthStatus === "idle" && (
              <Button
                variant="outline"
                onClick={handleOauthConnect}
                className="w-full sm:w-auto"
              >
                Connect with {currentStep.oauthProvider === "google" ? "Google" : "OAuth"}
              </Button>
            )}

            {oauthStatus === "waiting" && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <svg
                  className="w-4 h-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Waiting for authentication...
              </div>
            )}

            {oauthStatus === "complete" && (
              <div className="flex items-center gap-2 text-sm">
                <svg
                  className="w-4 h-4 text-green-500 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-muted-foreground">
                  {accountLabel ? `Connected as ${accountLabel}` : "Connected successfully"}
                </span>
              </div>
            )}

            {oauthStatus === "error" && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-destructive">{oauthError}</p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setOauthStatus("idle");
                    setOauthError(null);
                  }}
                >
                  Try again
                </Button>
              </div>
            )}
          </div>
        )}

        {/* test */}
        {currentStep?.type === "test" && (
          <div className="flex flex-col gap-4">
            {/* Owner ID field */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {def.ownerIdField.label}
              </label>
              <Input
                type="text"
                placeholder={def.ownerIdField.placeholder}
                value={ownerChannelId}
                onChange={(e) => setOwnerChannelId(e.target.value)}
                className="font-mono text-sm"
              />
              {def.ownerIdField.helpText && (
                <p className="text-[11px] text-muted-foreground">
                  {def.ownerIdField.helpText}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Your identifier on this channel — messages from this ID are treated as owner commands.
              </p>
            </div>

            {/* Test button and result */}
            <div className="flex flex-col gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleTest}
                disabled={testing}
                className="w-full sm:w-auto"
              >
                {testing ? (
                  <span className="flex items-center gap-2">
                    <svg
                      className="w-3.5 h-3.5 animate-spin"
                      fill="none"
                      viewBox="0 0 24 24"
                    >
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                      />
                    </svg>
                    Testing...
                  </span>
                ) : (
                  "Test Connection"
                )}
              </Button>

              {testResult && (
                <div
                  className={cn(
                    "flex items-start gap-2 p-3 rounded-lg text-sm",
                    testResult.ok
                      ? "bg-green-500/10 border border-green-500/20 text-green-400"
                      : "bg-destructive/10 border border-destructive/20 text-destructive",
                  )}
                >
                  {testResult.ok ? (
                    <svg
                      className="w-4 h-4 shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                  ) : (
                    <svg
                      className="w-4 h-4 shrink-0 mt-0.5"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M6 18L18 6M6 6l12 12"
                      />
                    </svg>
                  )}
                  <div className="flex flex-col gap-0.5">
                    <span>
                      {testResult.ok ? "Connection successful" : (testResult.error ?? "Connection failed")}
                    </span>
                    {testResult.details && (
                      <span className="text-xs opacity-80">{testResult.details}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Navigation */}
      <div className="flex gap-2 pt-2 border-t border-border">
        {isLastStep ? (
          <>
            <Button
              onClick={handleSave}
              disabled={saving || !canAdvance()}
              className="w-full sm:w-auto"
            >
              {saving ? "Saving..." : "Save Channel"}
            </Button>
            <Button variant="ghost" onClick={onBack} className="w-full sm:w-auto">
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              onClick={handleNext}
              disabled={!canAdvance()}
              className="w-full sm:w-auto"
            >
              Continue
            </Button>
            <Button variant="ghost" onClick={handleBack} className="w-full sm:w-auto">
              {isFirstStep ? "Cancel" : "Back"}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
