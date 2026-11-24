import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";

import {
  SCENARIO_COOKIE_NAME,
  UNSEEDED_SCENARIO,
  parseScenario,
  readCookie,
  type ScenarioSelection,
} from "./scenarios";

/**
 * The active scenario, read from the cookie on the server render and in the
 * browser alike, since the seeded data functions run in both. Builds outside
 * dev always get the unseeded selection.
 */
export const currentScenario = createIsomorphicFn()
  .server((): ScenarioSelection => {
    if (!import.meta.env.DEV) return UNSEEDED_SCENARIO;
    return parseScenario(getCookie(SCENARIO_COOKIE_NAME));
  })
  .client((): ScenarioSelection => {
    if (!import.meta.env.DEV) return UNSEEDED_SCENARIO;
    return parseScenario(readCookie(document.cookie, SCENARIO_COOKIE_NAME));
  });
