import { createOpenAPIPage } from "fumadocs-openapi/ui";

import { monochrome } from "@/lib/shiki-theme";

// Each operation reads as a schema column with its examples in a sticky
// column beside it once the panel is wide enough for both.
export const OpenAPIPage = createOpenAPIPage({
  shikiOptions: { themes: { light: monochrome, dark: monochrome } },
  content: {
    renderOperationLayout: (slots) => (
      <div className="docs-api flex flex-col gap-12 @min-[65.5rem]:flex-row @min-[65.5rem]:items-start">
        <div className="min-w-0 flex-1 @min-[65.5rem]:max-w-[560px]">
          {slots.header}
          <div className="docs-api-pill">{slots.apiPlayground}</div>
          {slots.description}
          {slots.authSchemes}
          {slots.parameters}
          {slots.body}
          {slots.responses}
          {slots.callbacks}
        </div>
        <div className="docs-api-examples flex w-full shrink-0 flex-col gap-4 @min-[65.5rem]:sticky @min-[65.5rem]:top-6 @min-[65.5rem]:w-[440px]">
          {slots.apiExample}
        </div>
      </div>
    ),
  },
});
