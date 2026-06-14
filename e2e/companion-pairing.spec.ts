import { test, expect } from "@playwright/test";

/**
 * Companion device pairing e2e spec.
 *
 * Exposes the existing CompanionPairingService (Task #182) over HTTP so LAN
 * companions (e.g. Genie desktop) can pair with the gateway — the response to
 * Civicognita/agi#178 Q5.2a. Flow: owner generates a 6-digit code → device
 * submits code + info → receives a per-device session token.
 */

test.describe("Companion pairing — API layer", () => {
  test("POST /api/companion/pair rejects an invalid code", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/companion/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "000000", deviceName: "Test Laptop", platform: "desktop" }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    // Bad code → 400, never a 500.
    expect(result.status).toBe(400);
  });

  test("POST /api/companion/pair requires code + deviceName", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    const result = await page.evaluate(async () => {
      const res = await fetch("/api/companion/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ deviceName: "no code" }),
      });
      return { status: res.status };
    });
    expect(result.status).toBe(400);
  });

  test("full pairing round-trip: generate code → pair → device listed → revoke", async ({ page }) => {
    await page.goto("/");
    await page.waitForSelector("[data-testid='hearth-top']", { timeout: 10_000 });

    // Generate a code (admin). If the env enforces admin and we have no session,
    // this 403s — skip the round-trip in that case.
    const gen = await page.evaluate(async () => {
      const res = await fetch("/api/companion/pair/code", { method: "POST" });
      return { status: res.status, body: await res.json().catch(() => null) };
    });
    if (gen.status !== 200 || !gen.body?.code) {
      test.skip();
      return;
    }
    expect(typeof gen.body.code).toBe("string");
    expect(gen.body.code).toHaveLength(6);

    // Pair with the generated code.
    const pair = await page.evaluate(async (code: string) => {
      const res = await fetch("/api/companion/pair", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, deviceName: "E2E Laptop", platform: "desktop" }),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    }, gen.body.code as string);

    expect(pair.status).toBe(200);
    expect(typeof pair.body.sessionToken).toBe("string");
    expect(pair.body.device?.platform).toBe("desktop");
    const deviceId = pair.body.device?.id as string;

    // Device shows up in the list.
    const list = await page.evaluate(async () => {
      const res = await fetch("/api/companion/devices");
      return res.ok ? res.json() : null;
    });
    expect(Array.isArray(list?.devices)).toBe(true);
    expect(list.devices.some((d: { id: string }) => d.id === deviceId)).toBe(true);

    // Revoke it.
    const revoke = await page.evaluate(async (id: string) => {
      const res = await fetch(`/api/companion/devices/${id}/revoke`, { method: "POST" });
      return { status: res.status };
    }, deviceId);
    expect(revoke.status).toBe(200);
  });
});
