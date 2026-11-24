export type ParsedEmail = {
  readonly from?: string;
  readonly to?: string;
  readonly cc?: string;
  readonly subject?: string;
  readonly date?: string;
  readonly body: string;
};

function headerMap(head: string): Map<string, string> {
  const headers = new Map<string, string>();
  for (const line of head.replace(/\n[ \t]+/g, " ").split("\n")) {
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim().toLowerCase();
    if (!name || headers.has(name)) continue;
    headers.set(name, line.slice(colon + 1).trim());
  }
  return headers;
}

export function parseEml(text: string): ParsedEmail {
  const normalized = text.replace(/\r\n/g, "\n");
  const split = normalized.indexOf("\n\n");
  const headers = headerMap(
    split === -1 ? normalized : normalized.slice(0, split),
  );
  return {
    from: headers.get("from"),
    to: headers.get("to"),
    cc: headers.get("cc"),
    subject: headers.get("subject"),
    date: headers.get("date"),
    body: (split === -1 ? "" : normalized.slice(split + 2)).trim(),
  };
}
