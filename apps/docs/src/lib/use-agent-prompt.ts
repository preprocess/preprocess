import { use, useState } from "react";

import { ApiUrlContext, configure } from "@/components/configured";
import { agentPrompts } from "@/lib/prompts";

// A prompt for a coding agent with this deployment's URLs filled in, copied
// whole and shown folded until expanded.
export function useAgentPrompt(name: keyof typeof agentPrompts) {
  const { title, prompt } = agentPrompts[name];
  const text = configure(prompt, use(ApiUrlContext));
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return { title, text, expanded, setExpanded, copied, copy };
}
