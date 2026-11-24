"use client";

import { Button } from "@preprocess/ui/components/button";
import { Spinner } from "@preprocess/ui/components/spinner";
import { useEffect, useState, type ReactNode } from "react";

import { familyLabel, type CaseInputFamily } from "./case-input-kind";

export type CaseInputPreviewItem = {
  readonly file: File;
  readonly family: CaseInputFamily;
  readonly url: string;
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function Opening() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <Spinner className="size-5 text-muted-foreground" />
    </div>
  );
}

export function DownloadFallback({
  item,
  detail,
}: {
  item: CaseInputPreviewItem;
  detail: string;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-start justify-center gap-3 p-6">
      <div className="flex flex-col gap-1">
        <p className="text-body text-foreground">{item.file.name}</p>
        <p className="text-body text-muted-foreground">
          {familyLabel(item.family)} · {formatSize(item.file.size)}
        </p>
        <p className="text-body text-muted-foreground">{detail}</p>
      </div>
      <Button asChild size="sm" variant="secondary">
        <a download={item.file.name} href={item.url}>
          Download
        </a>
      </Button>
    </div>
  );
}

export function FileText({
  file,
  children,
}: {
  file: File;
  children: (text: string) => ReactNode;
}) {
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void file.text().then((value) => {
      if (!cancelled) setText(value);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (text == null) return <Opening />;
  return children(text);
}
