import { ScrollArea } from "@preprocess/ui/components/scroll-area";
import { fontWeights } from "@preprocess/ui/lib/font-weight";

import { SettingsEmpty } from "../features/settings/kit";
import { ComingSoonArt } from "./empty-art";

/** A titled page with an empty state, for sections not built yet. */
export function PlaceholderPage({
  title,
  emptyTitle,
  description,
}: {
  title: string;
  emptyTitle: string;
  description: string;
}) {
  return (
    <ScrollArea className="min-h-0 flex-1" viewportClassName="scroll-fade">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-8">
        <div className="flex flex-col gap-1">
          <h1
            className="text-title text-foreground"
            style={{ fontVariationSettings: fontWeights.semibold }}
          >
            {title}
          </h1>
        </div>
        <SettingsEmpty
          art={<ComingSoonArt />}
          description={description}
          title={emptyTitle}
        />
      </div>
    </ScrollArea>
  );
}
