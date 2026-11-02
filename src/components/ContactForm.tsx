import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { api, ApiError, type ContactDetail, type ContactInput, type IdentityKind } from "../lib/api";
import { cadenceOptions } from "../lib/format";
import { Button, Dialog, ErrorText, Field, Input, Select, Textarea } from "./ui";

const identityKinds: { value: IdentityKind; label: string; placeholder: string }[] = [
  { value: "email", label: "Email", placeholder: "name@example.com" },
  { value: "phone", label: "Phone", placeholder: "+1 555 123 4567" },
  { value: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/handle" },
  { value: "twitter", label: "X / Twitter", placeholder: "@handle" },
  { value: "url", label: "Website", placeholder: "https://…" },
];

type IdentityRow = { kind: IdentityKind; value: string; label: string };

export function ContactFormDialog({
  open,
  onClose,
  contact,
}: {
  open: boolean;
  onClose: () => void;
  contact?: ContactDetail;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={contact ? "Edit contact" : "New contact"} wide>
      {/* Remount per open so the form starts from the current contact. */}
      {open && <ContactForm contact={contact} onDone={onClose} />}
    </Dialog>
  );
}

function ContactForm({ contact, onDone }: { contact?: ContactDetail; onDone: () => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    name: contact?.name ?? "",
    company: contact?.company ?? "",
    title: contact?.title ?? "",
    location: contact?.location ?? "",
    birthday: contact?.birthday ?? "",
    avatarUrl: contact?.avatarUrl ?? "",
    about: contact?.about ?? "",
    keepInTouchDays: contact?.keepInTouchDays ?? null,
    tags: contact?.tags.join(", ") ?? "",
  });
  const [identities, setIdentities] = useState<IdentityRow[]>(
    contact?.identities.length
      ? contact.identities.map((i) => ({ kind: i.kind, value: i.value, label: i.label ?? "" }))
      : [{ kind: "email", value: "", label: "" }],
  );

  const save = useMutation({
    mutationFn: (body: ContactInput) =>
      contact
        ? api<ContactDetail>(`/contacts/${contact.id}`, { method: "PATCH", body })
        : api<ContactDetail>("/contacts", { method: "POST", body }),
    onSuccess: (saved) => {
      queryClient.setQueryData(["contact", saved.id], saved);
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["home"] });
      queryClient.invalidateQueries({ queryKey: ["tags"] });
      onDone();
      if (!contact) navigate(`/contacts/${saved.id}`);
    },
  });

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate({
      ...form,
      birthday: form.birthday || null,
      tags: form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      identities: identities.filter((i) => i.value.trim()).map((i) => ({ ...i, label: i.label || null })),
    });
  };

  const conflictId = save.error instanceof ApiError && save.error.status === 409 ? (save.error.data as { contactId?: string })?.contactId : undefined;

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name">
            <Input required autoFocus value={form.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
        </div>
        <Field label="Company">
          <Input value={form.company} onChange={(e) => set("company", e.target.value)} />
        </Field>
        <Field label="Title">
          <Input value={form.title} onChange={(e) => set("title", e.target.value)} />
        </Field>
        <Field label="Location">
          <Input value={form.location} onChange={(e) => set("location", e.target.value)} />
        </Field>
        <Field label="Birthday" hint="YYYY-MM-DD, or --MM-DD if you don't know the year">
          <Input value={form.birthday} placeholder="1990-04-21" onChange={(e) => set("birthday", e.target.value)} />
        </Field>
        <Field label="Keep in touch">
          <Select
            value={form.keepInTouchDays ?? ""}
            onChange={(e) => set("keepInTouchDays", e.target.value ? Number(e.target.value) : null)}
          >
            {cadenceOptions.map((o) => (
              <option key={o.label} value={o.value ?? ""}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tags" hint="Comma separated">
          <Input value={form.tags} placeholder="friends, berlin" onChange={(e) => set("tags", e.target.value)} />
        </Field>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-600 dark:text-zinc-400">Contact details</span>
          <Button size="sm" variant="ghost" onClick={() => setIdentities((rows) => [...rows, { kind: "email", value: "", label: "" }])}>
            <Plus className="size-4" /> Add
          </Button>
        </div>
        {identities.map((row, index) => {
          const update = (patch: Partial<IdentityRow>) =>
            setIdentities((rows) => rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
          return (
            <div key={index} className="flex gap-2">
              <Select className="w-32! shrink-0" value={row.kind} onChange={(e) => update({ kind: e.target.value as IdentityKind })}>
                {identityKinds.map((k) => (
                  <option key={k.value} value={k.value}>
                    {k.label}
                  </option>
                ))}
              </Select>
              <Input
                value={row.value}
                placeholder={identityKinds.find((k) => k.value === row.kind)?.placeholder}
                onChange={(e) => update({ value: e.target.value })}
              />
              <Input className="w-28! shrink-0" value={row.label} placeholder="Label" onChange={(e) => update({ label: e.target.value })} />
              <Button variant="ghost" aria-label="Remove" onClick={() => setIdentities((rows) => rows.filter((_, i) => i !== index))}>
                <Trash2 className="size-4" />
              </Button>
            </div>
          );
        })}
      </div>

      <Field label="Photo URL">
        <Input value={form.avatarUrl} placeholder="https://…" onChange={(e) => set("avatarUrl", e.target.value)} />
      </Field>
      <Field label="About">
        <Textarea value={form.about} placeholder="How you met, what they care about…" onChange={(e) => set("about", e.target.value)} />
      </Field>

      <div className="space-y-1">
        <ErrorText error={save.error} />
        {conflictId && (
          <a className="text-sm text-accent-600 underline" href={`/contacts/${conflictId}`}>
            Open the existing contact
          </a>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={onDone}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {contact ? "Save" : "Create contact"}
        </Button>
      </div>
    </form>
  );
}
