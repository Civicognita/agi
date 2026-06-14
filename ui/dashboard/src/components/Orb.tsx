/**
 * Orb — agent presence indicator (pulsing circle) for Aion.
 *
 * Hand-rolled placeholder per CLAUDE.md § 1.5. PAx issue should be filed
 * to upstream this into react-fancy as an ADF-standard agent presence primitive.
 *
 * Design source: _plans/projects-ux-v2/shell.jsx Orb()
 */

interface OrbProps {
  size?: number;
  pulse?: boolean;
  className?: string;
}

export function Orb({ size = 26, pulse = false, className }: OrbProps) {
  return (
    <span
      aria-label="Aion active"
      title="Aion"
      className={className}
      style={{
        display: "inline-flex",
        width: size,
        height: size,
        borderRadius: "50%",
        background: "radial-gradient(circle at 35% 35%, var(--color-primary), color-mix(in srgb, var(--color-primary) 60%, #000))",
        boxShadow: `0 0 0 ${size * 0.06}px color-mix(in srgb, var(--color-primary) 25%, transparent)`,
        flexShrink: 0,
        animation: pulse ? "orb-pulse 2.4s ease-in-out infinite" : undefined,
      }}
    />
  );
}
