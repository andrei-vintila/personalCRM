import { BookUser, CalendarDays, Database, FileSpreadsheet, Mail, MessageCircle, PenLine, Phone, type LucideIcon } from "lucide-react";
import { cx } from "./ui";

const sourceMeta: Record<string, { label: string; icon: LucideIcon | "linkedin" }> = {
  manual: { label: "Added manually", icon: PenLine },
  google: { label: "Google Contacts", icon: BookUser },
  gmail: { label: "Gmail", icon: Mail },
  gcal: { label: "Google Calendar", icon: CalendarDays },
  linkedin: { label: "LinkedIn", icon: "linkedin" },
  calls: { label: "Calls", icon: Phone },
  whatsapp: { label: "WhatsApp", icon: MessageCircle },
  generic: { label: "CSV import", icon: FileSpreadsheet },
};

export function sourceLabel(source: string) {
  return sourceMeta[source]?.label ?? source;
}

/** Small icons for where a contact comes from (Gmail, Calendar, LinkedIn, calls, ...). */
export function SourceIcons({ sources, className }: { sources: string[] | undefined; className?: string }) {
  if (!sources?.length) return null;
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1 text-zinc-400 dark:text-zinc-500", className)}>
      {sources.map((source) => {
        const { label, icon: Icon } = sourceMeta[source] ?? { label: source, icon: Database };
        return (
          <span key={source} title={label} aria-label={label} role="img" className="inline-flex">
            {Icon === "linkedin" ? (
              // Brand icons aren't in lucide; a tiny "in" badge reads as LinkedIn.
              <span className="inline-flex size-3.5 items-center justify-center rounded-[3px] bg-current">
                <span className="text-[8px] leading-none font-bold text-white dark:text-zinc-900">in</span>
              </span>
            ) : (
              <Icon className="size-3.5" strokeWidth={2} />
            )}
          </span>
        );
      })}
    </span>
  );
}
