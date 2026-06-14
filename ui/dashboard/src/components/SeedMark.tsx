/**
 * SeedMark — Aionima brand icon (vertical teardrop seed, gold/bronze gradient).
 *
 * Hand-rolled placeholder per CLAUDE.md § 1.5. A PAx issue should be filed
 * to upstream this as a react-fancy branded icon primitive so every ADF app
 * gets it for free without duplicating the SVG.
 *
 * Design source: _plans/projects-ux-v2/shell.jsx SeedMark()
 */

interface SeedMarkProps {
  size?: number;
  className?: string;
}

export function SeedMark({ size = 30, className }: SeedMarkProps) {
  return (
    <span
      className={className}
      style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: size, height: size * 1.2, flexShrink: 0 }}
      aria-hidden="true"
    >
      <svg width={size} height={size * 1.2} viewBox="0 0 32 40" fill="none">
        <defs>
          <linearGradient id="seed-grad" x1="0" y1="0" x2="0.4" y2="1">
            <stop offset="0" stopColor="#ecc878" />
            <stop offset="0.55" stopColor="#d39a36" />
            <stop offset="1" stopColor="#9a6a23" />
          </linearGradient>
        </defs>
        {/* outer teardrop */}
        <path d="M16 1.5C24 11 24.5 29 16 38.5 7.5 29 8 11 16 1.5Z" fill="url(#seed-grad)" />
        {/* centre vein */}
        <path d="M16 8.5C19.3 16 19.3 24.5 16 31.5" stroke="#6f4d16" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.5" />
        {/* highlight */}
        <path d="M16 8.5C13 15 12.8 23 15 30" stroke="#f5dca0" strokeWidth="1" fill="none" strokeLinecap="round" opacity="0.45" />
      </svg>
    </span>
  );
}
