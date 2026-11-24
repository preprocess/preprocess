// Secret values bound to the deployment are removed from everything that
// leaves the Worker: tool results, errors and logs (design doc 03). This is
// defense in depth, not a guarantee: code that transforms a value (encodes,
// slices, hashes it) can still leak it.

export type Secrets = ReadonlyMap<string, string>;

export const redactText = (text: string, secrets: Secrets): string => {
  let out = text;
  for (const [name, value] of secrets) {
    if (value.length >= 4) out = out.split(value).join(`[redacted:${name}]`);
  }
  return out;
};

export const redact = (value: unknown, secrets: Secrets): unknown => {
  if (typeof value === "string") return redactText(value, secrets);
  if (Array.isArray(value)) return value.map((item) => redact(item, secrets));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, redact(item, secrets)]),
    );
  }
  return value;
};

let current: Secrets = new Map();
let consoleWrapped = false;

// Every isolate serves one deployment, so the bound values are the same for
// each request; the latest set wins after a secret is rotated.
export const redactConsole = (secrets: Secrets) => {
  current = secrets;
  if (consoleWrapped) return;
  consoleWrapped = true;
  for (const level of ["debug", "info", "log", "warn", "error"] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) =>
      original(
        ...args.map((arg) =>
          arg instanceof Error
            ? redactText(arg.stack ?? arg.message, current)
            : redact(arg, current),
        ),
      );
  }
};
