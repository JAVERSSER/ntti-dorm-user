import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

export const buttonStyles = {
  base: "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-4 disabled:cursor-not-allowed disabled:opacity-60",
  primary: "bg-brand-600 text-white shadow-sm hover:bg-brand-700 focus-visible:ring-brand-200",
  secondary: "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:ring-slate-200",
};

export function buttonClass(variant: keyof Omit<typeof buttonStyles, "base"> = "primary", extra?: string) {
  return cn(buttonStyles.base, buttonStyles[variant], extra);
}

export function Card({ className, children, ...rest }: ComponentProps<"section">) {
  return (
    <section className={cn("rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6", className)} {...rest}>
      {children}
    </section>
  );
}

const alertTones = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-900", Icon: Info },
  success: { box: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2 },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  error: { box: "border-red-200 bg-red-50 text-red-900", Icon: XCircle },
};

export function Alert({ tone = "info", title, children }: { tone?: keyof typeof alertTones; title?: string; children?: ReactNode }) {
  const { box, Icon } = alertTones[tone];
  return (
    <div role={tone === "error" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border p-4 text-sm", box)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

export function Spinner({ className, label = "Loading" }: { className?: string; label?: string }) {
  return (
    <span role="status" className="inline-flex items-center">
      <Loader2 className={cn("size-5 animate-spin", className)} aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}
