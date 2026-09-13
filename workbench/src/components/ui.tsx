import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {LoaderCircle, X} from "lucide-react";
import type {ButtonHTMLAttributes, HTMLAttributes, PropsWithChildren, ReactNode} from "react";
import {cn} from "../lib/utils";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg" | "icon";
  busy?: boolean;
};

export function Button({variant = "secondary", size = "md", busy, className, children, disabled, ...props}: ButtonProps) {
  return (
    <button
      className={cn("mf-button", `mf-button-${variant}`, `mf-button-${size}`, className)}
      disabled={disabled || busy}
      {...props}
    >
      {busy && <LoaderCircle className="animate-spin" size={14} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function IconButton({label, children, ...props}: Omit<ButtonProps, "size"> & {label: string}) {
  return <Tooltip text={label}><Button size="icon" aria-label={label} {...props}>{children}</Button></Tooltip>;
}

export function Tooltip({text, children}: PropsWithChildren<{text: string}>) {
  return (
    <TooltipPrimitive.Provider delayDuration={350}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content className="mf-tooltip" sideOffset={7}>
            {text}<TooltipPrimitive.Arrow className="mf-tooltip-arrow" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

export function Badge({tone = "neutral", children, className}: PropsWithChildren<{tone?: string; className?: string}>) {
  return <span className={cn("mf-badge", `mf-badge-${tone}`, className)}>{children}</span>;
}

export function SectionHeader({eyebrow, title, description, actions}: {eyebrow?: string; title: string; description?: string; actions?: ReactNode}) {
  return (
    <header className="section-header">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="section-actions">{actions}</div>}
    </header>
  );
}

export function EmptyState({icon, title, description, action}: {icon?: ReactNode; title: string; description: string; action?: ReactNode}) {
  return (
    <div className="empty-state">
      {icon && <div className="empty-state-icon" aria-hidden="true">{icon}</div>}
      <strong>{title}</strong>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingState({label = "Loading workspace…"}: {label?: string}) {
  return <div className="loading-state" role="status"><LoaderCircle className="animate-spin" size={18} />{label}</div>;
}

export function ProgressBar({value = 0, indeterminate = false, label, className}: {
  value?: number;
  indeterminate?: boolean;
  label: string;
  className?: string;
}) {
  const percent = Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  return <div
    className={cn("mf-progress", indeterminate && "is-indeterminate", className)}
    role="progressbar"
    aria-label={label}
    aria-valuemin={0}
    aria-valuemax={100}
    aria-valuenow={indeterminate ? undefined : Math.round(percent)}
    aria-valuetext={indeterminate ? label : `${label} · ${percent.toFixed(0)}%`}
  ><i style={indeterminate ? undefined : {width: `${percent}%`}} /></div>;
}

export function ErrorNotice({message, action}: {message: string; action?: ReactNode}) {
  return <div className="error-notice" role="alert"><span>{message}</span>{action}</div>;
}

export function Card({className, ...props}: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mf-card", className)} {...props} />;
}

export function Modal({open, onOpenChange, title, description, children, wide = false}: PropsWithChildren<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  wide?: boolean;
}>) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={cn("dialog-content", wide && "dialog-wide")}>
          <div className="dialog-heading">
            <div><DialogPrimitive.Title>{title}</DialogPrimitive.Title>{description && <DialogPrimitive.Description>{description}</DialogPrimitive.Description>}</div>
            <DialogPrimitive.Close asChild><IconButton label="Close" variant="ghost"><X size={16} /></IconButton></DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
