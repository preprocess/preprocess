// Product announcements for the sidebar notice stack, newest last. Each
// person can dismiss one; the API keeps the dismissal by id, so an id never
// changes once shipped.

export type Announcement = {
  id: string;
  title: string;
  detail: string;
  href: string;
  date: string;
};

export const ANNOUNCEMENTS: readonly Announcement[] = [
  {
    id: "case-sandboxes",
    title: "Case sandboxes are live",
    detail: "Run agent code in containers",
    href: "/settings/organization/sandboxes",
    date: "2026-11-27",
  },
];
