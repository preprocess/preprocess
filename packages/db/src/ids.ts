import { typeid } from "typeid-js";

// Text ids with a type prefix and a time-ordered body (design doc 01).
export const prefixes = {
  user: "usr",
  session: "ses",
  account: "acc",
  verification: "ver",
  organization: "org",
  member: "mem",
  invitation: "inv",
  apikey: "key",
  group: "grp",
  agent: "agt",
  secret: "sec",
  case: "case",
  audit: "aud",
} as const;

export type IdKind = keyof typeof prefixes;

export const newId = (kind: IdKind): string =>
  typeid(prefixes[kind]).toString();
