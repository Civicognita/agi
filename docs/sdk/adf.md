# ADF — Application Development Framework

The ADF provides global framework helpers for AGI core code — logging, config access, workspace info, security scanning, and project/system config — without threading dependencies through every call site.

**Plugins must not use ADF.** Plugins receive equivalent capabilities through `AionimaPluginAPI`. See the mapping table at the bottom of this page.

---

## Initialization

ADF is initialized once at gateway boot before any plugins activate:

```typescript
import { initADF } from "@aionima/sdk";

initADF({
  logger,
  config: rawConfig,
  workspaceRoot: "/home/wishborn/temp_core",
  projectDirs: [...],
  security: securityModule,      // optional — requires @aionima/security
  projectConfig: projectConfigMgr, // optional
  systemConfig: systemConfigSvc,   // optional
});
```

To get the raw context object after initialization:

```typescript
import { getADFContext } from "@aionima/sdk";

const ctx = getADFContext(); // throws if initADF() was not called
```

---

## ADFContext Interface

```typescript
interface ADFContext {
  logger: ADFLogger;
  config: Record<string, unknown>;
  workspaceRoot: string;
  projectDirs: string[];
  security?: ADFSecurityContext;
  projectConfig?: ADFProjectConfigContext;
  systemConfig?: ADFSystemConfigContext;
}
```

---

## The Six Facades

Import any facade from `@aionima/sdk`:

```typescript
import { Log, Config, Workspace, Security, ProjectConfig, SystemConfig } from "@aionima/sdk";
```

### `Log()`

Structured logger with `debug`, `info`, `warn`, and `error` methods.

```typescript
Log().info("Gateway started");
Log().error("Unhandled exception in pipeline");
```

### `Config()`

Read-only dot-path accessor over `gateway.json`. Always reads from the snapshot captured at `initADF()` — for live reads use `SystemConfig()`.

```typescript
const enabled = Config().get<boolean>("hosting.enabled");
const port = Config().getOrThrow<number>("gateway.port");
const hasKey = Config().has("features.experimental");
```

Methods: `.get<T>(path)`, `.getOrThrow<T>(path)`, `.has(path)`.

### `Workspace()`

Returns workspace root and project directory paths.

```typescript
const { root, projects } = Workspace();
```

### `Security()`

Security scanning facade. Throws if `@aionima/security` is not loaded.

```typescript
const scan = await Security().runScan({
  scanTypes: ["mapp", "deps"],
  targetPath: "/home/wishborn/.agi/mapps/civicognita/reader.json",
  severityThreshold: "medium",
});
const findings = Security().getFindings(scan.scanId);
const providers = Security().getProviders();
```

### `ProjectConfig()`

Read-only access to per-project config files (`~/.agi/{slug}/project.json`).

```typescript
const cfg = ProjectConfig().read("/path/to/project");
const hosting = ProjectConfig().readHosting("/path/to/project");
const stacks = ProjectConfig().getStacks("/path/to/project");
```

### `SystemConfig()`

Read/write access to `gateway.json`. Reads directly from disk; writes are persisted immediately.

```typescript
const allConfig = SystemConfig().read();
const channelEnabled = SystemConfig().readKey("channels.telegram.enabled");
SystemConfig().patch("hosting.port", 3000);
```

---

## ADF Facade → Plugin Equivalent

| ADF Facade | Plugin Equivalent | Notes |
|------------|------------------|-------|
| `Log()` | `api.getLogger()` | Same `ADFLogger` interface |
| `Config()` | `api.getConfig()` | Plugin config is scoped to plugin namespace |
| `Workspace()` | `api.getWorkspaceRoot()` | Returns root path only |
| `Security()` | — | No plugin equivalent; plugins don't run scans |
| `ProjectConfig()` | `api.getProjectConfig()` | Read-only, scoped to the requesting plugin |
| `SystemConfig()` | — | No plugin equivalent; use `api.getConfig()` for plugin settings |

Never use ADF facades in plugin code — use `AionimaPluginAPI` instead.

---

## Key File

`packages/aion-sdk/src/adf-context.ts` — ADF implementation
