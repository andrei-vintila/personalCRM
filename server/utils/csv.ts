/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

/** Parses CSV into objects keyed by the first row that `isHeader` accepts. */
export function csvToRecords(text: string, isHeader: (cells: string[]) => boolean): Record<string, string>[] {
  const rows = parseCsv(text.replace(/^﻿/, ""));
  // LinkedIn exports start with a few "Notes:" lines before the real header.
  const headerIndex = rows.findIndex((r) => isHeader(r.map((cell) => cell.trim())));
  if (headerIndex === -1) return [];
  const header = rows[headerIndex].map((h) => h.trim());
  return rows.slice(headerIndex + 1).map((r) => Object.fromEntries(header.map((h, i) => [h, (r[i] ?? "").trim()])));
}
