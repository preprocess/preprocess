"use client";

import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { Tabs, TabsItem } from "@preprocess/ui/components/tabs";
import { useEffect, useState } from "react";
import * as XLSX from "xlsx";

import {
  DownloadFallback,
  Opening,
  PreviewEmpty,
  type CaseInputPreviewItem,
} from "./case-input-fallback";

type Sheet = {
  readonly name: string;
  readonly rows: string[][];
};

export default function CaseInputSheetViewer({
  item,
}: {
  item: CaseInputPreviewItem;
}) {
  const [sheets, setSheets] = useState<Sheet[] | null>(null);
  const [active, setActive] = useState(0);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void item.file.arrayBuffer().then(
      (buffer) => {
        try {
          const workbook = XLSX.read(buffer, { type: "array" });
          const next = workbook.SheetNames.map((name) => {
            const sheet = workbook.Sheets[name];
            const rows = sheet
              ? XLSX.utils.sheet_to_json<string[]>(sheet, {
                  header: 1,
                  raw: false,
                  defval: "",
                })
              : [];
            return { name, rows };
          });
          if (cancelled) return;
          setSheets(next);
          setActive(0);
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
        detail="This spreadsheet could not be opened in the browser."
        item={item}
      />
    );
  }
  if (sheets == null) return <Opening />;
  if (sheets.length === 0) {
    return (
      <PreviewEmpty
        description="This spreadsheet has no rows to display."
        item={item}
      />
    );
  }

  const sheet = sheets[active] ?? sheets[0];
  if (!sheet) {
    return (
      <PreviewEmpty
        description="This spreadsheet has no rows to display."
        item={item}
      />
    );
  }
  const [header, ...body] = sheet.rows;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {sheets.length > 1 ? (
        <div className="flex h-9 shrink-0 items-center border-b border-border px-1">
          <Tabs
            aria-label="Sheets"
            className="min-w-0"
            onSelect={setActive}
            selectedIndex={active}
            size="compact"
          >
            {sheets.map((entry, index) => (
              <TabsItem index={index} key={entry.name} label={entry.name} />
            ))}
          </Tabs>
        </div>
      ) : null}
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
    </div>
  );
}
