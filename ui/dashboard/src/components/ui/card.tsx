/**
 * Card — wraps react-fancy Card component.
 *
 * Background/border colors are overridden globally via data-react-fancy-card
 * attribute selector in index.css, so no className overrides needed here.
 */

import { Card as FancyCard } from "@particle-academy/react-fancy";
import { cn } from "@particle-academy/react-fancy";
import type { ComponentProps, ReactNode } from "react";

type FancyCardProps = ComponentProps<typeof FancyCard>;

function Card({ className, ...props }: FancyCardProps) {
  return <FancyCard className={cn(className)} {...props} />;
}

const CardHeader = FancyCard.Header;
const CardContent = FancyCard.Body;
const CardFooter = FancyCard.Footer;

function CardTitle({ className, children, ...props }: { className?: string; children?: ReactNode } & Record<string, unknown>) {
  return <div className={cn("leading-none font-semibold", className)} {...props}>{children}</div>;
}

function CardDescription({ className, children, ...props }: { className?: string; children?: ReactNode } & Record<string, unknown>) {
  return <div className={cn("text-muted-foreground text-sm", className)} {...props}>{children}</div>;
}

function CardAction({ className, children, ...props }: { className?: string; children?: ReactNode } & Record<string, unknown>) {
  return <div className={cn("col-start-2 row-span-2 self-start justify-self-end", className)} {...props}>{children}</div>;
}

export { Card, CardHeader, CardContent, CardFooter, CardTitle, CardDescription, CardAction };
