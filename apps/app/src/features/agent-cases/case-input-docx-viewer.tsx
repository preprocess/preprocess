"use client";

import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { renderAsync } from "docx-preview";
import { useEffect, useRef, useState } from "react";

import {
  DownloadFallback,
  Opening,
  type CaseInputPreviewItem,
} from "./case-input-fallback";

export default function CaseInputDocxViewer({
  item,
}: {
  item: CaseInputPreviewItem;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    host.replaceChildren();
    setStatus("loading");

    void item.file.arrayBuffer().then(
      async (buffer) => {
        try {
          if (cancelled || !hostRef.current) return;
          await renderAsync(buffer, hostRef.current);
          if (!cancelled) setStatus("ready");
        } catch {
          if (!cancelled) setStatus("error");
        }
      },
      () => {
        if (!cancelled) setStatus("error");
      },
    );

    return () => {
      cancelled = true;
    };
  }, [item.file]);

  if (status === "error") {
    return (
      <DownloadFallback
        detail="This document could not be opened in the browser."
        item={item}
      />
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1" orientation="both">
      {status === "loading" ? <Opening /> : null}
      <div className="p-4" ref={hostRef} />
    </ScrollArea>
  );
}
