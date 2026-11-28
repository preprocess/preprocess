"use client";

import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";

import { Markdown } from "../../components/agent-elements/markdown";
import {
  DownloadFallback,
  FileText,
  Opening,
  type CaseInputPreviewItem,
} from "./case-input-fallback";
import { parseEml } from "./case-input-eml";
import { firstSpineHtml } from "./case-input-epub";
import { extensionOf, previewOf } from "./case-input-kind";
import { textFromMarkup } from "./case-input-xml";
import { listZipEntries, readZipEntry } from "./case-input-zip";

export type { CaseInputPreviewItem };

const CaseInputSheetViewer = lazy(() => import("./case-input-sheet-viewer"));
const CaseInputDocxViewer = lazy(() => import("./case-input-docx-viewer"));
const CaseInputPptxViewer = lazy(() => import("./case-input-pptx-viewer"));

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    if (char !== "\r") cell += char;
  }
  row.push(cell);
  if (row.some((value) => value.length > 0) || rows.length === 0) {
    rows.push(row);
  }
  return rows;
}

function ImagePreview({ item }: { item: CaseInputPreviewItem }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <DownloadFallback
        detail="This browser cannot preview this image format."
        item={item}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4">
      <img
        alt={item.file.name}
        className="max-h-full max-w-full object-contain"
        onError={() => setFailed(true)}
        src={item.url}
      />
    </div>
  );
}

function CsvPreview({ text }: { text: string }) {
  const rows = parseCsv(text);
  const [header, ...body] = rows;

  return (
    <ScrollArea className="min-h-0 flex-1" orientation="both">
      <table className="w-max min-w-full border-collapse text-body">
        {header ? (
          <thead className="sticky top-0 bg-accent">
            <tr className="border-b border-border">
              {header.map((cell, cellIndex) => (
                <th
                  className="px-3 py-1.5 text-left font-medium whitespace-pre-wrap text-foreground"
                  key={`h-${cellIndex}`}
                >
                  {cell}
                </th>
              ))}
            </tr>
          </thead>
        ) : null}
        <tbody>
          {body.map((row, rowIndex) => (
            <tr className="border-b border-border" key={rowIndex}>
              {row.map((cell, cellIndex) => (
                <td
                  className="px-3 py-1.5 align-top whitespace-pre-wrap text-foreground"
                  key={`${rowIndex}-${cellIndex}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </ScrollArea>
  );
}

function OdtPreview({ item }: { item: CaseInputPreviewItem }) {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const ext = extensionOf(item.file.name);

  useEffect(() => {
    let cancelled = false;
    if (ext === "fodt") {
      void item.file.text().then(
        (value) => {
          if (!cancelled) setText(textFromMarkup(value));
        },
        () => {
          if (!cancelled) setError(true);
        },
      );
      return () => {
        cancelled = true;
      };
    }

    void item.file.arrayBuffer().then(
      async (buffer) => {
        try {
          const bytes = new Uint8Array(buffer);
          const entry = listZipEntries(bytes).find(
            (zipEntry) => zipEntry.name === "content.xml",
          );
          if (!entry) throw new Error("Missing content.xml");
          const xml = new TextDecoder().decode(
            await readZipEntry(bytes, entry),
          );
          if (!cancelled) setText(textFromMarkup(xml));
        } catch {
          if (!cancelled) setError(true);
        }
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ext, item.file]);

  if (error) {
    return (
      <DownloadFallback
        detail="This document could not be opened in the browser."
        item={item}
      />
    );
  }
  if (text == null) return <Opening />;
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <pre className="p-4 text-body whitespace-pre-wrap text-foreground">
        {text}
      </pre>
    </ScrollArea>
  );
}

function EpubPreview({ item }: { item: CaseInputPreviewItem }) {
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void item.file.arrayBuffer().then(
      async (buffer) => {
        try {
          const markup = await firstSpineHtml(new Uint8Array(buffer));
          if (!cancelled) setHtml(markup);
        } catch {
          if (!cancelled) setError(true);
        }
      },
      () => {
        if (!cancelled) setError(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [item.file]);

  if (error) {
    return (
      <DownloadFallback
        detail="This book could not be opened in the browser."
        item={item}
      />
    );
  }
  if (html == null) return <Opening />;
  return (
    <iframe
      className="min-h-0 flex-1 border-0 bg-white"
      sandbox=""
      srcDoc={html}
      title={item.file.name}
    />
  );
}

function EmailField({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-body">
      <dt className="w-14 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-foreground">{value}</dd>
    </div>
  );
}

function EmailPreview({ text }: { text: string }) {
  const email = parseEml(text);
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <div className="border-b border-border px-4 py-3">
        <p className="text-body font-medium text-foreground">
          {email.subject || "Untitled message"}
        </p>
        <dl className="mt-2 flex flex-col gap-1">
          <EmailField label="From" value={email.from} />
          <EmailField label="To" value={email.to} />
          <EmailField label="Cc" value={email.cc} />
          <EmailField label="Date" value={email.date} />
        </dl>
      </div>
      {email.body ? (
        <pre className="p-4 text-body whitespace-pre-wrap text-foreground">
          {email.body}
        </pre>
      ) : null}
    </ScrollArea>
  );
}

function LazyOffice({ children }: { children: ReactNode }) {
  return <Suspense fallback={<Opening />}>{children}</Suspense>;
}

export function CaseInputViewer({ item }: { item: CaseInputPreviewItem }) {
  const preview = previewOf(item.file.name, item.file.type);

  switch (preview) {
    case "image":
      return <ImagePreview item={item} />;
    case "audio":
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <audio
            aria-label={item.file.name}
            className="w-full max-w-xl"
            controls
            src={item.url}
          />
        </div>
      );
    case "video":
      return (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <video
            aria-label={item.file.name}
            className="h-auto max-h-full w-full object-contain"
            controls
            src={item.url}
          />
        </div>
      );
    case "pdf":
      return (
        <iframe
          className="min-h-0 flex-1 border-0"
          src={item.url}
          title={item.file.name}
        />
      );
    case "text":
      return (
        <FileText file={item.file}>
          {(text) => (
            <ScrollArea
              className="min-h-0 flex-1"
              viewportClassName="scroll-fade"
            >
              <pre className="p-4 text-body whitespace-pre-wrap text-foreground">
                {text}
              </pre>
            </ScrollArea>
          )}
        </FileText>
      );
    case "eml":
      return (
        <FileText file={item.file}>
          {(text) => <EmailPreview text={text} />}
        </FileText>
      );
    case "markdown":
      return (
        <FileText file={item.file}>
          {(text) => (
            <ScrollArea
              className="min-h-0 flex-1"
              viewportClassName="scroll-fade"
            >
              <div className="p-4">
                <Markdown content={text} />
              </div>
            </ScrollArea>
          )}
        </FileText>
      );
    case "html":
      return (
        <FileText file={item.file}>
          {(text) => (
            <iframe
              className="min-h-0 flex-1 border-0 bg-white"
              sandbox=""
              srcDoc={text}
              title={item.file.name}
            />
          )}
        </FileText>
      );
    case "csv":
      return (
        <FileText file={item.file}>
          {(text) => <CsvPreview text={text} />}
        </FileText>
      );
    case "xlsx":
    case "ods":
      return (
        <LazyOffice>
          <CaseInputSheetViewer item={item} />
        </LazyOffice>
      );
    case "docx":
      return (
        <LazyOffice>
          <CaseInputDocxViewer item={item} />
        </LazyOffice>
      );
    case "pptx":
    case "odp":
      return (
        <LazyOffice>
          <CaseInputPptxViewer item={item} />
        </LazyOffice>
      );
    case "odt":
    case "odg":
      return <OdtPreview item={item} />;
    case "epub":
      return <EpubPreview item={item} />;
    case "download":
      return (
        <DownloadFallback
          detail={
            item.family === "unknown"
              ? "This type is not previewed. Download the file instead."
              : "This browser cannot preview this format. Download the file instead."
          }
          item={item}
        />
      );
    default: {
      const _exhaustive: never = preview;
      return _exhaustive;
    }
  }
}
