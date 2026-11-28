import { createServerFn } from "@tanstack/react-start";
import type { CaptureResult, PostHog } from "posthog-js";

// Browser errors and product analytics in PostHog (spec 12 and 15): on our
// production and staging, which bind POSTHOG_KEY, and on a self-hosted
// install only when it points at its own PostHog. Without a key nothing
// loads.
//
// Privacy: no autocapture, surveys or session recording, so no element text,
// input or case content is collected; text and attributes stay masked in
// case either is turned on later. URLs lose their query and hash, which can
// hold search terms. People are identified by user id only, never by email
// or name.
export type Monitoring = { key: string; host: string } | null;

export const loadMonitoring = createServerFn({ method: "GET" }).handler(
  async (): Promise<Monitoring> => {
    const { posthogBrowser } = await import("../../server/run-mode.server");
    return posthogBrowser();
  },
);

const URL_PROPERTIES = [
  "$current_url",
  "$pathname",
  "$referrer",
  "$prev_pageview_pathname",
  "$initial_current_url",
  "$initial_referrer",
];

const withoutQuery = (value: unknown) =>
  typeof value === "string" ? value.replace(/[?#].*$/, "") : value;

export const scrubEvent = (
  event: CaptureResult | null,
): CaptureResult | null => {
  if (!event) return null;
  const properties = { ...event.properties };
  for (const name of URL_PROPERTIES)
    if (name in properties) properties[name] = withoutQuery(properties[name]);
  const exceptions = properties.$exception_list as
    { value?: unknown }[] | undefined;
  if (exceptions)
    properties.$exception_list = exceptions.map((exception) => ({
      ...exception,
      ...(typeof exception.value === "string" && {
        value: exception.value.slice(0, 300),
      }),
    }));
  return { ...event, properties };
};

let started: Promise<PostHog> | undefined;

export const startMonitoring = (
  monitoring: Monitoring,
  person: { userId: string; organizationId: string | null } | null,
) => {
  if (!monitoring || typeof window === "undefined") return;
  started ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(monitoring.key, {
      api_host: monitoring.host,
      capture_exceptions: true,
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: true,
      mask_all_text: true,
      mask_all_element_attributes: true,
      person_profiles: "identified_only",
      disable_surveys: true,
      before_send: scrubEvent,
    });
    return posthog;
  });
  void started.then((posthog) => {
    if (!person) {
      if (posthog.get_property("$user_state") === "identified") posthog.reset();
      return;
    }
    posthog.identify(person.userId);
    posthog.register({ organizationId: person.organizationId });
  });
};
