/**
 * Button — wraps react-fancy Action component with our variant/size API.
 *
 * react-fancy's Action supports variant, color, size, and className.
 * We map our legacy variant names to the appropriate Action props and
 * forward className for custom styling.
 */

import { Action } from "@particle-academy/react-fancy";
import { cn } from "@particle-academy/react-fancy";
import type { ComponentProps } from "react";

type ActionProps = ComponentProps<typeof Action>;

type ButtonVariant = "default" | "destructive" | "outline" | "secondary" | "ghost" | "link";
type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

interface ButtonProps extends Omit<ActionProps, "variant" | "size" | "color"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

function Button({ variant = "default", size = "default", className, ...rest }: ButtonProps) {
  const actionProps: ActionProps = { ...rest };

  // Map variant → react-fancy color + variant
  switch (variant) {
    case "destructive":
      actionProps.color = "red";
      break;
    case "outline":
      actionProps.variant = "outline";
      actionProps.color = "zinc";
      break;
    case "secondary":
      actionProps.color = "zinc";
      break;
    case "ghost":
      actionProps.variant = "ghost";
      break;
    case "link":
      actionProps.variant = "link";
      break;
    default:
      // "default" — solid blue (react-fancy default)
      break;
  }

  // Map size — icon sizes use circle variant but preserve color from above
  let isCircle = false;
  switch (size) {
    case "xs": actionProps.size = "xs"; break;
    case "sm": actionProps.size = "sm"; break;
    case "lg": actionProps.size = "lg"; break;
    case "icon": actionProps.size = "md"; isCircle = true; break;
    case "icon-xs": actionProps.size = "xs"; isCircle = true; break;
    case "icon-sm": actionProps.size = "sm"; isCircle = true; break;
    case "icon-lg": actionProps.size = "lg"; isCircle = true; break;
    default: actionProps.size = "md"; break;
  }

  // Circle variant for icon buttons — only set if we're not already using
  // a semantic variant (ghost, outline, link) that should be preserved
  if (isCircle && !actionProps.variant) {
    actionProps.variant = "circle";
  }

  // Apply className — use cn to merge with any existing styles
  actionProps.className = cn(className);

  return <Action {...actionProps} />;
}

export { Button };
export type { ButtonProps };
