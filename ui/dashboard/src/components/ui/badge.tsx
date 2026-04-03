/**
 * Badge — wraps react-fancy Badge with our variant API.
 *
 * When consumers pass custom className colors (e.g. bg-green, bg-indigo-600),
 * those are applied as overrides on top of react-fancy's color system.
 */

import { Badge as FancyBadge } from "@particle-academy/react-fancy";
import { cn } from "@particle-academy/react-fancy";
import type { ComponentProps, ReactNode } from "react";

type FancyBadgeProps = ComponentProps<typeof FancyBadge>;

type BadgeVariant = "default" | "secondary" | "destructive" | "outline";

interface BadgeProps extends Omit<FancyBadgeProps, "variant" | "color"> {
  variant?: BadgeVariant;
  onClick?: () => void;
}

function Badge({ variant = "default", className, children, ...rest }: BadgeProps) {
  // Check if className contains custom bg/text colors — if so, render as a
  // styled span instead of react-fancy Badge (which would override our colors)
  const hasCustomColors = className && /\b(bg-|text-)/.test(className);

  if (hasCustomColors) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-transparent",
          className,
        )}
        {...rest}
      >
        {children}
      </span>
    );
  }

  // Standard variant mapping to react-fancy
  const mapped: FancyBadgeProps = { ...rest, children };
  switch (variant) {
    case "secondary":
      mapped.color = "zinc";
      mapped.variant = "soft";
      break;
    case "destructive":
      mapped.color = "red";
      mapped.variant = "solid";
      break;
    case "outline":
      mapped.color = "zinc";
      mapped.variant = "outline";
      break;
    default:
      mapped.color = "blue";
      mapped.variant = "solid";
      break;
  }

  return <FancyBadge className={className} {...mapped} />;
}

export { Badge };
export type { BadgeProps };
