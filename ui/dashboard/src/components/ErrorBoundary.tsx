/**
 * ErrorBoundary — catches React render errors and shows a recovery UI
 * instead of crashing the entire application.
 */

import { Component, type ReactNode } from "react";
import { useRouteError, isRouteErrorResponse } from "react-router";

// ---------------------------------------------------------------------------
// Route-level error element (for react-router errorElement prop)
// ---------------------------------------------------------------------------

export function RouteErrorBoundary() {
  const error = useRouteError();

  let title = "Something went wrong";
  let message = "An unexpected error occurred.";
  let details = "";

  if (isRouteErrorResponse(error)) {
    title = `${String(error.status)} ${error.statusText}`;
    message = typeof error.data === "string" ? error.data : "Page not found or server error.";
  } else if (error instanceof Error) {
    title = error.name || "Error";
    message = error.message;
    details = error.stack ?? "";
  }

  return (
    <div style={{ padding: "2rem", maxWidth: "600px", margin: "2rem auto" }}>
      <div style={{
        background: "var(--color-card, #1e1e2e)",
        border: "1px solid var(--color-border, #313244)",
        borderRadius: "12px",
        padding: "1.5rem",
        color: "var(--color-foreground, #cdd6f4)",
        fontFamily: "-apple-system, BlinkMacSystemFont, sans-serif",
      }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 700, marginBottom: "0.5rem", color: "var(--color-destructive, #f38ba8)" }}>
          {title}
        </h2>
        <p style={{ fontSize: "0.85rem", color: "var(--color-muted-foreground, #6c7086)", marginBottom: "1rem" }}>
          {message}
        </p>
        {details && (
          <details style={{ marginBottom: "1rem" }}>
            <summary style={{ fontSize: "0.75rem", cursor: "pointer", color: "var(--color-muted-foreground, #6c7086)" }}>
              Stack trace
            </summary>
            <pre style={{
              fontSize: "0.7rem",
              background: "var(--color-mantle, #181825)",
              padding: "0.75rem",
              borderRadius: "6px",
              overflow: "auto",
              maxHeight: "200px",
              marginTop: "0.5rem",
              color: "var(--color-subtext0, #a6adc8)",
            }}>
              {details}
            </pre>
          </details>
        )}
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "6px",
              background: "var(--color-primary, #89b4fa)",
              color: "var(--color-primary-foreground, #1e1e2e)",
              border: "none",
              fontSize: "0.8rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Reload Page
          </button>
          <button
            onClick={() => window.history.back()}
            style={{
              padding: "0.4rem 1rem",
              borderRadius: "6px",
              background: "var(--color-secondary, #313244)",
              color: "var(--color-foreground, #cdd6f4)",
              border: "none",
              fontSize: "0.8rem",
              cursor: "pointer",
            }}
          >
            Go Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component-level error boundary (for wrapping individual components)
// ---------------------------------------------------------------------------

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ComponentErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div style={{
          padding: "1rem",
          border: "1px solid var(--color-border, #313244)",
          borderRadius: "8px",
          background: "var(--color-card, #1e1e2e)",
          margin: "0.5rem 0",
        }}>
          <p style={{ fontSize: "0.8rem", color: "var(--color-destructive, #f38ba8)", marginBottom: "0.5rem" }}>
            Component error: {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: "0.3rem 0.75rem",
              borderRadius: "4px",
              background: "var(--color-secondary, #313244)",
              color: "var(--color-foreground, #cdd6f4)",
              border: "none",
              fontSize: "0.75rem",
              cursor: "pointer",
            }}
          >
            Try Again
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
