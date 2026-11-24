export const CASE_INPUT_FAMILIES = [
  "image",
  "pdf",
  "sheet",
  "slides",
  "document",
  "audio",
  "video",
  "email",
  "archive",
  "unknown",
] as const;

export type CaseInputFamily = (typeof CASE_INPUT_FAMILIES)[number];

export const CASE_INPUT_PREVIEWS = [
  "pdf",
  "image",
  "audio",
  "video",
  "csv",
  "xlsx",
  "ods",
  "docx",
  "odt",
  "odg",
  "pptx",
  "odp",
  "html",
  "markdown",
  "text",
  "epub",
  "eml",
  "download",
] as const;

export type CaseInputPreview = (typeof CASE_INPUT_PREVIEWS)[number];

type CaseInputExtRule = {
  readonly family: CaseInputFamily;
  readonly preview: CaseInputPreview;
};

const CASE_INPUT_BY_EXTENSION = {
  pdf: { family: "pdf", preview: "pdf" },

  png: { family: "image", preview: "image" },
  jpg: { family: "image", preview: "image" },
  jpeg: { family: "image", preview: "image" },
  jfif: { family: "image", preview: "image" },
  webp: { family: "image", preview: "image" },
  gif: { family: "image", preview: "image" },
  bmp: { family: "image", preview: "image" },
  svg: { family: "image", preview: "image" },
  ico: { family: "image", preview: "image" },
  avif: { family: "image", preview: "image" },
  tif: { family: "image", preview: "image" },
  tiff: { family: "image", preview: "image" },
  heic: { family: "image", preview: "image" },
  heif: { family: "image", preview: "image" },

  dng: { family: "image", preview: "download" },
  cr2: { family: "image", preview: "download" },
  cr3: { family: "image", preview: "download" },
  nef: { family: "image", preview: "download" },
  arw: { family: "image", preview: "download" },
  raf: { family: "image", preview: "download" },
  orf: { family: "image", preview: "download" },
  rw2: { family: "image", preview: "download" },
  sr2: { family: "image", preview: "download" },
  pef: { family: "image", preview: "download" },

  wav: { family: "audio", preview: "audio" },
  mp3: { family: "audio", preview: "audio" },
  m4a: { family: "audio", preview: "audio" },
  flac: { family: "audio", preview: "audio" },
  ogg: { family: "audio", preview: "audio" },
  opus: { family: "audio", preview: "audio" },
  aac: { family: "audio", preview: "audio" },
  aiff: { family: "audio", preview: "audio" },
  aif: { family: "audio", preview: "audio" },
  wma: { family: "audio", preview: "audio" },
  amr: { family: "audio", preview: "audio" },

  mp4: { family: "video", preview: "video" },
  m4v: { family: "video", preview: "video" },
  webm: { family: "video", preview: "video" },
  mov: { family: "video", preview: "video" },
  mkv: { family: "video", preview: "video" },
  avi: { family: "video", preview: "video" },
  mpg: { family: "video", preview: "video" },
  mpeg: { family: "video", preview: "video" },
  wmv: { family: "video", preview: "video" },
  "3gp": { family: "video", preview: "video" },

  csv: { family: "sheet", preview: "csv" },
  xlsx: { family: "sheet", preview: "xlsx" },
  ods: { family: "sheet", preview: "ods" },
  xls: { family: "sheet", preview: "download" },

  docx: { family: "document", preview: "docx" },
  odt: { family: "document", preview: "odt" },
  odg: { family: "slides", preview: "odg" },
  fodt: { family: "document", preview: "odt" },
  doc: { family: "document", preview: "download" },

  pptx: { family: "slides", preview: "pptx" },
  odp: { family: "slides", preview: "odp" },
  ppt: { family: "slides", preview: "download" },

  html: { family: "document", preview: "html" },
  htm: { family: "document", preview: "html" },
  xhtml: { family: "document", preview: "html" },
  md: { family: "document", preview: "markdown" },
  txt: { family: "document", preview: "text" },
  rtf: { family: "document", preview: "text" },
  epub: { family: "document", preview: "epub" },

  eml: { family: "email", preview: "eml" },
  msg: { family: "email", preview: "download" },

  zip: { family: "archive", preview: "download" },
} as const satisfies Record<string, CaseInputExtRule>;

export type CaseInputExtension = keyof typeof CASE_INPUT_BY_EXTENSION;

export const CASE_INPUT_EXTENSIONS = Object.keys(
  CASE_INPUT_BY_EXTENSION,
) as CaseInputExtension[];

export const CASE_INPUT_ACCEPT = CASE_INPUT_EXTENSIONS.map(
  (ext) => `.${ext}`,
).join(",");

function ruleOf(ext: string): CaseInputExtRule | undefined {
  if (Object.prototype.hasOwnProperty.call(CASE_INPUT_BY_EXTENSION, ext)) {
    return CASE_INPUT_BY_EXTENSION[ext as CaseInputExtension];
  }
  return undefined;
}

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

export function familyOf(filename: string, mediaType = ""): CaseInputFamily {
  const rule = ruleOf(extensionOf(filename));
  if (rule) return rule.family;
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType.startsWith("text/")) return "document";
  return "unknown";
}

export function previewOf(filename: string, mediaType = ""): CaseInputPreview {
  const rule = ruleOf(extensionOf(filename));
  if (rule) return rule.preview;
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType.startsWith("image/")) return "image";
  if (mediaType.startsWith("audio/")) return "audio";
  if (mediaType.startsWith("video/")) return "video";
  if (mediaType === "text/html") return "html";
  if (mediaType === "text/markdown") return "markdown";
  if (mediaType === "text/csv") return "csv";
  if (mediaType.startsWith("text/")) return "text";
  return "download";
}

export function canOpenInput(filename: string, mediaType = ""): boolean {
  return previewOf(filename, mediaType) !== "download";
}

export function familyLabel(family: CaseInputFamily): string {
  switch (family) {
    case "image":
      return "Image";
    case "pdf":
      return "PDF";
    case "sheet":
      return "Spreadsheet";
    case "slides":
      return "Slides";
    case "document":
      return "Document";
    case "audio":
      return "Audio";
    case "video":
      return "Video";
    case "email":
      return "Email";
    case "archive":
      return "Archive";
    case "unknown":
      return "File";
    default: {
      const _exhaustive: never = family;
      return _exhaustive;
    }
  }
}
