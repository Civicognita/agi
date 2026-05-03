import { describe, it, expect } from "vitest";
import { buildMultiRepoContainerArgsPure, type MultiRepoArgsInput } from "./hosting-manager.js";

const baseInput: Omit<MultiRepoArgsInput, "projectConfig"> = {
  hostname: "myapp",
  projectPath: "/home/owner/projects/myapp",
  mode: "development",
  containerName: "agi-myapp",
  aiBindingArgs: { envArgs: [], volumeArgs: [] },
  networkName: "agi-net-myapp",
};

describe("buildMultiRepoContainerArgsPure (s130 t515 B4)", () => {
  it("returns null when projectConfig is null", () => {
    expect(buildMultiRepoContainerArgsPure({ ...baseInput, projectConfig: null })).toBeNull();
  });

  it("returns null when no repos array", () => {
    expect(buildMultiRepoContainerArgsPure({ ...baseInput, projectConfig: {} })).toBeNull();
  });

  it("returns null when no runtime repos (no port set anywhere)", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "lib", url: "u" }, // no port — code-only
        { name: "docs", url: "u" }, // no port — code-only
      ] },
    });
    expect(result).toBeNull();
  });

  it("returns args + internalPort for a 2-repo runtime project", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true, writable: false },
        { name: "api", url: "u", port: 8001, startCommand: "node dist/server.js", externalPath: "/api", writable: true },
      ] },
    });
    expect(result).not.toBeNull();
    expect(result!.internalPort).toBe(5173);

    const args = result!.args;
    expect(args).toContain("run");
    expect(args).toContain("-d");
    expect(args).toContain("agi-myapp");
    expect(args).toContain("--network=agi-net-myapp");
    expect(args).toContain("agi.multi-repo=true");
    expect(args).toContain("agi-runtime:lamp");

    // working dir is the default repo
    const wIdx = args.indexOf("-w");
    expect(args[wIdx + 1]).toBe("/srv/repos/web");

    // Bind mounts: web (read-only via writable=false → ro,Z); api (writable=true → Z)
    expect(args).toContain("/home/owner/projects/myapp/repos/web:/srv/repos/web:ro,Z");
    expect(args).toContain("/home/owner/projects/myapp/repos/api:/srv/repos/api:Z");

    // Env vars
    expect(args).toContain("NODE_ENV=development");
    expect(args).toContain("AGI_PROJECT=myapp");
    expect(args).toContain("AGI_DEFAULT_REPO=web");

    // Concurrently invocation in the bash -lc tail
    const lastArg = args[args.length - 1];
    expect(lastArg).toContain("npx -y concurrently");
    expect(lastArg).toContain("--names 'web,api'");
    expect(lastArg).toContain("cd /srv/repos/web && pnpm dev");
    expect(lastArg).toContain("cd /srv/repos/api && node dist/server.js");
    expect(lastArg).toContain("--kill-others-on-fail=false");
    expect(lastArg).toContain("--restart-tries=10");
  });

  it("uses first runtime repo as default when none marked isDefault", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "api", url: "u", port: 8001, startCommand: "node dist/server.js" },
        { name: "web", url: "u", port: 5173, startCommand: "pnpm dev" },
      ] },
    });
    expect(result!.internalPort).toBe(8001); // api is first runtime repo
    expect(result!.args).toContain("AGI_DEFAULT_REPO=api");
  });

  it("skips autoRun=false repos from concurrently (still bind-mounted)", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true, autoRun: true },
        { name: "ondemand", url: "u", port: 9000, startCommand: "node cron.js", autoRun: false },
      ] },
    });
    const args = result!.args;
    // Bind mount for ondemand still present
    expect(args.some((a) => a.includes("/srv/repos/ondemand"))).toBe(true);
    // But concurrently command DOES NOT include ondemand
    const lastArg = args[args.length - 1];
    expect(lastArg).toContain("--names 'web'"); // only web
    expect(lastArg).not.toContain("ondemand");
  });

  it("emits sleep-infinity when all repos are autoRun=false", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "ondemand1", url: "u", port: 9000, startCommand: "node a.js", autoRun: false },
        { name: "ondemand2", url: "u", port: 9001, startCommand: "node b.js", autoRun: false },
      ] },
    });
    const args = result!.args;
    const lastArg = args[args.length - 1];
    expect(lastArg).toContain("autoRun=false on all repos");
    expect(lastArg).toContain("sleep infinity");
    expect(lastArg).not.toContain("concurrently");
  });

  it("merges per-repo env vars into the concurrently command", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "api", url: "u", port: 8001, startCommand: "node dist/server.js", isDefault: true,
          env: { LOG_LEVEL: "info", DATABASE_URL: "postgres://example" } },
      ] },
    });
    const lastArg = result!.args[result!.args.length - 1];
    // Env vars are nested inside the outer shell-escape wrapping the
    // whole `cd ... && <env> <cmd>` string. Single quotes get escaped
    // as '\''. So 'info' inside an outer quoted string reads as
    // '\''info'\''. Assert on the unambiguous variable name + the
    // command tail.
    expect(lastArg).toContain("LOG_LEVEL=");
    expect(lastArg).toContain("info");
    expect(lastArg).toContain("DATABASE_URL=");
    expect(lastArg).toContain("postgres://example");
    expect(lastArg).toContain("node dist/server.js");
  });

  it("respects optional path override on a repo", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true, path: "/custom/checkout" },
      ] },
    });
    const args = result!.args;
    expect(args.some((a) => a === "/custom/checkout:/srv/repos/web:ro,Z")).toBe(true);
  });

  it("passes tunnelOrigin into HOSTNAME_ALLOWED_ORIGIN env when provided", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      tunnelOrigin: "myapp.cf-tunnel.dev",
      projectConfig: { repos: [
        { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true },
      ] },
    });
    expect(result!.args).toContain("HOSTNAME_ALLOWED_ORIGIN=myapp.cf-tunnel.dev");
  });

  it("threads aiBindingArgs into the args ahead of the image token", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      aiBindingArgs: {
        envArgs: ["-e", "AIONIMA_MODEL_FOO=bar"],
        volumeArgs: ["-v", "/some/dataset:/data:ro"],
      },
      projectConfig: { repos: [
        { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true },
      ] },
    });
    const args = result!.args;
    const imageIdx = args.indexOf("agi-runtime:lamp");
    const envIdx = args.indexOf("AIONIMA_MODEL_FOO=bar");
    const volIdx = args.indexOf("/some/dataset:/data:ro");
    // env + volume args must come BEFORE image token (otherwise they'd be passed as cmd args)
    expect(envIdx).toBeGreaterThan(-1);
    expect(volIdx).toBeGreaterThan(-1);
    expect(envIdx).toBeLessThan(imageIdx);
    expect(volIdx).toBeLessThan(imageIdx);
  });

  it("supports image override for testing alternate runtimes", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      image: "agi-runtime:custom",
      projectConfig: { repos: [
        { name: "web", url: "u", port: 5173, startCommand: "pnpm dev", isDefault: true },
      ] },
    });
    expect(result!.args).toContain("agi-runtime:custom");
    expect(result!.args).not.toContain("agi-runtime:lamp");
  });

  it("respects production mode in NODE_ENV", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      mode: "production",
      projectConfig: { repos: [
        { name: "web", url: "u", port: 5173, startCommand: "pnpm start", isDefault: true },
      ] },
    });
    expect(result!.args).toContain("NODE_ENV=production");
  });

  it("shell-escapes startCommand strings with single quotes", () => {
    const result = buildMultiRepoContainerArgsPure({
      ...baseInput,
      projectConfig: { repos: [
        { name: "tricky", url: "u", port: 5173, startCommand: "echo 'hello world' && node app.js", isDefault: true },
      ] },
    });
    const lastArg = result!.args[result!.args.length - 1];
    // The single quotes inside the command are escaped via the
    // single-quote-then-quote-escape pattern
    expect(lastArg).toContain("'cd /srv/repos/tricky && echo");
  });
});
