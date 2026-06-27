/**
 * Settings → Appearance (Wave 5) — UI customization: theme, corner radius,
 * motion, and spacing density. All controls apply live (via AppearanceProvider /
 * ThemeProvider setting documentElement CSS vars) and persist to gateway.json.
 */
import { PageScroll } from "@/components/PageScroll.js";
import { Card } from "@/components/ui/card.js";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme-provider.js";
import { useAppearance, type Appearance } from "@/lib/appearance-provider.js";

function PresetRow<T extends string | number>({ label, hint, options, value, onSelect, testid }: {
  label: string;
  hint?: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onSelect: (v: T) => void;
  testid?: string;
}) {
  return (
    <div className="space-y-1.5">
      <div>
        <div className="text-[13px] font-medium text-foreground">{label}</div>
        {hint !== undefined && <div className="text-[11px] text-muted-foreground">{hint}</div>}
      </div>
      <div className="flex gap-2 flex-wrap" data-testid={testid}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onSelect(o.value)}
            aria-pressed={value === o.value}
            className={cn(
              "px-3 py-1.5 rounded-lg border text-[12px] transition-colors cursor-pointer",
              value === o.value
                ? "border-primary text-primary bg-primary/10"
                : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40",
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function SettingsAppearancePage() {
  const { themeId, setTheme, themes } = useTheme();
  const { appearance, update } = useAppearance();

  return (
    <PageScroll>
      <div className="max-w-[800px] w-full mx-auto p-4 md:p-6 space-y-4" data-testid="settings-appearance-page">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Appearance</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Theme, corner roundness, motion, and spacing. Changes apply instantly and persist.
          </p>
        </div>

        <Card className="p-4 space-y-3">
          <div className="text-[13px] font-medium text-foreground">Theme</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2" data-testid="appearance-themes">
            {themes.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTheme(t.id)}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-lg border text-left transition-colors cursor-pointer",
                  themeId === t.id ? "border-primary ring-1 ring-primary" : "border-border hover:bg-secondary/40",
                )}
                data-testid={`appearance-theme-${t.id}`}
              >
                <span className="w-4 h-4 rounded-full border border-border shrink-0" style={{ background: t.properties["--color-primary"] ?? "#888" }} />
                <span className="min-w-0">
                  <span className="block text-[12px] font-medium text-foreground truncate">{t.name}</span>
                  <span className="block text-[10px] text-muted-foreground">{t.dark ? "Dark" : "Light"}</span>
                </span>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4 space-y-4">
          <PresetRow
            label="Corner radius"
            hint="How round cards, inputs, and panels are."
            options={[{ value: 1, label: "Subtle" }, { value: 0.6, label: "Sharp" }, { value: 0.15, label: "Near-square" }]}
            value={appearance.radiusScale}
            onSelect={(v) => update({ radiusScale: v })}
            testid="appearance-radius"
          />
          <PresetRow
            label="Motion"
            hint="Transition speed across the app."
            options={[{ value: "snappy", label: "Snappy" }, { value: "default", label: "Default" }, { value: "relaxed", label: "Relaxed" }]}
            value={appearance.motion}
            onSelect={(v) => update({ motion: v as Appearance["motion"] })}
            testid="appearance-motion"
          />
          <PresetRow
            label="Spacing density"
            hint="Padding and gaps throughout."
            options={[{ value: "compact", label: "Compact" }, { value: "comfortable", label: "Comfortable" }, { value: "spacious", label: "Spacious" }]}
            value={appearance.density}
            onSelect={(v) => update({ density: v as Appearance["density"] })}
            testid="appearance-density"
          />
          <label className="flex items-center justify-between gap-4 pt-1 cursor-pointer">
            <span>
              <span className="block text-[13px] font-medium text-foreground">Reduce motion</span>
              <span className="block text-[11px] text-muted-foreground">Minimize animations + transitions (also honors your OS setting).</span>
            </span>
            <input
              type="checkbox"
              checked={appearance.reduceMotion}
              onChange={(e) => update({ reduceMotion: e.target.checked })}
              data-testid="appearance-reduce-motion"
            />
          </label>
        </Card>
      </div>
    </PageScroll>
  );
}
