// The help center's categories, in the order the home page and sidebar list
// them (support-center spec). Each is a folder of content/articles holding a
// meta.json with the same title and its articles' order.
export const categories = [
  { slug: "getting-started", title: "Getting started" },
  { slug: "agents", title: "Agents" },
  { slug: "billing-and-credits", title: "Billing and credits" },
  { slug: "integrations", title: "Integrations (GitHub, MCP)" },
  { slug: "security-and-sso", title: "Security and SSO" },
  { slug: "self-hosting", title: "Self-hosting" },
] as const;

export type Category = (typeof categories)[number];
