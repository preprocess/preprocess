import { Button } from "@preprocess/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@preprocess/ui/components/dialog";
import { Label } from "@preprocess/ui/components/label";
import {
  AsyncActionAbortError,
  LoadingButton,
  type LoadingButtonHandle,
} from "@preprocess/ui/components/loading-button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@preprocess/ui/components/select";
import { useInlineValidation } from "@preprocess/ui/hooks/use-inline-validation";
import { FileIcon, Plus, XIcon } from "@preprocess/ui/lib/icons";
import { cn } from "@preprocess/ui/lib/utils";
import { useNavigate } from "@tanstack/react-router";
import { useId, useRef, useState, type FormEvent } from "react";

import { startCase } from "./list-org-cases";

const sizeFormat = new Intl.NumberFormat("en", {
  notation: "compact",
  style: "unit",
  unit: "byte",
  unitDisplay: "narrow",
});

/** Files are at most 100 MB, as the API takes them. */
const MAX_FILE_BYTES = 100 * 1024 * 1024;

function StartCaseDialog({
  agents,
  agentId,
  open,
  onOpenChange,
}: Readonly<{
  agents: readonly string[];
  agentId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}>) {
  const navigate = useNavigate();
  const startRef = useRef<LoadingButtonHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textId = useId();
  const [agent, setAgent] = useState(agentId ?? agents[0] ?? "");
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const input = useInlineValidation({
    value: text,
    validate: (value) =>
      value.trim() || files.length > 0
        ? null
        : "Add text, a file, or both to start the case.",
  });

  const reset = () => {
    setAgent(agentId ?? agents[0] ?? "");
    setText("");
    setFiles([]);
    setError(null);
    input.reset();
  };

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startRef.current?.run();
  }

  async function onStart() {
    setError(null);
    input.commit();
    if (!text.trim() && files.length === 0) throw new AsyncActionAbortError();
    const tooLarge = files.find((file) => file.size > MAX_FILE_BYTES);
    if (tooLarge) {
      setError(`${tooLarge.name} is over 100 MB, the most a file can be.`);
      throw new AsyncActionAbortError();
    }
    try {
      const started = await startCase({ agentId: agent, text, files });
      onOpenChange(false);
      reset();
      await navigate({
        to: "/agents/$agentId/cases/$caseId",
        params: { agentId: started.agentId, caseId: started.caseId },
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not start the case. Try again.",
      );
      throw cause;
    }
  }

  return (
    <Dialog
      onOpenChange={(next) => {
        if (pending) return;
        if (!next) reset();
        onOpenChange(next);
      }}
      open={open}
    >
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>Add case</DialogTitle>
          <DialogDescription>
            Start a case by hand with text, files, or both. The agent picks it
            up right away.
          </DialogDescription>
        </DialogHeader>
        <form className="flex flex-col gap-4" onSubmit={onSubmit}>
          <div className="flex flex-col gap-1.5">
            <Label>Agent</Label>
            <Select disabled={pending} onValueChange={setAgent} value={agent}>
              <SelectTrigger aria-label="Agent" placeholder="Pick an agent" />
              <SelectContent>
                {agents.map((slug, index) => (
                  <SelectItem index={index} key={slug} value={slug}>
                    {slug}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={textId}>Text</Label>
            <textarea
              aria-describedby={`${textId}-message`}
              aria-invalid={input.error ? true : undefined}
              autoFocus
              className="min-h-28 w-full resize-y rounded-xl border border-input bg-transparent px-2.5 py-2 text-body outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20"
              disabled={pending}
              id={textId}
              onChange={(event) => setText(event.target.value)}
              placeholder="What should the agent work on?"
              value={text}
            />
            <span
              className={cn(
                "text-body",
                input.error ? "text-destructive" : "text-muted-foreground",
              )}
              id={`${textId}-message`}
              role={input.error ? "alert" : undefined}
            >
              {input.error ??
                "The agent reads this with the files. Either one is enough."}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label>Files</Label>
              <Button
                disabled={pending}
                leadingIcon={Plus}
                onClick={() => fileInputRef.current?.click()}
                size="compact"
                type="button"
                variant="ghost"
              >
                Add files
              </Button>
              <input
                aria-label="Files"
                className="hidden"
                multiple
                onChange={(event) => {
                  const picked = [...(event.target.files ?? [])];
                  event.target.value = "";
                  if (picked.length === 0) return;
                  setFiles((current) => [...current, ...picked]);
                  if (input.touched) input.reset();
                }}
                ref={fileInputRef}
                type="file"
              />
            </div>
            {files.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {files.map((file, index) => (
                  <li
                    className="flex items-center gap-2 text-body"
                    key={`${file.name}-${index}`}
                  >
                    <FileIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground"
                    />
                    <span className="min-w-0 flex-1 truncate text-foreground">
                      {file.name}
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">
                      {sizeFormat.format(file.size)}
                    </span>
                    <Button
                      aria-label={`Remove ${file.name}`}
                      disabled={pending}
                      onClick={() =>
                        setFiles((current) =>
                          current.filter((_, at) => at !== index),
                        )
                      }
                      size="icon-compact"
                      type="button"
                      variant="ghost"
                    >
                      <XIcon aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-body text-muted-foreground">
                No files added.
              </span>
            )}
          </div>
          {error ? (
            <p className="text-body text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              disabled={pending}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="secondary"
            >
              Cancel
            </Button>
            <LoadingButton
              errorLabel="Try again"
              onAction={onStart}
              onStatusChange={(status) => setPending(status === "pending")}
              pendingLabel={files.length > 0 ? "Uploading…" : "Starting…"}
              ref={startRef}
              successLabel="Started"
              type="submit"
            >
              Start case
            </LoadingButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Starts a case by hand. Shows only to people who can work cases: inside an
 * agent, its operators; elsewhere, anyone who operates an agent.
 */
export function AddCaseButton({
  agents,
  agentId,
}: Readonly<{
  /** The agents the person may start cases for. */
  agents: readonly string[];
  /** Preselects this agent; the button hides unless the person operates it. */
  agentId?: string;
}>) {
  const [open, setOpen] = useState(false);
  if (agentId ? !agents.includes(agentId) : agents.length === 0) return null;
  return (
    <>
      <Button
        leadingIcon={Plus}
        onClick={() => setOpen(true)}
        size="compact"
        type="button"
        variant="primary"
      >
        Add case
      </Button>
      <StartCaseDialog
        agentId={agentId}
        agents={agents}
        onOpenChange={setOpen}
        open={open}
      />
    </>
  );
}
