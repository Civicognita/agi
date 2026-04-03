/**
 * Entity Impact Profile — Task #151
 *
 * Public-facing entity profile page (opt-in).
 * Shows: display name, verification tier, total $imp, domain breakdown,
 * recent recognitions, skills authored. Privacy controls for visibility.
 */

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { fetchEntityProfile } from "../api.js";
import type { EntityImpactProfile } from "../types.js";

export interface EntityProfileProps {
  entityId: string;
  theme?: "light" | "dark";
}

const TIER_BADGES: Record<string, { label: string; className: string; avatarClass: string }> = {
  unverified: {
    label: "Unverified",
    className: "bg-surface1 text-muted-foreground border-transparent",
    avatarClass: "from-surface1 to-surface0",
  },
  verified: {
    label: "Verified",
    className: "bg-blue text-background border-transparent",
    avatarClass: "from-blue to-surface1",
  },
  sealed: {
    label: "0R Sealed",
    className: "bg-green text-background border-transparent",
    avatarClass: "from-green to-surface1",
  },
};

const DOMAIN_COLORS: Record<string, string> = {
  governance: "bg-mauve",
  community: "bg-blue",
  innovation: "bg-green",
  operations: "bg-yellow",
  knowledge: "bg-flamingo",
  technology: "bg-teal",
};

function domainColorClass(domain: string): string {
  return DOMAIN_COLORS[domain] ?? "bg-blue";
}

function formatImp(value: number): string {
  if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toFixed(2);
}

export function EntityProfile({ entityId }: EntityProfileProps) {
  const [profile, setProfile] = useState<EntityImpactProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    void fetchEntityProfile(entityId)
      .then((p) => {
        setProfile(p);
        setError(null);
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      })
      .finally(() => setLoading(false));
  }, [entityId]);

  if (loading) {
    return (
      <div className="py-10 text-center text-muted-foreground">Loading profile...</div>
    );
  }
  if (error !== null) {
    return (
      <div className="py-10 text-center text-red">{error}</div>
    );
  }
  if (profile === null) {
    return (
      <div className="py-10 text-center text-muted-foreground">Entity not found</div>
    );
  }

  const tierBadge = TIER_BADGES[profile.verificationTier] ?? TIER_BADGES["unverified"]!;

  const stats = [
    { label: "Lifetime $imp", value: formatImp(profile.lifetimeImp) },
    { label: "90d $imp", value: formatImp(profile.windowImp) },
    { label: "0BONUS", value: `+${(profile.currentBonus * 100).toFixed(0)}%` },
    { label: "Event Types", value: String(profile.distinctEventTypes) },
  ];

  return (
    <Card className="gap-0 py-0">
      <CardContent className="p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <div
            className={cn(
              "w-16 h-16 rounded-full bg-gradient-to-br flex items-center justify-center shrink-0 text-2xl font-bold text-white",
              tierBadge.avatarClass,
            )}
          >
            {profile.entityName.charAt(0).toUpperCase()}
          </div>
          <div>
            <h2 className="text-[22px] font-semibold text-card-foreground m-0">
              {profile.entityName}
            </h2>
            <div className="flex items-center gap-2 mt-1">
              <Badge className={tierBadge.className}>{tierBadge.label}</Badge>
              <span className="text-[12px] text-muted-foreground">{profile.coaAlias}</span>
            </div>
          </div>
        </div>

        {/* Stats grid */}
        <div className="grid grid-cols-4 gap-3 mb-6">
          {stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-mantle rounded-lg p-3 text-center"
            >
              <div className="text-[11px] text-muted-foreground">{stat.label}</div>
              <div className="text-[20px] font-bold text-card-foreground mt-1">{stat.value}</div>
            </div>
          ))}
        </div>

        {/* Domain breakdown */}
        {profile.domainBreakdown.length > 0 && (
          <div className="mb-5">
            <h4 className="text-[14px] font-medium text-card-foreground mb-2">Domain Breakdown</h4>
            {profile.domainBreakdown.map((slice) => (
              <div key={slice.key} className="flex items-center gap-2 mb-1">
                <div
                  className={cn(
                    "h-5 rounded",
                    domainColorClass(slice.key),
                  )}
                  style={{ width: `${Math.max(slice.percentage, 2)}%`, maxWidth: "60%" }}
                />
                <span className="text-[12px] text-card-foreground min-w-[80px]">{slice.key}</span>
                <span className="text-[12px] text-muted-foreground">
                  {formatImp(slice.totalImp)} ({slice.percentage.toFixed(0)}%)
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Recent activity */}
        {profile.recentActivity.length > 0 && (
          <div>
            <h4 className="text-[14px] font-medium text-card-foreground mb-2">Recent Activity</h4>
            <div className="max-h-[200px] overflow-auto">
              {profile.recentActivity.slice(0, 10).map((entry) => (
                <div
                  key={entry.id}
                  className="flex justify-between items-center py-1.5 border-b border-border text-[12px]"
                >
                  <span className="text-muted-foreground">{entry.workType ?? "interaction"}</span>
                  <span
                    className={cn(
                      "font-semibold",
                      entry.impScore >= 0 ? "text-green" : "text-red",
                    )}
                  >
                    {entry.impScore >= 0 ? "+" : ""}{formatImp(entry.impScore)}
                  </span>
                  <span className="text-muted-foreground">
                    {new Date(entry.createdAt).toLocaleDateString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
