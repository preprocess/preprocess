function Illustration({
  height,
  src,
  width,
}: Readonly<{ height: number; src: string; width: number }>) {
  const mask = `url(${src}) center / contain no-repeat`;
  return (
    <div
      aria-hidden="true"
      className="h-44 max-w-60 bg-foreground"
      style={{ aspectRatio: `${width} / ${height}`, mask, WebkitMask: mask }}
    />
  );
}

export const InboxEmptyArt = () => (
  <Illustration height={325} src="/empty/inbox-empty.webp" width={480} />
);

export const InboxCaughtUpArt = () => (
  <Illustration height={482} src="/empty/inbox-caught-up.webp" width={480} />
);

export const InboxPickArt = () => (
  <Illustration height={306} src="/empty/inbox-pick.webp" width={480} />
);

export const CasesEmptyArt = () => (
  <Illustration height={373} src="/empty/cases-empty.webp" width={480} />
);

export const NoMatchArt = () => (
  <Illustration height={386} src="/empty/no-match.webp" width={480} />
);

export const AgentsEmptyArt = () => (
  <Illustration height={751} src="/empty/agents-empty.webp" width={480} />
);

export const CaseInputArt = () => (
  <Illustration height={279} src="/empty/case-input.webp" width={480} />
);

export const CaseReviewArt = () => (
  <Illustration height={620} src="/empty/case-review.webp" width={480} />
);

export const CaseRunArt = () => (
  <Illustration height={580} src="/empty/case-run.webp" width={480} />
);

export const ChatEmptyArt = () => (
  <Illustration height={483} src="/empty/chat-empty.webp" width={480} />
);
