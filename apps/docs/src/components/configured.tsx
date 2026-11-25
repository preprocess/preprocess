import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { createContext, use } from "react";

// The API URL this deployment documents (the Worker's API_URL), so examples
// show a self-hosted install its own origin rather than ours.
export const ApiUrlContext = createContext("");

// A code block whose {api} and {origin} placeholders become this
// deployment's API URL and the origin it is served from.
export function Configured({ lang, code }: { lang: string; code: string }) {
  const api = use(ApiUrlContext);
  const origin = api.replace(/\/v1\/?$/, "");
  return (
    <div className="not-typeset">
      <DynamicCodeBlock
        lang={lang}
        code={code.replaceAll("{api}", api).replaceAll("{origin}", origin)}
      />
    </div>
  );
}
