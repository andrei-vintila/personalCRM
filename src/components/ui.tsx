import { forwardRef, useEffect, useRef, type ComponentProps, type ReactNode } from "react";
import { Info, X } from "lucide-react";
import { initials } from "../lib/format";

const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

const buttonStyles: Record<ButtonVariant, string> = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 shadow-sm",
  secondary:
    "bg-white text-zinc-800 ring-1 ring-zinc-200 hover:bg-zinc-50 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800 dark:hover:bg-zinc-800",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
  danger: "text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/50",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
        size === "sm" ? "h-8 px-2.5 text-sm" : "h-9 px-3.5 text-sm",
        buttonStyles[variant],
        className,
      )}
      {...props}
    />
  );
}

const fieldStyles =
  "w-full rounded-lg border-0 bg-white px-3 py-2 text-sm ring-1 ring-zinc-200 placeholder:text-zinc-400 focus:outline-none focus:ring-2 focus:ring-accent-500 dark:bg-zinc-900 dark:ring-zinc-800";

export const Input = forwardRef<HTMLInputElement, ComponentProps<"input">>(({ className, ...props }, ref) => (
  <input ref={ref} className={cx(fieldStyles, "h-9", className)} {...props} />
));

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cx(fieldStyles, "min-h-20 resize-y", className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={cx(fieldStyles, "h-9 pr-8", className)} {...props} />;
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
      {hint && <span className="block text-xs text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section
      className={cx("rounded-xl bg-white ring-1 ring-zinc-200/80 dark:bg-zinc-900 dark:ring-zinc-800", className)}
      {...props}
    />
  );
}

export function CardHeader({ title, action, icon }: { title: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="flex items-center justify-between gap-2 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        {icon}
        {title}
      </h2>
      {action}
    </header>
  );
}

const avatarColors = [
  "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950 dark:text-fuchsia-300",
];

export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const style = { width: size, height: size, fontSize: Math.max(10, size * 0.38) };
  if (src) return <img src={src} alt="" style={style} className="shrink-0 rounded-full object-cover" />;
  return (
    <span
      style={style}
      className={cx("inline-flex shrink-0 items-center justify-center rounded-full font-semibold", avatarColors[hash % avatarColors.length])}
    >
      {initials(name)}
    </span>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "warn" | "accent" }) {
  const tones = {
    neutral: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
    accent: "bg-accent-100 text-accent-700 dark:bg-accent-700/30 dark:text-accent-100",
  };
  return <span className={cx("inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-8 text-center text-sm text-zinc-500">{children}</p>;
}

export function Dialog({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // showModal() focuses the first focusable element (the close button); prefer the first text field.
      dialog.querySelector<HTMLElement>("input:not([type=radio]):not([type=checkbox]):not([type=hidden]), textarea")?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={cx(
        "m-auto w-[calc(100%-2rem)] rounded-2xl bg-white p-0 text-zinc-900 shadow-2xl ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-100 dark:ring-zinc-800",
        wide ? "max-w-2xl" : "max-w-lg",
      )}
    >
      {open && (
        <div className="max-h-[85dvh] overflow-y-auto">
          <header className="sticky top-0 z-10 flex items-center justify-between border-b border-zinc-100 bg-white/90 px-5 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/90">
            <h2 className="font-semibold">{title}</h2>
            <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
              <X className="size-4" />
            </Button>
          </header>
          <div className="p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="text-sm text-red-600 dark:text-red-400">{error instanceof Error ? error.message : String(error)}</p>;
}

/** An ⓘ button that reveals extra detail on hover or keyboard focus. */
export function InfoTip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        aria-label={label}
        className="rounded-full p-1 text-zinc-400 hover:text-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500 dark:hover:text-zinc-300"
      >
        <Info className="size-4" />
      </button>
      <span
        role="tooltip"
        className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-1 w-80 max-w-[80vw] rounded-lg bg-zinc-900 px-3 py-2 text-xs text-white opacity-0 shadow-lg transition-opacity group-focus-within/tip:visible group-focus-within/tip:opacity-100 group-hover/tip:visible group-hover/tip:opacity-100 dark:bg-zinc-100 dark:text-zinc-900"
      >
        {children}
      </span>
    </span>
  );
}

export { cx };
