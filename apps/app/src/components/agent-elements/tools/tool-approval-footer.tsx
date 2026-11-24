import { Button } from "@preprocess/ui/components/button";
import { memo, useMemo, useState } from "react";

export type ToolApproval = {
  approveLabel?: string;
  rejectLabel?: string;
  onApprove?: () => void;
  onReject?: () => void;
};

export type ToolApprovalFooterProps = ToolApproval & {
  isPending?: boolean;
};

export const ToolApprovalFooter = memo(function ToolApprovalFooter({
  isPending,
  approveLabel,
  rejectLabel,
  onApprove,
  onReject,
}: ToolApprovalFooterProps) {
  const [decision, setDecision] = useState<"approved" | "rejected" | null>(
    null,
  );

  const approveText =
    decision === "approved" ? "Approved" : (approveLabel ?? "Next");
  const rejectText =
    decision === "rejected" ? "Skipped" : (rejectLabel ?? "Skip");

  const handleApprove = () => {
    if (decision) return;
    setDecision("approved");
    onApprove?.();
  };

  const handleReject = () => {
    if (decision) return;
    setDecision("rejected");
    onReject?.();
  };

  const statusConfig = useMemo(() => {
    if (decision === "approved") return { label: "Waiting", dots: true };
    if (decision === "rejected") return { label: "Canceled", dots: false };
    if (isPending) return { label: "Starting", dots: true };
    // Default "ready" state — buttons themselves communicate the affordance,
    // an extra "Ready" label just adds noise. Render an empty spacer so the
    // buttons stay right-aligned via justify-between.
    return null;
  }, [decision, isPending]);

  return (
    <div className="flex items-center justify-between py-1 pl-3 pr-2 border-t border-border bg-an-tool-background">
      {statusConfig ? (
        <span className="text-caption text-an-tool-color-muted">
          {statusConfig.label}
          {statusConfig.dots && (
            <span className="inline-flex" aria-hidden="true">
              <span className="text-an-tool-color-muted animate-[loading-dots_1.4s_infinite_0.2s]">
                .
              </span>
              <span className="text-an-tool-color-muted animate-[loading-dots_1.4s_infinite_0.4s]">
                .
              </span>
              <span className="text-an-tool-color-muted animate-[loading-dots_1.4s_infinite_0.6s]">
                .
              </span>
            </span>
          )}
        </span>
      ) : (
        <span aria-hidden="true" />
      )}
      <div className="flex gap-1">
        <Button
          type="button"
          variant="ghost"
          size="compact"
          onClick={handleReject}
          disabled={Boolean(decision)}
          className="h-5 px-1.5 text-caption hover:text-an-tool-color disabled:opacity-60"
        >
          {rejectText}
        </Button>
        <Button
          type="button"
          variant="primary"
          size="compact"
          onClick={handleApprove}
          disabled={Boolean(decision)}
          className="h-5 px-1.5 text-caption font-medium disabled:opacity-60"
        >
          {approveText}
        </Button>
      </div>
    </div>
  );
});
