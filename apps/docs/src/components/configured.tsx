import { DynamicCodeBlock } from "fumadocs-ui/components/dynamic-codeblock";
import { createContext, use } from "react";

// The API URL this deployment documents (the Worker's API_URL), so examples
// show a self-hosted install its own origin rather than ours.
export const ApiUrlContext = createContext("");

// {api} and {origin} placeholders become this deployment's API URL and the
// origin it is served from.
export function configure(text: string, api: string) {
  const origin = api.replace(/\/v1\/?$/, "");
  return text.replaceAll("{api}", api).replaceAll("{origin}", origin);
}

export function Configured({ lang, code }: { lang: string; code: string }) {
  return (
    <div className="not-typeset">
      <DynamicCodeBlock
        lang={lang}
        code={configure(code, use(ApiUrlContext))}
      />
    </div>
  );
}
