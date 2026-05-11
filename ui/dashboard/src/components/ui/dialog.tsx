/**
 * Dialog — wraps react-fancy Modal component.
 *
 * Background/border colors are overridden globally via data-react-fancy-modal
 * attribute selector in index.css.
 */

import { Modal } from "@particle-academy/react-fancy";
import { cn } from "@particle-academy/react-fancy";
import type { ReactNode } from "react";

interface DialogProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children?: ReactNode;
}

function Dialog({ open, onOpenChange, children }: DialogProps) {
  return (
    <Modal open={open ?? false} onClose={() => onOpenChange?.(false)}>
      {children}
    </Modal>
  );
}

function DialogContent({ className, children, ...props }: { className?: string; children?: ReactNode } & Record<string, unknown>) {
  return <div className={cn("", className)} {...props}>{children}</div>;
}

const DialogHeader = Modal.Header;
const DialogFooter = Modal.Footer;

function DialogTitle({ className, children, ...props }: { className?: string; children?: ReactNode } & Record<string, unknown>) {
  return <div className={cn("text-lg font-semibold", className)} {...props}>{children}</div>;
}

function DialogDescription({ className, children, ...props }: { className?: string; children?: ReactNode } & Record<string, unknown>) {
  return <div className={cn("text-muted-foreground text-sm", className)} {...props}>{children}</div>;
}

export { Dialog, DialogContent, DialogHeader, DialogFooter, DialogTitle, DialogDescription };
