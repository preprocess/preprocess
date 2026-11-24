import { Button } from "@preprocess/ui/components/button";
import { IconArrowUp } from "@tabler/icons-react";

export type SendButtonProps = {
  state: "idle" | "typing" | "streaming";
};

export function SendButton({ state }: SendButtonProps) {
  const isStreaming = state === "streaming";
  const isTyping = state === "typing";

  return (
    <Button
      type="button"
      variant={isStreaming ? "primary" : "secondary"}
      size="icon-compact"
      className="pointer-events-none size-7 [&_svg]:size-4"
      disabled={!isStreaming && !isTyping}
      tabIndex={-1}
      aria-hidden
    >
      {isStreaming ? (
        <span className="block size-3 rounded-none bg-current" />
      ) : (
        <IconArrowUp />
      )}
    </Button>
  );
}
