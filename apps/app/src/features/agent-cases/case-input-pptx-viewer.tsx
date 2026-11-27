"use client";

import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { useEffect, useState } from "react";

import {
  DownloadFallback,
  Opening,
  PreviewEmpty,
  type CaseInputPreviewItem,
} from "./case-input-fallback";
import { listZipEntries, readZipEntry } from "./case-input-zip";
import { textFromMarkup } from "./case-input-xml";

type Slide = {
  readonly title: string;
  readonly text: string;
};

export default function CaseInputPptxViewer({
  item,
}: {
  item: CaseInputPreviewItem;
}) {
  const [slides, setSlides] = useState<Slide[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void item.file.arrayBuffer().then(
      async (buffer) => {
        try {
          const bytes = new Uint8Array(buffer);
          const entries = listZipEntries(bytes);
          const next: Slide[] = [];

          const pptSlides = entries
            .filter((entry) => /^ppt\/slides\/slide\d+\.xml$/.test(entry.name))
            .sort((a, b) =>
              a.name.localeCompare(b.name, undefined, { numeric: true }),
            );

          for (const [index, entry] of pptSlides.entries()) {
            const xml = new TextDecoder().decode(
              await readZipEntry(bytes, entry),
            );
            next.push({
              title: `Slide ${index + 1}`,
              text: textFromMarkup(xml),
            });
          }

          if (next.length === 0) {
            const content = entries.find(
              (entry) => entry.name === "content.xml",
            );
            if (content) {
              const xml = new TextDecoder().decode(
                await readZipEntry(bytes, content),
              );
              const pages = xml.split(/<draw:page\b/i).slice(1);
              if (pages.length === 0) {
                const text = textFromMarkup(xml);
                if (text) next.push({ title: "Slides", text });
              } else {
                for (const [index, page] of pages.entries()) {
                  next.push({
                    title: `Slide ${index + 1}`,
                    text: textFromMarkup(`<draw:page${page}`),
                  });
                }
              }
            }
          }

          if (!cancelled) setSlides(next);
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
        detail="This deck could not be opened in the browser."
        item={item}
      />
    );
  }
  if (slides == null) return <Opening />;
  if (slides.length === 0) {
    return (
      <PreviewEmpty
        description="This presentation has no slides to display."
        item={item}
      />
    );
  }

  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <ol className="flex flex-col gap-6 p-4">
        {slides.map((slide) => (
          <li className="flex flex-col gap-2" key={slide.title}>
            <p className="text-caption text-muted-foreground">{slide.title}</p>
            {slide.text ? (
              <pre className="text-body whitespace-pre-wrap text-foreground">
                {slide.text}
              </pre>
            ) : null}
          </li>
        ))}
      </ol>
    </ScrollArea>
  );
}
