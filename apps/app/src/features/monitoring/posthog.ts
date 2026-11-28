import { createServerFn } from "@tanstack/react-start";
import type { ProductEventName, ProductProperties } from "@preprocess/logs";
import type { CaptureResult, PostHog } from "posthog-js";

// Browser errors and product analytics in PostHog (spec 12 and 15): on our
// production and staging, which bind POSTHOG_KEY, and on a self-hosted
// install only when it points at its own PostHog. Without a key nothing
// loads.
//
// Privacy: no autocapture or surveys. Page performance is the four web
// vitals (LCP, INP, CLS, FCP) without attribution, which would name page
// elements and resource URLs; no network timing and no console logs. Session replay records layout and
// clicks only: every input and all text are masked, element attributes too,
// network requests are not recorded (bodies, headers or timings), and the case
// room, document panes and other customer content carry REPLAY_BLOCK, which
// replay leaves out entirely. URLs lose their query and hash, which can hold
// search terms, including the URLs inside each web vital. People are identified by user id only, never by email or
// name, and their organization is the `organization` group.
export type Monitoring = { key: string; host: string } | null;

// The share of sessions replay records: all of them until launch.
export const REPLAY_SAMPLE_RATE = 1;

// The class that keeps an element and everything in it out of replay.
export const REPLAY_BLOCK = "ph-no-capture";

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

// $web_vitals carries each metric as $web_vitals_<metric>_event, with the
// page's URL again inside.
const WEB_VITAL = /^\$web_vitals_[A-Z]+_event$/;

export const scrubEvent = (
  event: CaptureResult | null,
): CaptureResult | null => {
  if (!event) return null;
  const properties = { ...event.properties };
  for (const name of URL_PROPERTIES)
    if (name in properties) properties[name] = withoutQuery(properties[name]);
  for (const [name, metric] of Object.entries(properties))
    if (WEB_VITAL.test(name) && metric && typeof metric === "object") {
      const { $current_url, navigationURL, ...rest } = metric as Record<
        string,
        unknown
      >;
      properties[name] = {
        ...rest,
        ...($current_url !== undefined && {
          $current_url: withoutQuery($current_url),
        }),
        ...(navigationURL !== undefined && {
          navigationURL: withoutQuery(navigationURL),
        }),
      };
    }
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
// PostHog once it knows the person and their organization, so every
// product event carries the organization group.
let identified: Promise<PostHog> | undefined;
// Events captured before that, such as a page's first view, which renders
// before the root starts monitoring. Dropped without a PostHog key.
const pending: [ProductEventName, Record<string, unknown>][] = [];

// A product event the browser sends: only feature_viewed, named in the
// registry in @preprocess/logs (product.ts) like the server's.
export const captureProductEvent = <N extends ProductEventName>(
  name: N,
  properties: ProductProperties<N>,
) => {
  if (typeof window === "undefined") return;
  if (identified)
    void identified.then((posthog) => posthog.capture(name, properties));
  else if (pending.length < 20) pending.push([name, properties]);
};

export const startMonitoring = (
  monitoring: Monitoring,
  person: { userId: string; organizationId: string | null } | null,
) => {
  if (!monitoring || typeof window === "undefined") {
    pending.length = 0;
    return;
  }
  started ??= import("posthog-js").then(({ default: posthog }) => {
    posthog.init(monitoring.key, {
      api_host: monitoring.host,
      capture_exceptions: true,
      capture_pageview: "history_change",
      capture_pageleave: true,
      autocapture: false,
      disable_session_recording: false,
      session_recording: {
        sampleRate: REPLAY_SAMPLE_RATE,
        maskAllInputs: true,
        maskTextSelector: "*",
        maskAllElementAttributes: true,
        blockClass: REPLAY_BLOCK,
        recordHeaders: false,
        recordBody: false,
      },
      enable_recording_console_log: false,
      capture_performance: {
        web_vitals: true,
        web_vitals_allowed_metrics: ["LCP", "INP", "CLS", "FCP"],
        web_vitals_attribution: false,
        network_timing: false,
      },
      mask_all_text: true,
      mask_all_element_attributes: true,
      person_profiles: "identified_only",
      disable_surveys: true,
      before_send: scrubEvent,
    });
    return posthog;
  });
  identified = started.then((posthog) => {
    if (!person) {
      if (posthog.get_property("$user_state") === "identified") posthog.reset();
      return posthog;
    }
    posthog.identify(person.userId);
    posthog.register({ organizationId: person.organizationId });
    if (person.organizationId)
      posthog.group("organization", person.organizationId);
    else posthog.resetGroups();
    return posthog;
  });
  for (const [name, properties] of pending.splice(0))
    void identified.then((posthog) => posthog.capture(name, properties));
};
