import type { ThemeRegistration } from "shiki";

// One monochrome theme: code in the foreground, keywords heavier, strings and
// comments muted. The colors are the app's tokens, so the same theme serves
// light and dark.
export const monochrome: ThemeRegistration = {
  name: "preprocess-monochrome",
  type: "light",
  colors: {
    "editor.background": "var(--surface-1)",
    "editor.foreground": "var(--foreground)",
  },
  tokenColors: [
    { settings: { foreground: "var(--foreground)" } },
    {
      scope: ["keyword", "storage", "storage.type", "storage.modifier"],
      settings: { fontStyle: "bold" },
    },
    {
      scope: ["string", "string.quoted", "string.template"],
      settings: { foreground: "var(--muted-foreground)" },
    },
    {
      scope: ["comment", "punctuation.definition.comment"],
      settings: { foreground: "var(--muted-foreground)", fontStyle: "italic" },
    },
  ],
};
