// Words of any JSON value, for the lexical scores: lower case, letters and
// digits, two characters or more.
export const render = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  if (value === null || typeof value !== "object") return "";
  if (Array.isArray(value)) return value.map(render).join(" ");
  if ((value as { type?: unknown }).type === "image_url") return "";
  return Object.values(value).map(render).join(" ");
};

export const words = (text: string) =>
  new Set(
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length > 1),
  );

export const overlap = (a: Set<string>, b: Set<string>) => {
  let n = 0;
  for (const word of a) if (b.has(word)) n += 1;
  return n;
};

// FNV-1a, scaled to [0, 1): a stable tie-breaker.
export const hash = (text: string) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 2 ** 32;
};

export const softmax = (scores: number[]) => {
  const top = Math.max(...scores);
  const e = scores.map((s) => Math.exp(s - top));
  const sum = e.reduce((a, b) => a + b, 0);
  return e.map((v) => v / sum);
};

// 0 for a uniform distribution, 1 when all mass is on one option.
export const confidence = (p: number[]) => {
  if (p.length < 2) return 1;
  const entropy = -p.reduce((s, v) => (v > 0 ? s + v * Math.log(v) : s), 0);
  return Math.max(0, 1 - entropy / Math.log(p.length));
};
