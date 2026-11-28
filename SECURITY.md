# Security policy

## Reporting a vulnerability

Please report security issues privately, never in a public issue, pull request
or discussion.

- **GitHub:** open a private report from the
  [Security tab](https://github.com/preprocess/preprocess/security/advisories/new)
  of this repository.
- **Email:** security@preprocess.com.

Include what you found, the version or commit you tested, steps to reproduce,
and the impact you expect. A proof of concept helps. Please don't access, change
or delete data that isn't yours, and don't run tests that degrade service for
other customers of Preprocess Cloud.

## What happens next

1. We acknowledge your report within 3 business days.
2. We confirm the issue, assess its severity and keep you updated while we work
   on a fix.
3. We release the fix, then publish a
   [security advisory](https://github.com/preprocess/preprocess/security/advisories)
   describing the issue, the affected versions and the version that fixes it. We
   credit you in the advisory unless you ask us not to.

We ask that you give us 90 days from your report, or until the fix is released
if that comes sooner, before disclosing the issue publicly. If we need longer,
we'll tell you why and agree a date with you.

## Supported versions

Preprocess Cloud is always on the latest version. For self-hosted installs, we
fix security issues in the latest release only, so upgrade to receive fixes;
each release's upgrade notes say what changed. Advisories name the first release
that contains the fix.

## Scope

This policy covers the code in this repository (the app, API, runtime, docs, SDK
and CLI) and Preprocess Cloud. Issues in a dependency should go to that project,
though we're glad to hear about any that affect Preprocess.

For which hosts a self-hosted install contacts, see
[Outbound hostnames](https://docs.preprocess.com/deploy-and-operate/outbound-hostnames).
