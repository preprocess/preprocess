"use client";

import { Button } from "@preprocess/ui/components/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { useState } from "react";

import { currentScenario } from "./current-scenario";
import {
  SCENARIO_COOKIE_NAME,
  SCENARIO_SURFACES,
  SCENARIO_SURFACE_IDS,
  isScenarioState,
  serializeScenario,
  withScenarioState,
  type ScenarioSelection,
  type ScenarioSurface,
} from "./scenarios";

/**
 * Development-only switcher for seeded surface states, bottom right so it
 * clears the sidebar's account footer. Seeded stores live in
 * both the server and the browser, so a change reloads the page.
 */
export function ScenarioToolbar() {
  const [open, setOpen] = useState(false);
  const [selection] = useState(() => currentScenario());
  const changed = serializeScenario(selection);

  function apply(next: ScenarioSelection) {
    const value = serializeScenario(next);
    document.cookie = value
      ? `${SCENARIO_COOKIE_NAME}=${encodeURIComponent(value)}; path=/; samesite=lax`
      : `${SCENARIO_COOKIE_NAME}=; path=/; max-age=0`;
    window.location.reload();
  }

  function select(surface: ScenarioSurface, state: string) {
    if (!isScenarioState(surface, state)) return;
    apply(withScenarioState(selection, surface, state));
  }

  function reset() {
    const here = window.location.pathname + window.location.search;
    window.location.assign(
      `/api/dev/scenario?reset=1&return=${encodeURIComponent(here)}`,
    );
  }

  return (
    <div
      className="fixed right-3 bottom-3 z-50 flex flex-col items-end gap-2"
      data-testid="scenario-toolbar"
    >
      {open ? (
        <div
          aria-label="Scenario states"
          className="flex w-64 flex-col gap-3 rounded-xl border border-border bg-background p-3 shadow-lg"
          role="group"
        >
          {SCENARIO_SURFACE_IDS.map((surface) => (
            <div className="flex flex-col gap-1" key={surface}>
              <span className="text-muted-foreground">
                {SCENARIO_SURFACES[surface].label}
              </span>
              <Select
                onValueChange={(state) => select(surface, state)}
                size="compact"
                value={selection[surface]}
              >
                <SelectTrigger
                  aria-label={SCENARIO_SURFACES[surface].label}
                  className="w-full"
                />
                <SelectContent>
                  {SCENARIO_SURFACES[surface].states.map((state, index) => (
                    <SelectItem index={index} key={state} value={state}>
                      {state}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <Button onClick={reset} size="compact" variant="secondary">
            Reset seed
          </Button>
        </div>
      ) : null}
      <Button
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        size="compact"
        variant={changed ? "primary" : "secondary"}
      >
        {changed ? `States · ${changed}` : "States"}
      </Button>
    </div>
  );
}
