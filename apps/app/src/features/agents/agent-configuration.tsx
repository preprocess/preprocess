import { Badge } from "@preprocess/ui/components/badge";
import { Button } from "@preprocess/ui/components/button";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import type { IconComponent } from "@preprocess/ui/lib/icon-context";
import {
  Check,
  Clock,
  Copy,
  Link as LinkIcon,
  Mail,
  Server,
  WrenchScrewdriver,
} from "@preprocess/ui/lib/icons";
import { useState } from "react";

import {
  SettingsCard,
  SettingsIconTile,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "../settings/kit";
import {
  agentEndpoint,
  type AgentDefinition,
  type AgentTrigger,
} from "./agent-definition";

/** The request a developer copies to start a case, production by default. */
function requestExample(endpoint: string) {
  return [
    `curl ${endpoint} \\`,
    `  -H "Authorization: Bearer $PREPROCESS_API_KEY" \\`,
    `  -F "input=@./pack.pdf" \\`,
    `  -F 'metadata={"customer":"acme"}'`,
  ].join("\n");
}

function CodeBlock({ code, label }: Readonly<{ code: string; label: string }>) {
  const [copied, setCopied] = useState(false);
  return (
    <SettingsCard className="relative">
      <pre className="overflow-x-auto px-5 py-4 font-mono text-caption text-foreground">
        {code}
      </pre>
      <div className="absolute top-2 right-2">
        <Tooltip content={copied ? "Copied" : `Copy ${label}`} side="left">
          <Button
            aria-label={`Copy ${label}`}
            onClick={() => {
              void navigator.clipboard?.writeText(code).then(() => {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1200);
              });
            }}
            size="icon-compact"
            type="button"
            variant="ghost"
          >
            {copied ? (
              <Check aria-hidden="true" />
            ) : (
              <Copy aria-hidden="true" />
            )}
          </Button>
        </Tooltip>
      </div>
    </SettingsCard>
  );
}

function triggerRow(trigger: AgentTrigger): {
  icon: IconComponent;
  label: string;
  description: string;
} {
  switch (trigger.kind) {
    case "api":
      return {
        icon: Server,
        label: "API",
        description: "A POST to the agent's endpoint starts a case",
      };
    case "webhook":
      return {
        icon: LinkIcon,
        label: "Webhook",
        description: `Events from ${trigger.source}`,
      };
    case "schedule":
      return {
        icon: Clock,
        label: "Schedule",
        description: `${trigger.label} (${trigger.cron})`,
      };
    case "email":
      return {
        icon: Mail,
        label: "Inbound email",
        description: trigger.address,
      };
    default: {
      const _exhaustive: never = trigger;
      return _exhaustive;
    }
  }
}

/**
 * The agent's configuration as its deployed code defines it: the endpoint
 * that starts a case, what else can start one, and what the agent is made
 * of. Read-only; it changes with a new deployment.
 */
export function AgentConfiguration({
  agentId,
  definition,
}: Readonly<{ agentId: string; definition: AgentDefinition }>) {
  const endpoint = agentEndpoint(agentId);

  return (
    <>
      <SettingsSection
        description="POST to this endpoint to start a case on the production deployment. Send a Preprocess-Deployment header to target a preview or your dev session."
        title="Endpoint"
      >
        <InputCopy value={endpoint} variant="button" />
        <CodeBlock code={requestExample(endpoint)} label="request" />
      </SettingsSection>

      <SettingsSection
        description="Everything that starts a case. Webhooks, schedules, and email always run on production."
        title="Triggers"
      >
        <SettingsRows>
          {definition.triggers.map((trigger) => {
            const row = triggerRow(trigger);
            return (
              <SettingsRow
                description={row.description}
                key={`${trigger.kind}-${row.description}`}
                label={row.label}
                leading={<SettingsIconTile icon={row.icon} />}
              />
            );
          })}
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        description="What the agent is told on every case, from its instructions file."
        title="Instructions"
      >
        <SettingsCard className="px-5 py-4 text-body text-foreground">
          {definition.instructions || "No instructions yet."}
        </SettingsCard>
        {definition.skills.length > 0 ? (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-caption text-muted-foreground">Skills</span>
            {definition.skills.map((skill) => (
              <Badge color="gray" key={skill} size="sm">
                {skill}
              </Badge>
            ))}
          </div>
        ) : null}
      </SettingsSection>

      <SettingsSection
        description="Built-in Preprocess tools and the tools in the agent's code."
        title="Tools"
      >
        <SettingsRows>
          {definition.tools.map((tool) => (
            <SettingsRow
              description={tool.description}
              key={tool.name}
              label={tool.name}
              leading={<SettingsIconTile icon={WrenchScrewdriver} />}
            >
              <Badge color="gray" size="sm">
                {tool.builtIn ? "Built in" : "Code"}
              </Badge>
            </SettingsRow>
          ))}
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        description="The structured result every case fills in, from the output file."
        title="Output"
      >
        <SettingsRows>
          {definition.output.map((field) => (
            <SettingsRow
              description={field.description}
              key={field.path}
              label={field.path}
            >
              <Badge color="gray" size="sm">
                {field.type}
              </Badge>
            </SettingsRow>
          ))}
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        description="A case can't finish until these pass; the agent keeps working until they do, within its safety stops."
        title="Checks"
      >
        <SettingsRows>
          {definition.checks.map((check) => (
            <SettingsRow
              key={check}
              label={check}
              leading={<SettingsIconTile icon={Check} />}
            />
          ))}
        </SettingsRows>
      </SettingsSection>

      <SettingsSection
        description="What runs once the checks pass. On previews and dev it only records what it would do."
        title="On success"
      >
        <SettingsCard className="px-5 py-4 text-body text-foreground">
          {definition.onSuccess || "Nothing runs on success yet."}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}
