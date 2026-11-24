import type { BuildResult } from "./types.ts";

export const MARKER = "\n::preprocess-bundle::\n";

// build.sh prints its log, then the marker and the bundle. `timeout` exits
// 124, or 137 when it had to kill.
export const parseBuild = (exitCode: number, output: string): BuildResult => {
  const at = output.lastIndexOf(MARKER);
  if (exitCode === 124 || exitCode === 137)
    return { status: "timed_out", log: output };
  if (exitCode !== 0 || at < 0) return { status: "failed", log: output };
  return {
    status: "succeeded",
    log: output.slice(0, at),
    bundle: JSON.parse(output.slice(at + MARKER.length)) as {
      mainModule: string;
      modules: Record<string, string>;
    },
  };
};
