import type { MAppCategory, MAppEntry } from "../types.js";

/**
 * Android-style icon grid — one Card per category, icon buttons inside.
 * Mirrors the dashboard's /magic-apps page shape (CATEGORY_ORDER +
 * CATEGORY_LABELS). Categories with zero MApps don't render.
 */

const CATEGORY_ORDER: MAppCategory[] = ["viewer", "production", "tool", "game", "custom"];

const CATEGORY_LABELS: Record<MAppCategory, string> = {
  viewer: "Viewer",
  production: "Production",
  tool: "Tools",
  game: "Games",
  custom: "Custom",
};

const CATEGORY_ICONS: Record<MAppCategory, string> = {
  viewer: "👁️",
  production: "⚒️",
  tool: "🔧",
  game: "🎮",
  custom: "✨",
};

interface CategoryGridProps {
  mapps: MAppEntry[];
  onOpen: (mapp: MAppEntry) => void;
}

export function CategoryGrid({ mapps, onOpen }: CategoryGridProps): React.ReactElement {
  if (mapps.length === 0) {
    return (
      <div className="text-center py-12" data-testid="mapp-desktop-empty">
        <h2 className="text-base font-medium mb-2">No MApps attached</h2>
        <p className="text-xs text-muted">Attach MApps to this project from the MApps tab in the Coordinate section of the dashboard.</p>
      </div>
    );
  }

  const byCategory = new Map<MAppCategory, MAppEntry[]>();
  for (const m of mapps) {
    const list = byCategory.get(m.category) ?? [];
    list.push(m);
    byCategory.set(m.category, list);
  }

  return (
    <div className="flex flex-col gap-4">
      {CATEGORY_ORDER.map((cat) => {
        const items = byCategory.get(cat) ?? [];
        if (items.length === 0) return null;
        return (
          <section
            key={cat}
            className="bg-card border border-border rounded-xl p-5"
            data-testid={`category-card-${cat}`}
          >
            <header className="flex items-center gap-2 mb-4 pb-3 border-b border-border">
              <span className="text-lg">{CATEGORY_ICONS[cat]}</span>
              <h2 className="text-[13px] font-semibold uppercase tracking-wider flex-1">{CATEGORY_LABELS[cat]}</h2>
              <span className="text-[11px] text-muted px-2 py-0.5 bg-bg border border-border rounded-full">{items.length}</span>
            </header>
            <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))" }}>
              {items.map((mapp) => (
                <button
                  key={mapp.id}
                  type="button"
                  data-testid={`mapp-icon-${mapp.id}`}
                  onClick={() => onOpen(mapp)}
                  className="flex flex-col items-center gap-1.5 px-2 py-3 rounded-lg border border-transparent hover:bg-card-hover hover:border-border transition-colors min-h-[88px]"
                  title={mapp.description}
                >
                  <span className="text-[32px] leading-none">{mapp.icon}</span>
                  <span className="text-[11px] font-medium text-center leading-tight">{mapp.name}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
