"use client";

// Port of the WorkOS admin-portal-domain-verification widget. Domains are
// added in-app with CreateOrganizationDomain (the widget hands that step to
// the Admin Portal); the DNS record dialog then shows what to publish.

import { Button } from "@preprocess/ui/components/button";
import { InputCopy } from "@preprocess/ui/components/input-copy";
import {
  InlineValidation,
  type InlineValidationHandle,
} from "@preprocess/ui/components/inline-validation";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import { fontWeights } from "@preprocess/ui/lib/font-weight";
import { Globe } from "@preprocess/ui/lib/icons";
import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import {
  type Sdk,
  useWorkOsMutation,
  useWorkOsQuery,
  workOsKey,
} from "../workos-client-api/sdk";
import type {
  DomainVerificationNameServer,
  OrganizationDomainFieldsFragment,
} from "../workos-client-api/vendor/generated";
import {
  formatRelative,
  SettingsConfirmDialog,
  SettingsDialogShell,
  SettingsError,
  SettingsReveal,
  SettingsRow,
  SettingsRowMenu,
  SettingsRows,
  SettingsRowSkeleton,
  SettingsStatus,
  type SettingsStatusState,
  SkeletonButton,
  SkeletonTile,
} from "./kit";
import { validateRequired } from "./settings-elevated";
import { SettingsProviderIcon } from "./settings-provider-mark";

type Domain = OrganizationDomainFieldsFragment;

const PAGE_SIZE = 100;

async function listDomains(sdk: Sdk) {
  const domains: Domain[] = [];
  let after: string | null = null;
  do {
    const { organizationDomains } = await sdk.ListOrganizationDomains({
      after,
      limit: PAGE_SIZE,
      order: "Asc",
    });
    domains.push(...organizationDomains.data);
    after = organizationDomains.listMetadata.after ?? null;
  } while (after !== null);
  return domains;
}

const NAME_SERVER_SLUG: Record<DomainVerificationNameServer, string | null> = {
  AwsRoute53: "aws",
  GoogleDomains: "google",
  CloudFlare: "cloudflare",
  GoDaddy: "godaddy",
  Other: null,
};

function domainStatus(domain: Domain): {
  state: SettingsStatusState;
  label: string;
} {
  switch (domain.state) {
    case "Verified":
    case "LegacyVerified":
      return { state: "success", label: "Verified" };
    case "Failed":
      return { state: "error", label: "Verification failed" };
    default:
      return { state: "waiting", label: "Verification pending" };
  }
}

function isVerified(domain: Domain) {
  return domain.state === "Verified" || domain.state === "LegacyVerified";
}

function Strong({ children }: { children: ReactNode }) {
  return (
    <span
      className="text-foreground"
      style={{ fontVariationSettings: fontWeights.semibold }}
    >
      {children}
    </span>
  );
}

function DnsRecordDialog({
  domain,
  onOpenChange,
  onRestart,
}: {
  domain: Domain;
  onOpenChange: (open: boolean) => void;
  onRestart: () => Promise<unknown>;
}) {
  const failed = domain.state === "Failed";
  const value = `${domain.verificationPrefix ?? "verification_token"}=${domain.verificationToken ?? ""}`;

  return (
    <SettingsDialogShell
      description={
        failed ? (
          <>
            The domain <Strong>{domain.domain}</Strong> will be automatically
            verified once the following DNS record is detected. Use a tool like{" "}
            <a
              className="underline underline-offset-2"
              href="https://dnschecker.org/"
              rel="noopener noreferrer"
              target="_blank"
            >
              DNSChecker
            </a>{" "}
            to check the domain&apos;s record for any mistakes.
          </>
        ) : (
          <>
            The domain <Strong>{domain.domain}</Strong> will be automatically
            verified once the following DNS record is detected.
          </>
        )
      }
      footer={
        failed ? (
          <>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="secondary"
            >
              Close
            </Button>
            <LoadingButton
              onAction={onRestart}
              onStatusChange={(status) => {
                if (status === "success") onOpenChange(false);
              }}
              pendingLabel="Restarting…"
              successLabel="Restarted"
            >
              Restart verification
            </LoadingButton>
          </>
        ) : (
          <Button onClick={() => onOpenChange(false)} type="button">
            Close
          </Button>
        )
      }
      onOpenChange={onOpenChange}
      open
      size="lg"
      title={failed ? "Restart verification" : "View DNS record"}
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <SettingsProviderIcon
            fallback={<Globe />}
            slug={NAME_SERVER_SLUG[domain.nameServer]}
          />
          <Strong>{domain.domain}</Strong>
        </div>
        <dl className="grid grid-cols-[8rem_1fr] items-center gap-x-4 gap-y-3 text-body">
          <dt className="text-muted-foreground">Type</dt>
          <dd className="text-foreground">TXT</dd>
          <dt className="text-muted-foreground">Host / Name</dt>
          <dd className="text-foreground">{domain.subdomain || "@"}</dd>
          <dt className="text-muted-foreground">Value</dt>
          <dd className="min-w-0">
            <InputCopy value={value} />
          </dd>
        </dl>
      </div>
    </SettingsDialogShell>
  );
}

function removeMessage(domain: Domain) {
  if (isVerified(domain)) {
    return (
      <>
        Users with the email domain <Strong>{domain.domain}</Strong> will no
        longer be considered verified. This action is immediate and cannot be
        undone.
      </>
    );
  }
  if (domain.state === "Failed") {
    return (
      <>
        Are you sure you want to remove the domain{" "}
        <Strong>{domain.domain}</Strong>? This action is immediate and cannot be
        undone.
      </>
    );
  }
  return (
    <>
      Removing <Strong>{domain.domain}</Strong> will cancel the DNS record
      verification process. This action is immediate and cannot be undone.
    </>
  );
}

function AddDomainDialog({
  onOpenChange,
  onAdded,
}: {
  onOpenChange: (open: boolean) => void;
  onAdded: (domain: Domain) => void;
}) {
  const domainRef = useRef<InlineValidationHandle>(null);
  const saveRef = useRef<LoadingButtonHandle>(null);
  const [domain, setDomain] = useState("");
  const [error, setError] = useState<unknown>(null);
  const create = useWorkOsMutation({
    mutationFn: (sdk, name: string) =>
      sdk.CreateOrganizationDomain({ domain: name }),
  });

  return (
    <SettingsDialogShell
      description="Verify a domain so people with that email can sign in with password or SSO."
      onOpenChange={onOpenChange}
      open
      title="Add domain"
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          saveRef.current?.run();
        }}
      >
        <InlineValidation
          ref={domainRef}
          hint="Used for email login and SSO, not your website."
          id="organization-domain"
          label="Domain name"
          name="domain"
          onChange={setDomain}
          placeholder="example.com"
          validate={validateRequired("Enter a domain.")}
          value={domain}
        />
        {error ? <SettingsError error={error} /> : null}
        <div className="flex justify-end gap-2">
          <Button
            onClick={() => onOpenChange(false)}
            type="button"
            variant="secondary"
          >
            Cancel
          </Button>
          <LoadingButton
            ref={saveRef}
            onAction={async () => {
              if (!domainRef.current?.commit()) {
                throw new AsyncActionAbortError();
              }
              setError(null);
              const data = await create.mutateAsync(domain.trim());
              onAdded(data.createOrganizationDomain);
            }}
            onError={setError}
            pendingLabel="Adding…"
            successLabel="Added"
            type="submit"
          >
            Add domain
          </LoadingButton>
        </div>
      </form>
    </SettingsDialogShell>
  );
}

function DomainsSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <SettingsRows>
        <SettingsRowSkeleton
          action={<SkeletonButton width={32} />}
          description={88}
          label={140}
          leading={<SkeletonTile />}
        />
        <SettingsRowSkeleton
          action={<SkeletonButton width={32} />}
          description={88}
          label={120}
          leading={<SkeletonTile />}
        />
      </SettingsRows>
      <div>
        <SkeletonButton width={104} />
      </div>
    </div>
  );
}

export function DomainsPanel() {
  const queryClient = useQueryClient();
  const query = useWorkOsQuery({
    queryKey: workOsKey("ListOrganizationDomains"),
    queryFn: listDomains,
  });
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: workOsKey("ListOrganizationDomains"),
    });
  const reverify = useWorkOsMutation({
    mutationFn: (sdk, id: string) => sdk.ReverifyOrganizationDomain({ id }),
    onSuccess: invalidate,
  });
  const remove = useWorkOsMutation({
    mutationFn: (sdk, id: string) => sdk.DeleteOrganizationDomain({ id }),
    onSuccess: invalidate,
  });
  const [adding, setAdding] = useState(false);
  const [dnsDomain, setDnsDomain] = useState<Domain | null>(null);
  const [removing, setRemoving] = useState<Domain | null>(null);

  if (query.isError) return <SettingsError error={query.error} />;

  return (
    <SettingsReveal data={query.data} skeleton={<DomainsSkeleton />}>
      {(data) => {
        const domains = data;
        const addButton = (
          <Button
            onClick={() => setAdding(true)}
            type="button"
            variant="secondary"
          >
            Add domain
          </Button>
        );

        return (
          <div className="flex flex-col gap-4">
            {domains.length === 0 ? (
              <SettingsRows>
                <SettingsRow label="You haven't added any verified domains yet.">
                  {addButton}
                </SettingsRow>
              </SettingsRows>
            ) : (
              <>
                <SettingsRows>
                  {domains.map((domain) => {
                    const status = domainStatus(domain);
                    return (
                      <SettingsRow
                        description={`Added ${formatRelative(domain.createdAt)}`}
                        key={domain.id}
                        label={domain.domain}
                        leading={
                          <SettingsProviderIcon
                            fallback={<Globe />}
                            slug={NAME_SERVER_SLUG[domain.nameServer]}
                          />
                        }
                      >
                        <SettingsStatus state={status.state}>
                          {status.label}
                        </SettingsStatus>
                        <SettingsRowMenu
                          actions={[
                            ...(isVerified(domain)
                              ? []
                              : [
                                  {
                                    label:
                                      domain.state === "Failed"
                                        ? "Restart verification"
                                        : "View DNS record",
                                    onSelect: () => setDnsDomain(domain),
                                  },
                                ]),
                            {
                              label: "Remove domain",
                              onSelect: () => setRemoving(domain),
                            },
                          ]}
                          label={`Actions for ${domain.domain}`}
                        />
                      </SettingsRow>
                    );
                  })}
                </SettingsRows>
                <div>{addButton}</div>
              </>
            )}

            {adding ? (
              <AddDomainDialog
                onAdded={(domain) => {
                  void invalidate();
                  setAdding(false);
                  setDnsDomain(domain);
                }}
                onOpenChange={setAdding}
              />
            ) : null}
            {dnsDomain ? (
              <DnsRecordDialog
                domain={dnsDomain}
                onOpenChange={(open) => {
                  if (!open) setDnsDomain(null);
                }}
                onRestart={() => reverify.mutateAsync(dnsDomain.id)}
              />
            ) : null}
            {removing ? (
              <SettingsConfirmDialog
                confirmLabel="Remove domain"
                description={removeMessage(removing)}
                onConfirm={() => remove.mutateAsync(removing.id)}
                onOpenChange={(open) => {
                  if (!open) setRemoving(null);
                }}
                open
                pendingLabel="Removing…"
                successLabel="Removed"
                title="Remove domain"
              />
            ) : null}
          </div>
        );
      }}
    </SettingsReveal>
  );
}
