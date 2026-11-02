import { useState } from "react";
import { Link } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp } from "lucide-react";
import { api, type ImportContact } from "../lib/api";
import { importFormats, parseImport, type ImportFormat } from "../lib/importers";
import { Button, Card, cx, ErrorText, Field, Input } from "../components/ui";

/** Small batches keep each request inside D1's per-invocation query limit. */
const BATCH_SIZE = 25;

export function ImportPage() {
  const queryClient = useQueryClient();
  const [format, setFormat] = useState<ImportFormat>("linkedin");
  const [tag, setTag] = useState("linkedin");
  const [fileName, setFileName] = useState<string>();
  const [rows, setRows] = useState<ImportContact[]>([]);
  const [progress, setProgress] = useState<{ done: number; created: number; updated: number }>();
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>();

  const chooseFormat = (id: ImportFormat) => {
    setFormat(id);
    setTag(id === "generic" ? "" : id);
    setRows([]);
    setFileName(undefined);
    setProgress(undefined);
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(undefined);
    setProgress(undefined);
    setFileName(file.name);
    const parsed = parseImport(format, await file.text());
    setRows(parsed);
    if (parsed.length === 0) setError(new Error("No contacts found. Is this the right file and format?"));
  };

  const run = async () => {
    setRunning(true);
    setError(undefined);
    const totals = { done: 0, created: 0, updated: 0 };
    setProgress({ ...totals });
    try {
      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        const batch = rows.slice(i, i + BATCH_SIZE);
        const result = await api<{ created: number; updated: number }>("/import/contacts", {
          method: "POST",
          body: { source: format, tag: tag || null, contacts: batch },
        });
        totals.done += batch.length;
        totals.created += result.created;
        totals.updated += result.updated;
        setProgress({ ...totals });
      }
      setRows([]);
      queryClient.invalidateQueries();
    } catch (e) {
      setError(e);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Import</h1>
        <p className="mt-1 text-sm text-zinc-500">
          People are matched by email, phone and LinkedIn URL. Existing contacts only get blank fields filled in.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {importFormats.map((f) => (
          <button
            key={f.id}
            onClick={() => chooseFormat(f.id)}
            className={cx(
              "rounded-xl p-4 text-left ring-1 transition-colors",
              format === f.id
                ? "bg-accent-50 ring-2 ring-accent-500 dark:bg-accent-700/20"
                : "bg-white ring-zinc-200 hover:ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-800",
            )}
          >
            <div className="text-sm font-semibold">{f.label}</div>
            <div className="mt-1 text-xs text-zinc-500">{f.help}</div>
          </button>
        ))}
      </div>

      <Card className="space-y-4 p-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
          <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-zinc-300 px-4 py-3 text-sm hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50">
            <FileUp className="size-5 text-zinc-400" />
            <span className="truncate">{fileName ?? "Choose a CSV file…"}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </label>
          <Field label="Tag imported contacts">
            <Input value={tag} placeholder="optional" onChange={(e) => setTag(e.target.value)} />
          </Field>
        </div>

        {rows.length > 0 && (
          <>
            <div className="max-h-72 overflow-auto rounded-lg ring-1 ring-zinc-100 dark:ring-zinc-800">
              <table className="w-full text-left text-sm">
                <thead className="sticky top-0 bg-zinc-50 text-xs text-zinc-500 dark:bg-zinc-900">
                  <tr>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 font-medium">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {rows.slice(0, 100).map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-1.5">{r.name}</td>
                      <td className="px-3 py-1.5 text-zinc-500">{[r.title, r.company].filter(Boolean).join(" · ")}</td>
                      <td className="max-w-64 truncate px-3 py-1.5 text-zinc-500">{r.identities.map((i) => i.value).join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm text-zinc-500">
                {rows.length} contacts found{rows.length > 100 && " (showing first 100)"}
              </span>
              <Button variant="primary" disabled={running} onClick={run}>
                {running ? `Importing ${progress?.done ?? 0}/${rows.length}…` : `Import ${rows.length} contacts`}
              </Button>
            </div>
          </>
        )}

        <ErrorText error={error} />
        {progress && !running && !error && (
          <p className="text-sm text-emerald-700 dark:text-emerald-400">
            Done: {progress.created} new, {progress.updated} matched existing contacts.{" "}
            <Link to="/contacts" className="underline">
              View contacts
            </Link>
          </p>
        )}
      </Card>
    </div>
  );
}
