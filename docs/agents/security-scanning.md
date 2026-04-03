# Security Scanning — Agent Guide

This guide covers the security scanning system architecture, file locations, and how to extend it.

## Architecture Overview

The security system spans four layers:

1. **`@aionima/security`** (`packages/security/`) — Types, registry, store, runner, built-in scanners
2. **`@aionima/plugins`** (`packages/plugins/`) — `registerScanProvider()` in plugin API
3. **`@aionima/sdk`** (`packages/aion-sdk/`) — `defineScan()` builder, `Security()` ADF facade
4. **`gateway-core`** (`packages/gateway-core/`) — HTTP API routes, server wiring

## Key Files

| File | Purpose |
|------|---------|
| `packages/security/src/types.ts` | All security type definitions |
| `packages/security/src/scan-registry.ts` | `ScanProviderRegistry` — stores scan providers |
| `packages/security/src/scan-runner.ts` | `ScanRunner` — orchestrates scan execution |
| `packages/security/src/scan-store.ts` | `ScanStore` — SQLite persistence at `~/.agi/security.db` |
| `packages/security/src/scanners/sast-scanner.ts` | Built-in SAST scanner |
| `packages/security/src/scanners/sca-scanner.ts` | Built-in SCA scanner |
| `packages/security/src/scanners/secrets-scanner.ts` | Built-in secrets scanner |
| `packages/security/src/scanners/config-scanner.ts` | Built-in config scanner |
| `packages/gateway-core/src/security-api.ts` | HTTP API routes |
| `packages/aion-sdk/src/define-scan.ts` | SDK builder |
| `packages/aion-sdk/src/facades.ts` | `Security()` ADF facade |
| `packages/plugins/src/types.ts` | `registerScanProvider()` in `AionimaPluginAPI` |
| `packages/plugins/src/registry.ts` | Scan provider storage in `PluginRegistry` |
| `packages/plugins/src/loader.ts` | Wires `registerScanProvider` to registry |
| `ui/dashboard/src/components/SecurityTab.tsx` | Per-project security tab |
| `ui/dashboard/src/routes/system-security.tsx` | System-wide security page |

## Adding a Built-in Scanner

1. Create `packages/security/src/scanners/your-scanner.ts`
2. Export a `ScanProviderDefinition` object with `id`, `name`, `scanType`, and `scan` handler
3. Add export to `packages/security/src/scanners/index.ts`
4. Register in `packages/gateway-core/src/server-runtime-state.ts` alongside existing built-in scanners

## Adding a Plugin Scanner

Plugins register scanners via the SDK:

```typescript
import { createPlugin, defineScan } from "@aionima/sdk";

export default createPlugin({
  async activate(api) {
    const scanner = defineScan("my-scanner", "My Scanner")
      .scanType("sast")
      .description("Custom security checks")
      .projectCategories(["web"])
      .handler(async (config, ctx) => {
        // config.targetPath — directory to scan
        // config.excludePaths — glob patterns to skip
        // ctx.logger — structured logger
        // ctx.abortSignal — cancellation signal
        const findings = [];
        // ... scan logic ...
        return findings;
      })
      .build();

    api.registerScanProvider(scanner);
  },
});
```

## SecurityFinding Schema

Each finding returned by a scanner must conform to:

```typescript
interface SecurityFinding {
  id: string;              // UUID (auto-generated if empty)
  scanId: string;          // Set by ScanRunner
  title: string;           // Human-readable summary
  description: string;     // Detailed explanation
  checkId: string;         // Detection rule ID (e.g., "SAST-XSS-01")
  scanType: ScanType;      // "sast" | "dast" | "sca" | "secrets" | "config" | "container" | "custom"
  severity: FindingSeverity; // "critical" | "high" | "medium" | "low" | "info"
  confidence: FindingConfidence; // "high" | "medium" | "low"
  cwe?: string[];          // CWE IDs (e.g., ["CWE-79"])
  owasp?: string[];        // OWASP categories (e.g., ["A03:2021"])
  evidence: FindingEvidence;
  remediation: FindingRemediation;
  standards?: StandardsMapping;
  createdAt: string;       // ISO 8601
  status: FindingStatus;   // "open" | "acknowledged" | "mitigated" | "false_positive"
}
```

## API Endpoints

All endpoints are private-network-only.

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/security/providers` | List available scan providers |
| GET | `/api/security/scans` | Scan history (query: `projectPath`, `limit`, `offset`) |
| GET | `/api/security/scans/:id` | Single scan run details |
| GET | `/api/security/scans/:id/findings` | Findings for a specific scan |
| POST | `/api/security/scans` | Trigger scan (body: `{ scanTypes, targetPath, projectId?, excludePaths? }`) |
| POST | `/api/security/scans/:id/cancel` | Cancel a running scan |
| GET | `/api/security/findings` | Query findings (query: `severity`, `scanType`, `status`, `projectPath`) |
| PUT | `/api/security/findings/:id/status` | Update finding status (body: `{ status }`) |
| GET | `/api/security/summary` | Security posture summary (query: `projectPath`) |

## ADF Facade

Core code can use the `Security()` facade:

```typescript
import { Security } from "@aionima/sdk";

// Run a scan programmatically
const run = await Security().runScan({
  scanTypes: ["sast", "sca"],
  targetPath: "/opt/aionima",
});

// Query findings
const findings = Security().getFindings(run.id);

// List providers
const providers = Security().getProviders();
```

## Database

Scan results persist in `~/.agi/security.db` (SQLite) with two tables:

- `scan_runs` — scan execution records (status, config, timing, counts)
- `security_findings` — individual findings (severity, evidence, remediation, status)

Indexed on `scan_id`, `severity`, `status`, `created_at`, and `scan_type` for efficient querying.

## hasCode Flag

The `ProjectTypeDefinition` interface includes `hasCode: boolean`:
- `true` for categories: web, app, monorepo, ops
- `false` for categories: literature, media, administration
- Inferred from category if not explicitly set by plugin
- Controls Security tab visibility in the dashboard
