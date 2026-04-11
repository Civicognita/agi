# Testing Plugins

The SDK provides testing utilities at `@aionima/sdk/testing` for unit testing plugins without a running gateway.

---

## testActivate()

The simplest way to test a plugin. It creates a mock API, activates your plugin against it, and returns all registrations:

```typescript
import { describe, it, expect } from "vitest";
import { testActivate } from "@aionima/sdk/testing";
import myPlugin from "../src/index.js";

describe("my-plugin", () => {
  it("registers a service and settings section", async () => {
    const regs = await testActivate(myPlugin);

    expect(regs.services).toHaveLength(1);
    expect(regs.services[0].id).toBe("redis");

    expect(regs.settingsSections).toHaveLength(1);
    expect(regs.settingsSections[0].id).toBe("redis-settings");
  });

  it("registers a startup hook", async () => {
    const regs = await testActivate(myPlugin);

    expect(regs.hooks).toContainEqual(
      expect.objectContaining({ hook: "gateway:startup" })
    );
  });

  it("registers an HTTP route", async () => {
    const regs = await testActivate(myPlugin);

    expect(regs.httpRoutes).toContainEqual({
      method: "GET",
      path: "/api/redis/status",
    });
  });
});
```

### Signature

```typescript
async function testActivate(
  plugin: AionimaPlugin,
  options?: MockAPIOptions
): Promise<MockRegistrations>
```

---

## createMockAPI()

For more control, use `createMockAPI()` directly. It returns both the mock API and the registrations object, letting you inspect the API before or after activation:

```typescript
import { createMockAPI } from "@aionima/sdk/testing";

const { api, registrations } = createMockAPI({
  config: { gateway: { port: 3100 } },
  workspaceRoot: "/tmp/test-workspace",
  projectDirs: ["/tmp/projects"],
});

// Activate manually
await myPlugin.activate(api);

// Inspect registrations
expect(registrations.services).toHaveLength(1);

// Verify accessor methods return mock values
expect(api.getWorkspaceRoot()).toBe("/tmp/test-workspace");
expect(api.getProjectDirs()).toEqual(["/tmp/projects"]);
```

### MockAPIOptions

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `config` | `Record<string, unknown>` | `{}` | Config returned by `api.getConfig()` |
| `workspaceRoot` | `string` | `"."` | Path returned by `api.getWorkspaceRoot()` |
| `projectDirs` | `string[]` | `[]` | Paths returned by `api.getProjectDirs()` |

---

## MockRegistrations

The `MockRegistrations` object captures everything your plugin registered. Each field is an array of the corresponding definition type:

| Field | Type | Maps to |
|-------|------|---------|
| `actions` | `ActionDefinition[]` | `api.registerAction()` |
| `panels` | `ProjectPanelDefinition[]` | `api.registerProjectPanel()` |
| `settingsSections` | `SettingsSectionDefinition[]` | `api.registerSettingsSection()` |
| `settingsPages` | `SettingsPageDefinition[]` | `api.registerSettingsPage()` |
| `dashboardPages` | `DashboardInterfacePageDefinition[]` | `api.registerDashboardPage()` |
| `dashboardDomains` | `DashboardInterfaceDomainDefinition[]` | `api.registerDashboardDomain()` |
| `skills` | `SkillRegistration[]` | `api.registerSkill()` |
| `knowledge` | `KnowledgeNamespace[]` | `api.registerKnowledge()` |
| `systemServices` | `SystemServiceDefinition[]` | `api.registerSystemService()` |
| `themes` | `ThemeDefinition[]` | `api.registerTheme()` |
| `agentTools` | `AgentToolDefinition[]` | `api.registerAgentTool()` |
| `sidebarSections` | `SidebarSectionDefinition[]` | `api.registerSidebarSection()` |
| `scheduledTasks` | `ScheduledTaskDefinition[]` | `api.registerScheduledTask()` |
| `workflows` | `WorkflowDefinition[]` | `api.registerWorkflow()` |
| `httpRoutes` | `{ method: string; path: string }[]` | `api.registerHttpRoute()` |
| `runtimes` | `RuntimeDefinition[]` | `api.registerRuntime()` |
| `services` | `ServiceDefinition[]` | `api.registerService()` |
| `stacks` | `StackDefinition[]` | `api.registerStack()` |
| `channels` | `string[]` | `api.registerChannel()` |
| `providers` | `LLMProviderDefinition[]` | `api.registerProvider()` |
| `hooks` | `{ hook: string; handler: unknown }[]` | `api.registerHook()` |

---

## Testing Stack Plugins

Stack plugins that register container images should verify they use custom GHCR images (not vanilla upstream) and have correct dependency requirements:

```typescript
import { describe, it, expect } from "vitest";
import { testActivate } from "@aionima/sdk/testing";
import plugin from "./index.js";

describe("TALL stack plugin", () => {
  it("expects laravel (dependency on Laravel stack)", async () => {
    const reg = await testActivate(plugin);
    const tall = reg.stacks[0]!;
    const expected = tall.requirements.filter((r) => r.type === "expected");
    expect(expected[0]!.id).toBe("laravel");
  });

  it("does NOT provide laravel (no conflict with Laravel stack)", async () => {
    const reg = await testActivate(plugin);
    const tall = reg.stacks[0]!;
    const provided = tall.requirements.filter((r) => r.type === "provided").map((r) => r.id);
    expect(provided).not.toContain("laravel");
  });

  it("uses GHCR images for container config", async () => {
    const reg = await testActivate(plugin);
    for (const stack of reg.stacks) {
      if (stack.containerConfig) {
        expect(stack.containerConfig.image).toMatch(/^ghcr\.io\/civicognita\//);
      }
    }
  });
});
```

All runtime, service, and stack plugins should have tests verifying their image references use `ghcr.io/civicognita/*`. This prevents regressions when upstream images change.

---

## Complete Example

A full test file for a hypothetical monitoring plugin:

```typescript
import { describe, it, expect } from "vitest";
import { testActivate, createMockAPI } from "@aionima/sdk/testing";
import monitorPlugin from "../src/index.js";

describe("plugin-monitor", () => {
  it("registers all expected capabilities", async () => {
    const regs = await testActivate(monitorPlugin, {
      config: { gateway: { port: 3100 } },
    });

    // Should register a settings section
    expect(regs.settingsSections).toHaveLength(1);
    expect(regs.settingsSections[0].id).toBe("monitor-settings");

    // Should register an agent tool
    expect(regs.agentTools).toHaveLength(1);
    expect(regs.agentTools[0].name).toBe("check_service_health");

    // Should register a scheduled task for periodic checks
    expect(regs.scheduledTasks).toHaveLength(1);
    expect(regs.scheduledTasks[0].intervalMs).toBe(60_000);

    // Should register API routes
    expect(regs.httpRoutes).toEqual(
      expect.arrayContaining([
        { method: "GET", path: "/api/monitor/status" },
        { method: "POST", path: "/api/monitor/check" },
      ])
    );
  });

  it("agent tool handler returns health data", async () => {
    const { api, registrations } = createMockAPI();
    await monitorPlugin.activate(api);

    const tool = registrations.agentTools[0];
    const result = await tool.handler(
      { service: "redis" },
      { sessionId: "test", entityId: "test-entity" }
    );

    expect(result).toHaveProperty("healthy");
  });
});
```
