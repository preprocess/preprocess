import { describe, expect, it } from "vitest";

import { MARKER, parseBuild } from "../src/result.ts";

describe("parseBuild", () => {
  const bundle = { mainModule: "agent.js", modules: { "agent.js": "x" } };

  it("splits the log from the bundle", () => {
    expect(
      parseBuild(0, `installed${MARKER}${JSON.stringify(bundle)}`),
    ).toEqual({
      status: "succeeded",
      log: "installed",
      bundle,
    });
  });

  it("reads timeout's exit codes as a timed-out build", () => {
    expect(parseBuild(124, "slow").status).toBe("timed_out");
    expect(parseBuild(137, "slow").status).toBe("timed_out");
  });

  it("fails without the marker or with another exit code", () => {
    expect(parseBuild(0, "no bundle").status).toBe("failed");
    expect(parseBuild(1, `x${MARKER}{}`).status).toBe("failed");
  });
});
