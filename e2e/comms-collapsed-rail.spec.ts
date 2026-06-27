import { test, expect } from "@playwright/test";

/**
 * Collapsed-rail geometry guard for the 3-panel Hearth shell (root.tsx).
 *
 * Owner report 2026-06-14 (debug screenshot): the collapsed CANVAS / CHAT /
 * WORKSPACE rails render staggered/overlapping instead of as three aligned
 * full-height strips. Static source analysis said the layout *should* be
 * correct (AccordionPanel root is items-stretch), so this spec extracts the
 * REAL rendered geometry to find the divergence and then guards it.
 *
 * Acceptance: with all three panels collapsed, the three rail headers must
 * share the same top (y) and the same height (full shell height), and tile
 * left-to-right without overlap.
 */
test.describe("Hearth shell — collapsed rail geometry", () => {
  test("three collapsed rails are aligned, full-height, non-overlapping", async ({ page }) => {
    await page.goto("/comms");
    await expect(page.getByTestId("hearth-layout")).toBeVisible();

    const labels = ["workspace", "chat", "canvas"];

    // Collapse any open panel (open header exposes a `shell-panel-toggle-*`).
    for (const l of labels) {
      const toggle = page.getByTestId(`shell-panel-toggle-${l}`);
      if (await toggle.count()) {
        await toggle.click().catch(() => {});
      }
    }

    // Measure each rail header + its rotated label.
    const geo = await page.evaluate((ls) => {
      const layout = document.querySelector('[data-testid="hearth-layout"]') as HTMLElement | null;
      const layoutRect = layout?.getBoundingClientRect();
      return ls.map((l) => {
        const el = document.querySelector(`[data-testid="shell-panel-header-${l}"]`) as HTMLElement | null;
        if (!el) return { l, missing: true };
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const span = el.querySelector("span");
        const sr = span?.getBoundingClientRect();
        const scs = span ? getComputedStyle(span) : null;
        return {
          l,
          y: Math.round(r.y),
          h: Math.round(r.height),
          x: Math.round(r.x),
          w: Math.round(r.width),
          state: el.getAttribute("data-state") ?? el.getAttribute("aria-expanded"),
          alignSelf: cs.alignSelf,
          writingMode: scs?.writingMode,
          spanW: sr ? Math.round(sr.width) : null,
          spanH: sr ? Math.round(sr.height) : null,
        };
      }).concat([{ l: "__layout__", y: Math.round(layoutRect?.y ?? -1), h: Math.round(layoutRect?.height ?? -1), x: 0, w: 0 } as any]);
    }, labels);

    // Surface the real numbers in the test output for diagnosis.
    console.log("COLLAPSED_RAIL_GEO " + JSON.stringify(geo));

    const rails = geo.filter((g: any) => !g.missing && g.l !== "__layout__") as any[];
    expect(rails.length).toBe(3);

    const ys = rails.map((r) => r.y);
    const hs = rails.map((r) => r.h);
    const maxY = Math.max(...ys), minY = Math.min(...ys);
    const maxH = Math.max(...hs), minH = Math.min(...hs);

    // All rails share the same top and the same (full) height.
    expect(maxY - minY, `rail tops diverge: ${JSON.stringify(ys)}`).toBeLessThanOrEqual(2);
    expect(maxH - minH, `rail heights diverge: ${JSON.stringify(hs)}`).toBeLessThanOrEqual(2);

    // Rails tile left-to-right without horizontal overlap.
    const sorted = [...rails].sort((a, b) => a.x - b.x);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].x, `rail ${sorted[i].l} overlaps ${sorted[i - 1].l}`).toBeGreaterThanOrEqual(
        sorted[i - 1].x + sorted[i - 1].w - 1,
      );
    }
  });
});
