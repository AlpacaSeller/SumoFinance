"use client";

// ── Primitive UI condivise ──────────────────────────────────────────────────

import { Info, X } from "lucide-react";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { fmtEUR, fmtEURSigned } from "@/lib/format";

// ── Card ────────────────────────────────────────────────────────────────────

export function Card({
  title,
  subtitle,
  action,
  children,
  className = "",
  tone = "default",
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
  tone?: "default" | "brand";
}) {
  return (
    <section
      className={`rounded-2xl border ${
        tone === "brand" ? "border-brand bg-brand text-white" : "border-line bg-surface"
      } p-5 ${className}`}
    >
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-sm font-semibold tracking-wide">{title}</h2>}
            {subtitle && (
              <p className={`mt-0.5 text-xs ${tone === "brand" ? "text-white/70" : "text-soft"}`}>
                {subtitle}
              </p>
            )}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// ── KPI ─────────────────────────────────────────────────────────────────────

export function Kpi({
  label,
  value,
  sub,
  tone = "default",
  info,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "pos" | "neg";
  info?: string;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-1 text-xs font-medium text-soft">
        {label}
        {info && <InfoTip text={info} />}
      </div>
      <div
        className={`tnum mt-1 text-xl font-semibold md:text-2xl ${
          tone === "pos" ? "text-pos" : tone === "neg" ? "text-neg" : "text-ink"
        }`}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  );
}

// ── Bottoni ─────────────────────────────────────────────────────────────────

type ButtonVariant = "primary" | "outline" | "ghost" | "danger";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles: Record<ButtonVariant, string> = {
    primary:
      "bg-brand text-white hover:bg-brand-2 disabled:opacity-50 disabled:hover:bg-brand",
    outline:
      "border border-line-strong bg-surface text-ink hover:bg-surface-2 disabled:opacity-50",
    ghost: "text-accent hover:bg-accent-soft disabled:opacity-50",
    danger: "bg-neg text-white hover:opacity-90 disabled:opacity-50",
  };
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-colors ${styles[variant]} ${className}`}
      {...props}
    />
  );
}

export function IconButton({
  label,
  className = "",
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={`inline-flex size-11 items-center justify-center rounded-xl text-soft transition-colors hover:bg-surface-2 hover:text-ink ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

// ── Form ────────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-soft">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full min-h-11 rounded-xl border border-line-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-faint focus:border-accent";

export function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className || ""}`} />;
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={`${inputClass} ${props.className || ""}`} />;
}

// ── Modal ───────────────────────────────────────────────────────────────────

export function Modal({
  open,
  onClose,
  title,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={`m-auto w-[calc(100vw-2rem)] rounded-2xl border border-line bg-surface p-0 text-ink shadow-2xl backdrop:bg-ink/40 ${
        wide ? "max-w-3xl" : "max-w-lg"
      }`}
    >
      <div className="flex items-center justify-between border-b border-line px-5 py-4">
        <h2 id={titleId} className="font-display text-lg font-semibold">
          {title}
        </h2>
        <IconButton label="Chiudi" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>
      <div className="max-h-[75vh] overflow-y-auto p-5">{open && children}</div>
    </dialog>
  );
}

export function ModalFooter({ children }: { children: ReactNode }) {
  return <div className="mt-5 flex justify-end gap-2">{children}</div>;
}

// ── Vari ────────────────────────────────────────────────────────────────────

export function Badge({
  tone = "neutral",
  children,
  className = "",
}: {
  tone?: "neutral" | "pos" | "neg" | "warn" | "accent" | "brand";
  children: ReactNode;
  className?: string;
}) {
  const styles = {
    neutral: "bg-surface-2 text-soft border-line",
    pos: "bg-pos-soft text-pos border-pos/20",
    neg: "bg-neg-soft text-neg border-neg/20",
    warn: "bg-warn-soft text-warn border-warn/20",
    accent: "bg-accent-soft text-accent border-accent/20",
    brand: "bg-brand-soft text-brand-ink border-brand/20",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${styles[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

export function ProgressBar({
  value,
  tone = "brand",
  className = "",
}: {
  value: number; // 0–100
  tone?: "brand" | "pos" | "neg" | "warn" | "accent";
  className?: string;
}) {
  const colors = {
    brand: "bg-brand",
    pos: "bg-pos",
    neg: "bg-neg",
    warn: "bg-warn",
    accent: "bg-accent",
  };
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className={`h-2 w-full overflow-hidden rounded-full bg-line/60 ${className}`}>
      <div
        className={`h-full rounded-full transition-all duration-300 ${colors[tone]}`}
        style={{ width: `${v}%` }}
      />
    </div>
  );
}

export function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex" tabIndex={0}>
      <Info className="size-3.5 text-faint" aria-hidden />
      <span className="sr-only">Info: {text}</span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-2 w-64 -translate-x-1/2 rounded-lg bg-overlay px-3 py-2 text-xs font-normal text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

/** Importo colorato: verde se positivo, rosso se negativo */
export function Money({
  value,
  signed = false,
  neutral = false,
  className = "",
}: {
  value: number;
  signed?: boolean;
  neutral?: boolean;
  className?: string;
}) {
  const color = neutral
    ? "text-ink"
    : value > 0
      ? "text-pos"
      : value < 0
        ? "text-neg"
        : "text-ink";
  return (
    <span className={`tnum ${color} ${className}`}>
      {signed ? fmtEURSigned(value) : fmtEUR(value)}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  text,
  action,
}: {
  icon?: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-line-strong bg-surface-2 px-6 py-12 text-center">
      {icon && <div className="text-faint [&>svg]:size-10">{icon}</div>}
      <h3 className="font-display text-lg font-semibold text-ink">{title}</h3>
      <p className="max-w-sm text-sm text-soft">{text}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-ink md:text-3xl">
          {title}
        </h1>
        {subtitle && <p className="mt-1 text-sm text-soft">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Selettore a segmenti (range grafici, filtri) */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = "sm",
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="inline-flex flex-wrap gap-0.5 rounded-xl border border-line bg-surface-2 p-0.5">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`rounded-[10px] font-medium transition-colors ${
            size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm"
          } ${
            value === o.value
              ? "bg-surface text-ink shadow-sm"
              : "text-soft hover:text-ink"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Renderizza **grassetto** nei testi dei consigli */
export function BoldText({ text }: { text: string }) {
  const parts = text.split(/\*\*(.+?)\*\*/g);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 === 1 ? (
          <strong key={i} className="tnum font-semibold text-ink">
            {p}
          </strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

/** Stato di caricamento standard: skeleton che ricalca il layout tipico */
export function LoadingState() {
  return (
    <div aria-busy="true" aria-label="Caricamento" className="animate-pulse">
      <div className="mb-6 h-8 w-48 rounded-lg bg-line/60" />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-2xl border border-line bg-surface p-4">
            <div className="h-3 w-20 rounded bg-line/60" />
            <div className="mt-3 h-6 w-28 rounded bg-line/60" />
          </div>
        ))}
      </div>
      <div className="h-64 rounded-2xl border border-line bg-surface p-5">
        <div className="h-4 w-40 rounded bg-line/60" />
        <div className="mt-4 h-40 rounded-xl bg-line/40" />
      </div>
    </div>
  );
}
