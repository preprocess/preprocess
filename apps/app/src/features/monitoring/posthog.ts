import { createServerFn } from "@tanstack/react-start";
import type { CaptureResult, PostHog } from "posthog-js";

// Browser errors and product analytics in PostHog (spec 12 and 15): on our
// production and staging, which bind POSTHOG_KEY, and on a self-hosted
// install only when it points at its own PostHog. Without a key nothing
// loads.
//
// Privacy: no autocapture or surveys. Session replay records layout and
// clicks only: every input and all text are masked, element attributes too,
// network requests are not recorded (bodies, headers or timings), and the case
// room, document panes and other customer content carry REPLAY_BLOCK, which
// replay leaves out entirely. URLs lose their query and hash, which can hold
// search terms. People are identified by user id only, never by email or
// name, and their organization is the `organization` group.
//
// Storage: PostHog keeps its state in page memory only, so it writes no
// cookie and nothing to local or session storage. A full page load starts a
// new session (and a new replay); the person is identified again on every
// load. State an earlier version stored is removed on start.
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

const forgetStoredState = () => {
  try {
    for (const store of [localStorage, sessionStorage])
      for (const key of Object.keys(store))
        if (key.startsWith("ph_") || key.startsWith("__ph"))
          store.removeItem(key);
    const host = location.hostname.split(".");
    for (const cookie of document.cookie.split("; ")) {
      const name = cookie.split("=")[0] ?? "";
      if (!name.startsWith("ph_")) continue;
      document.cookie = `${name}=; Max-Age=0; Path=/`;
      for (let i = 0; i < host.length - 1; i++)
        document.cookie = `${name}=; Max-Age=0; Path=/; Domain=.${host.slice(i).join(".")}`;
    }
  } catch {
    // Storage the browser blocks holds nothing of ours either.
  }
};

let started: Promise<PostHog> | undefined;

export const startMonitoring = (
  monitoring: Monitoring,
  person: { userId: string; organizationId: string | null } | null,
) => {
  if (!monitoring || typeof window === "undefined") return;
  started ??= import("posthog-js").then(({ default: posthog }) => {
    forgetStoredState();
    posthog.init(monitoring.key, {
      persistence: "memory",
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
      capture_performance: false,
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
    if (person.organizationId)
      posthog.group("organization", person.organizationId);
    else posthog.resetGroups();
  });
};
