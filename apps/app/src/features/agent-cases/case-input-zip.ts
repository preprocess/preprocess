const EOCD = 0x06054b50;
const CEN = 0x02014b50;
const LOC = 0x04034b50;

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc = CRC_TABLE[(crc ^ value) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildStoredZip(
  files: ReadonlyArray<{ name: string; body: string }>,
): Uint8Array {
  const encoder = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(file.name);
    const data = encoder.encode(file.body);
    const crc = crc32(data);
    const local = new Uint8Array(30 + nameBytes.length + data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOC, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, data.length, true);
    localView.setUint32(22, data.length, true);
    localView.setUint16(26, nameBytes.length, true);
    local.set(nameBytes, 30);
    local.set(data, 30 + nameBytes.length);

    const central = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, CEN, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, data.length, true);
    centralView.setUint32(24, data.length, true);
    centralView.setUint16(28, nameBytes.length, true);
    centralView.setUint32(42, offset, true);
    central.set(nameBytes, 46);

    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0);
  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, EOCD, true);
  eocdView.setUint16(8, files.length, true);
  eocdView.setUint16(10, files.length, true);
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, offset, true);

  const zip = new Uint8Array(offset + centralSize + eocd.length);
  let cursor = 0;
  for (const part of locals) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centrals) {
    zip.set(part, cursor);
    cursor += part.length;
  }
  zip.set(eocd, cursor);
  return zip;
}

export type ZipEntry = {
  readonly name: string;
  readonly method: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
};

function u16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function u32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEocd(view: DataView): number | null {
  const min = Math.max(0, view.byteLength - 22 - 65535);
  for (let offset = view.byteLength - 22; offset >= min; offset -= 1) {
    if (u32(view, offset) === EOCD) return offset;
  }
  return null;
}

export function listZipEntries(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEocd(view);
  if (eocd == null) return [];

  const count = u16(view, eocd + 10);
  let cursor = u32(view, eocd + 16);
  const entries: ZipEntry[] = [];
  const decoder = new TextDecoder();

  for (let i = 0; i < count; i += 1) {
    if (cursor + 46 > bytes.byteLength || u32(view, cursor) !== CEN) break;
    const nameLength = u16(view, cursor + 28);
    const extraLength = u16(view, cursor + 30);
    const commentLength = u16(view, cursor + 32);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > bytes.byteLength) break;
    entries.push({
      name: decoder.decode(bytes.subarray(nameStart, nameEnd)),
      method: u16(view, cursor + 10),
      compressedSize: u32(view, cursor + 20),
      uncompressedSize: u32(view, cursor + 24),
      localHeaderOffset: u32(view, cursor + 42),
    });
    cursor = nameEnd + extraLength + commentLength;
  }

  return entries;
}

export async function readZipEntry(
  bytes: Uint8Array<ArrayBuffer>,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const local = entry.localHeaderOffset;
  if (local + 30 > bytes.byteLength || u32(view, local) !== LOC) {
    throw new Error("Invalid zip local header");
  }
  const nameLength = u16(view, local + 26);
  const extraLength = u16(view, local + 28);
  const dataStart = local + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataEnd > bytes.byteLength) throw new Error("Truncated zip entry");
  const compressed = bytes.subarray(dataStart, dataEnd);
  if (entry.method === 0) return compressed;
  if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("Unsupported zip compression");
  }
  const stream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function shouldSkipZipMember(name: string): boolean {
  if (!name || name.endsWith("/")) return true;
  const parts = name.split("/");
  if (parts.some((part) => part.startsWith(".") || part === "__MACOSX")) {
    return true;
  }
  const base = parts[parts.length - 1] ?? name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return false;
  return base.slice(dot + 1).toLowerCase() === "zip";
}

export async function filesFromZip(
  file: File,
): Promise<ReadonlyArray<{ path: string; file: File }>> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const members: { path: string; file: File }[] = [];
  for (const entry of listZipEntries(bytes)) {
    if (shouldSkipZipMember(entry.name)) continue;
    const data = await readZipEntry(bytes, entry);
    const copy = new Uint8Array(data.byteLength);
    copy.set(data);
    members.push({
      path: entry.name,
      file: new File([copy], entry.name),
    });
  }
  return members;
}

export async function readZipText(
  bytes: Uint8Array<ArrayBuffer>,
  name: string,
): Promise<string | null> {
  const entry = listZipEntries(bytes).find((item) => item.name === name);
  if (!entry) return null;
  return new TextDecoder().decode(await readZipEntry(bytes, entry));
}
