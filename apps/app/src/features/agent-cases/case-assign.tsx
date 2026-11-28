import { Button } from "@preprocess/ui/components/button";
import {
  Combobox,
  ComboboxChips,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
} from "@preprocess/ui/components/combobox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@preprocess/ui/components/dialog";
import { LoadingButton } from "@preprocess/ui/components/loading-button";
import { User } from "@preprocess/ui/lib/icons";
import { useEffect, useState } from "react";

import type { AssigneeCandidate } from "./case-api";
import type { Case } from "./case";

/**
 * Owners and Admins set who a case is assigned to. The candidates are the
 * people who can see the case; the API refuses anyone else.
 */
export function AssignCaseButton({
  item,
  candidates,
  onSave,
}: Readonly<{
  item: Case;
  candidates: (item: Case) => Promise<readonly AssigneeCandidate[]>;
  onSave: (ids: readonly string[]) => Promise<unknown>;
}>) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<readonly AssigneeCandidate[] | null>(
    null,
  );
  const [chosen, setChosen] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!open) return;
    let current = true;
    setPeople(null);
    setError(null);
    candidates(item).then(
      (found) => {
        if (!current) return;
        setPeople(found);
        const emails = new Set(item.assignees.map((a) => a.email));
        setChosen(
          found.filter((person) => emails.has(person.email)).map((p) => p.id),
        );
      },
      () => {
        if (current)
          setError("Could not load the people who can see this case.");
      },
    );
    return () => {
      current = false;
    };
  }, [open, item, candidates]);

  async function save() {
    setError(null);
    try {
      await onSave(chosen);
      setOpen(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save. Try again.",
      );
      throw cause;
    }
  }

  return (
    <>
      <Button
        aria-label="Assign"
        className="@max-[941px]/case-room:w-7 @max-[941px]/case-room:px-0"
        leadingIcon={User}
        onClick={() => setOpen(true)}
        size="compact"
        type="button"
        variant="ghost"
      >
        <span className="@max-[941px]/case-room:sr-only">Assign</span>
      </Button>
      <Dialog
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
        open={open}
      >
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>Assign case</DialogTitle>
            <DialogDescription>
              Only people who can see this case are listed. Each new assignee
              gets an inbox notification.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <Combobox
              disabled={people === null || pending}
              hideSelected
              items={(people ?? []).map((person) => ({
                value: person.id,
                label: person.name,
              }))}
              multiple
              onValueChange={setChosen}
              value={chosen}
            >
              <ComboboxChips
                aria-label="Assignees"
                autoFocus
                placeholder={people === null ? "Loading people…" : "Add people"}
              />
              <ComboboxContent>
                <ComboboxEmpty allSelected="Everyone is assigned.">
                  No one matches.
                </ComboboxEmpty>
                <ComboboxList>
                  {(entry) =>
                    typeof entry === "string" ? null : (
                      <ComboboxItem key={entry.value} value={entry.value}>
                        {entry.label}
                      </ComboboxItem>
                    )
                  }
                </ComboboxList>
              </ComboboxContent>
            </Combobox>
            {error ? (
              <p className="text-body text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                disabled={pending}
                onClick={() => setOpen(false)}
                type="button"
                variant="secondary"
              >
                Cancel
              </Button>
              <LoadingButton
                disabled={people === null}
                errorLabel="Try again"
                onAction={save}
                onStatusChange={(status) => setPending(status === "pending")}
                pendingLabel="Saving…"
                successLabel="Saved"
              >
                Save
              </LoadingButton>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
