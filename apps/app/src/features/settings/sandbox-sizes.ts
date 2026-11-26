// Case sandbox sizes (spec 3) as the dashboard shows them, with the Cloudflare
// instance type each runs on.

import { SANDBOX_SIZES, type SandboxSize } from "@preprocess/sdk/protocol";

const LABELS: Record<SandboxSize, string> = {
  small: "Small: ½ vCPU, 4 GiB, 8 GB disk",
  medium: "Medium: 1 vCPU, 6 GiB, 12 GB disk",
  large: "Large: 4 vCPU, 12 GiB, 20 GB disk",
};

export const SANDBOX_SIZE_OPTIONS = SANDBOX_SIZES.map((size) => ({
  value: size,
  label: LABELS[size],
}));
