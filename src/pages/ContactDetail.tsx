import { useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  ArchiveRestore,
  AtSign,
  Briefcase,
  Cake,
  Calendar,
  Globe,
  Link2,
  Mail,
  MapPin,
  Merge,
  MessageSquare,
  Pencil,
  Phone,
  PhoneCall,
  Star,
  StickyNote,
  Trash2,
  Users,
} from "lucide-react";
import { api, type ContactDetail, type IdentityKind, type InteractionItem, type InteractionType } from "../lib/api";
import { cadenceLabel, formatBirthday, formatDate, relativeTime, toLocalInput } from "../lib/format";
import { Avatar, Badge, Button, Card, CardHeader, Empty, ErrorText, Input, Select, Textarea } from "../components/ui";
import { ContactFormDialog } from "../components/ContactForm";
import { MergeWithDialog } from "../components/MergeDialog";
import { SourceIcons } from "../components/SourceIcons";
import { ReminderRow } from "./Reminders";

const interactionMeta: Record<InteractionType, { label: string; icon: typeof StickyNote }> = {
  note: { label: "Note", icon: StickyNote },
  meeting: { label: "Meeting", icon: Users },
  call: { label: "Call", icon: PhoneCall },
  message: { label: "Message", icon: MessageSquare },
  email: { label: "Email", icon: Mail },
  other: { label: "Other", icon: Calendar },
};

const sourceLabels: Record<string, string> = { gmail: "Gmail", gcal: "Calendar", calls: "Phone", whatsapp: "WhatsApp" };

const identityIcons: Record<IdentityKind, typeof Mail> = {
  email: Mail,
  phone: Phone,
  linkedin: Link2,
  twitter: AtSign,
  url: Globe,
};

function identityHref(kind: IdentityKind, value: string) {
  switch (kind) {
    case "email":
      return `mailto:${value}`;
    case "phone":
      return `tel:${value}`;
    case "linkedin":
      return `https://www.linkedin.com/in/${value}`;
    case "twitter":
      return `https://x.com/${value}`;
    case "url":
      return /^https?:\/\//.test(value) ? value : `https://${value}`;
  }
}

function useInvalidateContact(id: string) {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ["contact", id] });
    queryClient.invalidateQueries({ queryKey: ["contacts"] });
    queryClient.invalidateQueries({ queryKey: ["home"] });
    queryClient.invalidateQueries({ queryKey: ["reminders"] });
  };
}

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const invalidate = useInvalidateContact(id!);
  const [editing, setEditing] = useState(false);
  const [mergingWith, setMergingWith] = useState(false);
  const contact = useQuery({ queryKey: ["contact", id], queryFn: () => api<ContactDetail>(`/contacts/${id}`) });

  const patch = useMutation({
    mutationFn: (body: Partial<ContactDetail>) => api<ContactDetail>(`/contacts/${id}`, { method: "PATCH", body }),
    onSuccess: invalidate,
  });
  const remove = useMutation({
    mutationFn: () => api(`/contacts/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      invalidate();
      navigate("/contacts");
    },
  });

  if (contact.error) return <ErrorText error={contact.error} />;
  if (!contact.data) return null;
  const c = contact.data;
  const overdue = c.dueAt !== null && c.dueAt <= Date.now();

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <Avatar name={c.name} src={c.avatarUrl} size={72} />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
            {c.archived && <Badge>archived</Badge>}
            <SourceIcons sources={c.sources} className="ml-1 [&_svg]:size-4" />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-zinc-500">
            {(c.title || c.company) && (
              <span className="inline-flex items-center gap-1.5">
                <Briefcase className="size-3.5" />
                {[c.title, c.company].filter(Boolean).join(" at ")}
              </span>
            )}
            {c.location && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5" />
                {c.location}
              </span>
            )}
            {c.birthday && (
              <span className="inline-flex items-center gap-1.5">
                <Cake className="size-3.5" />
                {formatBirthday(c.birthday)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-1 pt-1">
            {c.tags.map((t) => (
              <Link key={t} to={`/contacts?tag=${encodeURIComponent(t)}`}>
                <Badge tone="accent">{t}</Badge>
              </Link>
            ))}
          </div>
        </div>
        <div className="flex gap-1">
          <Button variant="ghost" aria-label="Star" onClick={() => patch.mutate({ starred: !c.starred })}>
            <Star className={c.starred ? "size-4 fill-amber-400 text-amber-400" : "size-4"} />
          </Button>
          <Button variant="ghost" aria-label={c.archived ? "Unarchive" : "Archive"} onClick={() => patch.mutate({ archived: !c.archived })}>
            {c.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          </Button>
          <Button
            variant="danger"
            aria-label="Delete"
            onClick={() => confirm(`Delete ${c.name}? This also removes their reminders.`) && remove.mutate()}
          >
            <Trash2 className="size-4" />
          </Button>
          <Button onClick={() => setMergingWith(true)}>
            <Merge className="size-4" /> Merge…
          </Button>
          <Button onClick={() => setEditing(true)}>
            <Pencil className="size-4" /> Edit
          </Button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <LogInteraction contactId={c.id} />
          <Card>
            <CardHeader title="Timeline" />
            {c.interactions.length === 0 ? (
              <Empty>Nothing logged yet.</Empty>
            ) : (
              <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {c.interactions.map((i) => (
                  <InteractionRow key={i.id} interaction={i} onChange={invalidate} />
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="space-y-3 p-4">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Keep in touch</span>
              <span className="font-medium">{cadenceLabel(c.keepInTouchDays)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-500">Last interaction</span>
              <span className="font-medium">{relativeTime(c.lastInteractionAt)}</span>
            </div>
            {c.dueAt !== null && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-500">Next catch-up</span>
                {overdue ? <Badge tone="warn">overdue</Badge> : <span className="font-medium">{relativeTime(c.dueAt)}</span>}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Contact details" />
            {c.identities.length === 0 ? (
              <Empty>No contact details.</Empty>
            ) : (
              <ul className="space-y-1 p-2">
                {c.identities.map((i) => {
                  const Icon = identityIcons[i.kind];
                  return (
                    <li key={i.id}>
                      <a
                        href={identityHref(i.kind, i.value)}
                        target={i.kind === "email" || i.kind === "phone" ? undefined : "_blank"}
                        rel="noreferrer"
                        className="flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
                      >
                        <Icon className="size-4 shrink-0 text-zinc-400" />
                        <span className="truncate">{i.value}</span>
                        {i.label && <span className="ml-auto text-xs text-zinc-500">{i.label}</span>}
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>

          {c.about && (
            <Card className="p-4">
              <p className="text-sm whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">{c.about}</p>
            </Card>
          )}

          <ContactReminders contact={c} onChange={invalidate} />
        </div>
      </div>

      <ContactFormDialog open={editing} onClose={() => setEditing(false)} contact={c} />
      <MergeWithDialog open={mergingWith} onClose={() => setMergingWith(false)} contact={c} />
    </div>
  );
}

function LogInteraction({ contactId }: { contactId: string }) {
  const invalidate = useInvalidateContact(contactId);
  const [type, setType] = useState<InteractionType>("note");
  const [body, setBody] = useState("");
  const [when, setWhen] = useState(() => toLocalInput(new Date()));

  const log = useMutation({
    mutationFn: () =>
      api("/interactions", {
        method: "POST",
        body: { type, body, occurredAt: new Date(when).toISOString(), contactIds: [contactId] },
      }),
    onSuccess: () => {
      setBody("");
      setWhen(toLocalInput(new Date()));
      invalidate();
    },
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    log.mutate();
  };

  return (
    <Card>
      <form onSubmit={submit} className="space-y-3 p-4">
        <div className="flex flex-wrap gap-1">
          {(Object.keys(interactionMeta) as InteractionType[]).map((t) => {
            const { label, icon: Icon } = interactionMeta[t];
            return (
              <Button key={t} size="sm" variant={type === t ? "primary" : "ghost"} onClick={() => setType(t)}>
                <Icon className="size-3.5" /> {label}
              </Button>
            );
          })}
        </div>
        <Textarea
          placeholder={type === "note" ? "Write a note…" : "What did you talk about?"}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Input type="datetime-local" className="w-auto!" value={when} onChange={(e) => setWhen(e.target.value)} />
          <ErrorText error={log.error} />
          <Button type="submit" variant="primary" className="ml-auto" disabled={log.isPending || (type === "note" && !body.trim())}>
            Log {interactionMeta[type].label.toLowerCase()}
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function InteractionRow({
  interaction,
  showContacts,
  onChange,
}: {
  interaction: InteractionItem;
  showContacts?: boolean;
  onChange?: () => void;
}) {
  const { label, icon: Icon } = interactionMeta[interaction.type];
  const remove = useMutation({
    mutationFn: () => api(`/interactions/${interaction.id}`, { method: "DELETE" }),
    onSuccess: onChange,
  });

  return (
    <li className="group flex gap-3 px-4 py-3">
      <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-500 dark:bg-zinc-800">
        <Icon className="size-3.5" />
      </span>
      <div className="min-w-0 flex-1 space-y-0.5">
        <div className="flex flex-wrap items-center gap-x-2 text-sm">
          <span className="font-medium">{interaction.title || label}</span>
          {showContacts &&
            interaction.contacts.map((c) => (
              <Link key={c.id} to={`/contacts/${c.id}`} className="text-accent-600 hover:underline">
                {c.name}
              </Link>
            ))}
          <span className="text-xs text-zinc-500" title={formatDate(interaction.occurredAt, true)}>
            {relativeTime(interaction.occurredAt)}
            {sourceLabels[interaction.source] && ` · ${sourceLabels[interaction.source]}`}
          </span>
        </div>
        {interaction.body && <p className="text-sm whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{interaction.body}</p>}
      </div>
      {onChange && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete"
          className="opacity-0 group-hover:opacity-100 focus:opacity-100"
          onClick={() => remove.mutate()}
        >
          <Trash2 className="size-3.5" />
        </Button>
      )}
    </li>
  );
}

function ContactReminders({ contact, onChange }: { contact: ContactDetail; onChange: () => void }) {
  const [note, setNote] = useState("");
  const [inDays, setInDays] = useState(7);
  const add = useMutation({
    mutationFn: () =>
      api("/reminders", {
        method: "POST",
        body: { contactId: contact.id, note, dueAt: new Date(Date.now() + inDays * 86_400_000).toISOString() },
      }),
    onSuccess: () => {
      setNote("");
      onChange();
    },
  });
  const open = contact.reminders.filter((r) => !r.completedAt);

  return (
    <Card>
      <CardHeader title="Reminders" />
      {open.length > 0 && (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {open.map((r) => (
            <ReminderRow key={r.id} reminder={{ ...r, contact: null }} />
          ))}
        </ul>
      )}
      <form
        className="flex gap-2 border-t border-zinc-100 p-3 dark:border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate();
        }}
      >
        <Input placeholder="Remind me to…" value={note} onChange={(e) => setNote(e.target.value)} />
        <Select className="w-30! shrink-0" value={inDays} onChange={(e) => setInDays(Number(e.target.value))}>
          <option value={1}>1 day</option>
          <option value={7}>1 week</option>
          <option value={30}>1 month</option>
          <option value={90}>3 months</option>
        </Select>
        <Button type="submit" variant="primary" disabled={!note.trim() || add.isPending}>
          Add
        </Button>
      </form>
    </Card>
  );
}
