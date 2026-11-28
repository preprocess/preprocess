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
  ssoProvider: "sso",
  ssoDomain: "ssd",
  group: "grp",
  agent: "agt",
  deployment: "dep",
  secret: "sec",
  modelEndpoint: "mep",
  mcpServer: "mcs",
  mcpConnection: "mcc",
  mcpAuthorization: "mca",
  case: "case",
  audit: "aud",
  file: "file",
  reviewEvent: "rev",
  mention: "men",
  webhook: "whk",
  delivery: "msg",
  outbox: "obx",
  githubInstallation: "ghi",
  githubRepository: "ghr",
  githubLink: "ghl",
  githubBuild: "bld",
  guardrailRequest: "grq",
  evalSuite: "evs",
  evalRun: "evr",
  memory: "mry",
  usageRecord: "use",
  usageReport: "urp",
  sandboxInterval: "sbi",
  retentionSweep: "rsw",
  dataset: "dst",
  scim: "scim",
  supportRequest: "spr",
  supportMessage: "spm",
  supportAttachment: "spa",
} as const;

export type IdKind = keyof typeof prefixes;

export const newId = (kind: IdKind): string =>
  typeid(prefixes[kind]).toString();
