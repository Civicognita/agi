/**
 * ProfileCard — portable, themeable user profile card.
 *
 * Designed to work in the dashboard popover and the ID service.
 * Supports custom background image, profile image frame, and tagline.
 */

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

// ---------------------------------------------------------------------------
// Channel icon SVGs (inline for portability — no external icon deps)
// ---------------------------------------------------------------------------

const CHANNEL_ICONS: Record<string, { label: string; icon: JSX.Element }> = {
  telegram: {
    label: "Telegram",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  discord: {
    label: "Discord",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" />
      </svg>
    ),
  },
  signal: {
    label: "Signal",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm3.7 14.3c-.2.2-.5.2-.7 0L12 13.4l-3 2.9c-.2.2-.5.2-.7 0-.2-.2-.2-.5 0-.7l2.9-3-2.9-3c-.2-.2-.2-.5 0-.7.2-.2.5-.2.7 0l3 2.9 3-2.9c.2-.2.5-.2.7 0 .2.2.2.5 0 .7L12.7 12l2.9 3c.2.2.2.5.1.7z" />
      </svg>
    ),
  },
  whatsapp: {
    label: "WhatsApp",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" />
      </svg>
    ),
  },
  email: {
    label: "Email",
    icon: (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
    ),
  },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileCardTheme {
  /** URL to a background image for the card header. */
  backgroundImage?: string;
  /** URL to a profile image (overrides initial avatar). */
  profileImage?: string;
  /** CSS class or style for the profile image frame (e.g., "rounded-full", "rounded-lg border-2 border-gold"). */
  frameClass?: string;
  /** Accent color for the avatar background (CSS color value). */
  accentColor?: string;
}

export interface ProfileCardProps {
  displayName: string;
  tagline?: string;
  /** Channel id → display value. Accepts both the named-key `OwnerChannels`
   *  interface (telegram/discord/signal/whatsapp/email) and the generic
   *  index-signature shape via overlapping intersection. The component
   *  iterates entries indiscriminately, so any object with string-or-undefined
   *  values is safe. */
  channels?: { readonly [key: string]: string | undefined };
  dmPolicy?: "pairing" | "open";
  theme?: ProfileCardTheme;
  className?: string;
  /** Show full channel identifiers (IDs/numbers) or just icons. */
  showChannelIds?: boolean;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ProfileCard({
  displayName,
  tagline,
  channels = {},
  dmPolicy,
  theme: cardTheme,
  className,
  showChannelIds = false,
}: ProfileCardProps) {
  const initial = displayName.charAt(0).toUpperCase();
  const configuredChannels = Object.entries(channels).filter(([, v]) => v);

  return (
    <Card className={cn("w-[280px] overflow-hidden", className)}>
      {/* Header with optional background image */}
      <div
        className={cn(
          "h-16 relative",
          cardTheme?.backgroundImage ? "bg-cover bg-center" : "bg-gradient-to-br from-primary/30 to-primary/10",
        )}
        style={cardTheme?.backgroundImage ? { backgroundImage: `url(${cardTheme.backgroundImage})` } : undefined}
      >
        {/* Avatar positioned at the bottom-left, overlapping the header */}
        <div className="absolute -bottom-5 left-4">
          {cardTheme?.profileImage ? (
            <img
              src={cardTheme.profileImage}
              alt={displayName}
              className={cn(
                "w-10 h-10 object-cover border-2 border-card",
                cardTheme.frameClass ?? "rounded-full",
              )}
            />
          ) : (
            <div
              className={cn(
                "w-10 h-10 flex items-center justify-center text-sm font-bold border-2 border-card",
                cardTheme?.frameClass ?? "rounded-full",
              )}
              style={{ backgroundColor: cardTheme?.accentColor ?? "var(--color-primary)", color: "var(--color-card)" }}
            >
              {initial}
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div className="pt-7 px-4 pb-4 space-y-3">
        {/* Name + tagline */}
        <div>
          <div className="text-sm font-semibold text-foreground">{displayName}</div>
          {tagline && <div className="text-xs text-subtext0 mt-0.5">{tagline}</div>}
        </div>

        {/* DM Policy badge */}
        {dmPolicy && (
          <Badge variant="outline" className="text-[10px]">
            {dmPolicy === "pairing" ? "Pairing Required" : "Open DMs"}
          </Badge>
        )}

        {/* Channels */}
        {configuredChannels.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-subtext1 font-medium">Channels</div>
              {configuredChannels.map(([channelId, value]) => {
                const channelInfo = CHANNEL_ICONS[channelId];
                if (!channelInfo) return null;
                return (
                  <div key={channelId} className="flex items-center gap-2 text-xs text-subtext0">
                    <span className="text-foreground/70">{channelInfo.icon}</span>
                    <span className="font-medium text-foreground">{channelInfo.label}</span>
                    {showChannelIds && value && (
                      <span className="text-subtext1 truncate ml-auto text-[10px] max-w-[120px]">{value}</span>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </Card>
  );
}
