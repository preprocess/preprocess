// The GitHub App (spec: deploys arrive from the CLI and from a GitHub App
// that builds on every push). An organization installs the App, links one of
// the installation's repositories to an agent, and every push to that
// repository builds the agent in a sandbox and deploys it the way
// `preprocess deploy` does. The installation token never reaches these
// tables.

import {
  bigint,
  boolean,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";

import { organization } from "./auth.ts";
import { deployments } from "./deployments.ts";

export const githubInstallations = pgTable(
  "github_installations",
  {
    id: text().primaryKey(),
    organizationId: text()
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    // GitHub's installation id: one organization per installation.
    installationId: bigint({ mode: "number" }).notNull().unique(),
    accountLogin: text().notNull(),
    accountType: text().notNull(),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    suspendedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("github_installations_org_id_unique").on(t.organizationId, t.id),
  ],
);

// The repositories an installation grants, kept in step by the
// installation_repositories webhook.
export const githubRepositories = pgTable(
  "github_repositories",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    installationId: text().notNull(),
    repositoryId: bigint({ mode: "number" }).notNull(),
    fullName: text().notNull(),
    defaultBranch: text(),
    private: boolean().notNull(),
    removedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    unique("github_repositories_org_id_unique").on(t.organizationId, t.id),
    unique().on(t.installationId, t.repositoryId),
    foreignKey({
      columns: [t.organizationId, t.installationId],
      foreignColumns: [
        githubInstallations.organizationId,
        githubInstallations.id,
      ],
    }).onDelete("cascade"),
  ],
);

// One repository feeds one agent: pushes to `branch` (every branch when
// null) build `entry` from `directory`. The agent is named by slug, because
// its first deploy creates it.
export const githubLinks = pgTable(
  "github_links",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    repositoryId: text().notNull(),
    agentSlug: text().notNull(),
    branch: text(),
    directory: text().notNull().default(""),
    entry: text().notNull().default("src/index.ts"),
    createdBy: text().notNull(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("github_links_org_id_unique").on(t.organizationId, t.id),
    unique().on(t.organizationId, t.agentSlug),
    index().on(t.organizationId, t.repositoryId),
    foreignKey({
      columns: [t.organizationId, t.repositoryId],
      foreignColumns: [
        githubRepositories.organizationId,
        githubRepositories.id,
      ],
    }).onDelete("cascade"),
  ],
);

// superseded: a newer push to the same agent and branch replaced it.
export const githubBuildStatus = pgEnum("github_build_status", [
  "queued",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "superseded",
]);

// One per push and link. `log` is the tail of the sandbox's output.
export const githubBuilds = pgTable(
  "github_builds",
  {
    id: text().primaryKey(),
    organizationId: text().notNull(),
    linkId: text().notNull(),
    agentSlug: text().notNull(),
    branch: text().notNull(),
    commit: text().notNull(),
    status: githubBuildStatus().notNull(),
    deploymentId: text(),
    error: text(),
    log: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp({ withTimezone: true }),
    finishedAt: timestamp({ withTimezone: true }),
  },
  (t) => [
    index().on(t.organizationId, t.agentSlug, t.createdAt),
    index().on(t.linkId, t.branch, t.status),
    foreignKey({
      columns: [t.organizationId, t.linkId],
      foreignColumns: [githubLinks.organizationId, githubLinks.id],
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.organizationId, t.deploymentId],
      foreignColumns: [deployments.organizationId, deployments.id],
    }).onDelete("cascade"),
  ],
);
