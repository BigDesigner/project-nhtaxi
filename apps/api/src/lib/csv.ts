// A cell starting with one of these is interpreted as a formula by
// Excel/Sheets when the exported file is opened (OWASP CSV injection) —
// prefix with a single quote to force it to render as plain text instead.
const FORMULA_PREFIXES = ["=", "+", "-", "@", "\t", "\r"];

function escapeCsvCell(value: unknown): string {
  let cell = value === null || value === undefined ? "" : String(value);
  if (FORMULA_PREFIXES.some((prefix) => cell.startsWith(prefix))) {
    cell = `'${cell}`;
  }
  if (/[",\n\r]/.test(cell)) {
    cell = `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsvCell(row[header])).join(","));
  }
  return lines.join("\r\n");
}
