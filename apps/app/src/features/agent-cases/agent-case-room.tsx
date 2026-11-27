import { Button } from "@preprocess/ui/components/button";
import { EmptyPresenceLayer } from "@preprocess/ui/components/empty";
import { Tooltip } from "@preprocess/ui/components/tooltip";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
  type ResizablePanelHandle,
} from "@preprocess/ui/components/resizable";
import {
  LayoutRightIcon,
  Megaphone,
  SidebarRightIcon,
  SplitViewIcon,
} from "@preprocess/ui/lib/icons";
import { spring } from "@preprocess/ui/lib/springs";
import { cn } from "@preprocess/ui/lib/utils";
import { ScriptOnce } from "@tanstack/react-router";
import { animate, motion, type AnimationPlaybackControls } from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";

import type { AgentCaseRef } from "./agent-case-ref";
import type { Case, CaseStatus } from "./case";
import { CaseRoomChat } from "./case-room-chat";
import {
  CaseInputPane,
  CaseInputWorkspace,
  INPUT_TAB,
  type CaseFiles,
  useCaseFileTabs,
} from "./case-input-workspace";
import { CaseRoomViewEmpty, type CaseRoomEmptyViewId } from "./case-room-empty";
import {
  CHAT_VIEW,
  CaseRoomTabs,
  closeOpenTab,
  fileTabDragOf,
  isCaseFileTabDrag,
  isRoomViewId,
  moveFileBetweenPanes,
  ROOM_VIEWS,
  assignFilesToOtherPane,
  openFileInPane,
  openFileInPaneBackground,
  workspaceActiveIdOf,
} from "./case-room-tabs";
import { CaseRoomDetails, CaseRecordContext } from "./case-room-details";
import { CaseRoomHeader } from "./case-room-header";
import { CaseRoomReview, hasReview } from "./case-room-review";
import { CaseRoomRun } from "./case-room-run";
import type { CaseRoomState } from "./case-room-state";
import {
  CaseWorkContext,
  useCaseWork,
  type CaseWorkActions,
} from "./case-work-context";
import type { CaseNeighbors } from "./list-org-cases";
import type { CaseInputSample } from "./flue-lab-input-samples";
import { AgentSectionNav } from "../agents/agent-shell";
import type { OrgAgentDetail } from "../agents/list-org-agents";

export type AgentCaseRoomProps = {
  /** The agent the case belongs to; the room sits under its Cases section. */
  readonly agent: OrgAgentDetail;
  readonly caseRef: AgentCaseRef;
  /** The case record, or null when the list has no such case. */
  readonly caseItem: Case | null;
  readonly neighbors?: CaseNeighbors;
  readonly onStatusChange?: (status: CaseStatus) => Promise<unknown>;
  /** Setting the assignees, for Owners and Admins. */
  readonly assign?: ComponentProps<typeof CaseRoomHeader>["assign"];
  readonly inputSamples?: ReadonlyArray<CaseInputSample>;
  /** The case's attached files, and attaching more when the person may. */
  readonly caseFiles?: CaseFiles;
  /** Opens on the Review view instead of Input, as inbox links ask. */
  readonly initialView?: "review";
  /** The case's fields, answers, checks and thread, and what a person can do. */
  readonly work?: { room: CaseRoomState; actions: CaseWorkActions } | null;
};

const CHAT_PANEL_SIZE_STORAGE_KEY = "preprocess-agent-case-chat-panel-size";
const DEFAULT_CHAT_PANEL_SIZE = 520;
const MIN_CHAT_PANEL_SIZE = 320;
/** Room for the workspace's Input, Review and Run tabs and its pane buttons. */
const MIN_WORKSPACE_PANEL_SIZE = 400;

function readStoredChatPanelSize(): number {
  if (typeof window === "undefined") return DEFAULT_CHAT_PANEL_SIZE;

  try {
    const stored = Number(
      window.localStorage.getItem(CHAT_PANEL_SIZE_STORAGE_KEY),
    );
    return Number.isFinite(stored) && stored >= MIN_CHAT_PANEL_SIZE
      ? stored
      : DEFAULT_CHAT_PANEL_SIZE;
  } catch {
    return DEFAULT_CHAT_PANEL_SIZE;
  }
}

function storeChatPanelSize(size: number) {
  try {
    window.localStorage.setItem(
      CHAT_PANEL_SIZE_STORAGE_KEY,
      String(Math.round(size)),
    );
  } catch {
    // Storage may be unavailable in privacy-restricted browser contexts.
  }
}

function getInitialChatPanelLayoutScript(panelId: string) {
  const storageKey = JSON.stringify(CHAT_PANEL_SIZE_STORAGE_KEY);
  const encodedPanelId = JSON.stringify(panelId);

  return `(function(){try{var p=document.getElementById(${encodedPanelId});if(!p)return;var r=null;try{r=localStorage.getItem(${storageKey})}catch(e){}var n=Number(r);var s=r!==null&&Number.isFinite(n)&&n>=${MIN_CHAT_PANEL_SIZE}?n:${DEFAULT_CHAT_PANEL_SIZE};var g=p.parentElement;var w=g?g.getBoundingClientRect().width:0;var m=g?Math.max(Math.min(w*.7,w-${MIN_WORKSPACE_PANEL_SIZE}),0):s;s=Math.min(s,m);p.style.flexBasis=s+'px'}catch(e){}})();`;
}

type WorkspacePaneState = {
  readonly selectedId: string;
  readonly openIds: string[];
};

function CaseWorkspacePane({
  idPrefix,
  name,
  label,
  pane,
  focused,
  onFocus,
  onSelect,
  onCloseFile,
  onReorderFiles,
  onTransferFile,
  toolbar,
  chatSelected,
}: {
  readonly idPrefix: string;
  readonly name: "main" | "side";
  readonly label: string;
  readonly pane: WorkspacePaneState;
  readonly focused: boolean;
  readonly onFocus: () => void;
  readonly onSelect: (id: string) => void;
  readonly onCloseFile: (id: string) => void;
  readonly onReorderFiles: (ids: string[]) => void;
  readonly onTransferFile?: (
    id: string,
    from: "main" | "side",
    index: number,
  ) => void;
  readonly toolbar?: ReactNode;
  /** Set on the pane that carries the Chat tab, shown when the room is narrow. */
  readonly chatSelected?: boolean;
}) {
  const fileTabs = useCaseFileTabs(pane.openIds);
  const room = useCaseWork()?.room;
  const hasContent = (viewId: CaseRoomEmptyViewId) =>
    viewId === "review"
      ? room !== undefined && hasReview(room)
      : (room?.thread.length ?? 0) > 0;
  const emptyViewId =
    isRoomViewId(pane.selectedId) && pane.selectedId !== INPUT_TAB
      ? pane.selectedId
      : null;
  const visitedEmptyViewsRef = useRef<CaseRoomEmptyViewId[]>([]);
  if (emptyViewId && !visitedEmptyViewsRef.current.includes(emptyViewId)) {
    visitedEmptyViewsRef.current = [
      ...visitedEmptyViewsRef.current,
      emptyViewId,
    ];
  }

  return (
    <div
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface-2"
      data-focused={focused}
      data-pane={name}
      onDragOver={(event) => {
        if (!isCaseFileTabDrag(event) || !onTransferFile) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        const drag = fileTabDragOf(event);
        if (!drag || !onTransferFile) return;
        event.preventDefault();
        if (
          (drag.from !== "main" && drag.from !== "side") ||
          drag.from === name
        ) {
          return;
        }
        onTransferFile(drag.id, drag.from, pane.openIds.length);
      }}
      onFocus={onFocus}
      onPointerDown={onFocus}
    >
      <div className="flex shrink-0 items-center overflow-hidden px-1.5 py-2">
        <CaseRoomTabs
          fileTabs={fileTabs}
          idPrefix={idPrefix}
          label={label}
          onCloseFile={onCloseFile}
          onReorderFiles={onReorderFiles}
          onSelect={onSelect}
          onTransferFile={onTransferFile}
          paneName={name}
          selectedId={chatSelected ? CHAT_VIEW.id : pane.selectedId}
          toolbar={toolbar}
          views={
            chatSelected === undefined ? ROOM_VIEWS : [...ROOM_VIEWS, CHAT_VIEW]
          }
        />
      </div>
      <div
        aria-labelledby={
          emptyViewId ? `${idPrefix}-tab-${emptyViewId}` : undefined
        }
        className={cn(
          "relative flex min-h-0 flex-1 flex-col bg-surface-2 outline-none",
          chatSelected && "@max-[941px]/case-room:hidden",
        )}
        id={emptyViewId ? `${idPrefix}-panel-${emptyViewId}` : undefined}
        role={emptyViewId ? "tabpanel" : undefined}
      >
        {visitedEmptyViewsRef.current.map((viewId) => (
          <EmptyPresenceLayer
            active={viewId === emptyViewId && !hasContent(viewId)}
            key={viewId}
          >
            <CaseRoomViewEmpty viewId={viewId} />
          </EmptyPresenceLayer>
        ))}
        {emptyViewId && hasContent(emptyViewId) ? (
          <div className="absolute inset-0 flex flex-col">
            {emptyViewId === "review" ? <CaseRoomReview /> : <CaseRoomRun />}
          </div>
        ) : null}
        <div
          className={
            emptyViewId ? "hidden" : "flex min-h-0 min-w-0 flex-1 flex-col"
          }
        >
          <CaseInputPane
            id={workspaceActiveIdOf(pane.selectedId)}
            idPrefix={idPrefix}
          />
        </div>
      </div>
    </div>
  );
}

export function AgentCaseRoom({
  agent,
  caseRef,
  caseItem,
  neighbors,
  onStatusChange,
  assign,
  inputSamples,
  caseFiles,
  initialView,
  work = null,
}: AgentCaseRoomProps) {
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);
  const [isChatSelected, setIsChatSelected] = useState(false);
  const wasNarrowRef = useRef(false);
  const idPrefix = `agent-case-${caseRef.agentId}-${caseRef.caseId}`;
  const chatPanelId = `${idPrefix}-chat-panel`;
  const [isChatPanelOpen, setIsChatPanelOpen] = useState(true);
  const [isPanelAnimating, setIsPanelAnimating] = useState(false);
  const [main, setMain] = useState<WorkspacePaneState>({
    selectedId: initialView ?? INPUT_TAB,
    openIds: [],
  });
  const [side, setSide] = useState<WorkspacePaneState | null>(null);
  const [isSplit, setIsSplit] = useState(false);
  const [focusedPane, setFocusedPane] = useState<"main" | "side">("main");
  const chatPanelRef = useRef<ResizablePanelHandle>(null);
  const storedChatPanelSizeRef = useRef<number | null>(null);
  if (storedChatPanelSizeRef.current === null) {
    storedChatPanelSizeRef.current = readStoredChatPanelSize();
  }
  const lastChatPanelSizeRef = useRef(DEFAULT_CHAT_PANEL_SIZE);
  const [chatContentWidth, setChatContentWidth] = useState(
    () => storedChatPanelSizeRef.current ?? DEFAULT_CHAT_PANEL_SIZE,
  );
  const hasRestoredChatPanelSizeRef = useRef(false);
  const panelAnimationRef = useRef<AnimationPlaybackControls | null>(null);
  const isClosingRef = useRef(false);
  const isMountedRef = useRef(true);
  // 320 while open. 0 only during the button spring so resize() can pass the floor.
  const chatPanelMinSize =
    isChatPanelOpen && !isPanelAnimating ? MIN_CHAT_PANEL_SIZE : 0;
  // Lock inner width while collapsing/expanding so chat chrome doesn't scrunch.
  const lockChatContentWidth = !isChatPanelOpen || isPanelAnimating;

  const stopPanelAnimation = () => {
    panelAnimationRef.current?.stop();
    panelAnimationRef.current = null;
    isClosingRef.current = false;
    setIsPanelAnimating(false);
  };

  useLayoutEffect(() => {
    const storedSize = storedChatPanelSizeRef.current;
    if (storedSize !== null) {
      lastChatPanelSizeRef.current = storedSize;
      setChatContentWidth(storedSize);
      hasRestoredChatPanelSizeRef.current = true;
      chatPanelRef.current?.resize(storedSize);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      stopPanelAnimation();
    };
  }, []);

  const closeChatPanel = () => {
    const panel = chatPanelRef.current;
    if (!panel || !isChatPanelOpen || isClosingRef.current) return;
    isClosingRef.current = true;

    panelAnimationRef.current?.stop();
    panelAnimationRef.current = null;
    const from = panel.getSize().inPixels;
    if (from >= MIN_CHAT_PANEL_SIZE) {
      setChatContentWidth(from);
      lastChatPanelSizeRef.current = from;
      storeChatPanelSize(from);
    }

    flushSync(() => {
      setIsChatPanelOpen(false);
      setIsPanelAnimating(true);
    });
    panelAnimationRef.current = animate(from, 0, {
      ...spring.moderate,
      bounce: 0,
      onUpdate: (value) => {
        if (!isMountedRef.current) return;
        panel.resize(Math.max(0, value));
      },
      onComplete: () => {
        panelAnimationRef.current = null;
        isClosingRef.current = false;
        setIsPanelAnimating(false);
      },
    });
  };

  const toggleChatPanel = () => {
    const panel = chatPanelRef.current;
    if (!panel) return;

    if (isChatPanelOpen) {
      closeChatPanel();
      return;
    }

    stopPanelAnimation();
    const from = panel.getSize().inPixels;
    const to = Math.max(lastChatPanelSizeRef.current, MIN_CHAT_PANEL_SIZE);
    setChatContentWidth(to);

    flushSync(() => {
      setIsChatPanelOpen(true);
      setIsPanelAnimating(true);
    });
    panelAnimationRef.current = animate(from, to, {
      ...spring.moderate,
      onUpdate: (value) => {
        if (!isMountedRef.current) return;
        panel.resize(Math.max(0, value));
      },
      onComplete: () => {
        panelAnimationRef.current = null;
        setIsPanelAnimating(false);
      },
    });
  };

  const patchPane = (
    target: "main" | "side",
    patch: (current: WorkspacePaneState) => WorkspacePaneState,
  ) => {
    if (target === "main") {
      setMain(patch);
      return;
    }
    setSide((current) => (current ? patch(current) : current));
  };

  const selectTab = (target: "main" | "side", id: string) => {
    setFocusedPane(target);
    patchPane(target, (current) => ({ ...current, selectedId: id }));
  };

  const selectMainView = (id: string) => {
    if (id !== CHAT_VIEW.id) {
      setIsChatSelected(false);
      selectTab("main", id);
      return;
    }
    setIsChatSelected(true);
    if (isChatPanelOpen) return;
    stopPanelAnimation();
    setChatContentWidth(lastChatPanelSizeRef.current);
    setIsChatPanelOpen(true);
    chatPanelRef.current?.resize(lastChatPanelSizeRef.current);
  };

  const closePaneFile = (target: "main" | "side", id: string) => {
    patchPane(target, (current) => {
      const next = closeOpenTab(current.openIds, id, current.selectedId);
      return { selectedId: next.selectedId, openIds: next.openIds };
    });
  };

  const openFileInFocusedPane = (id: string) => {
    const target = focusedPane === "side" && side ? "side" : "main";
    patchPane(target, (current) => openFileInPane(current, id));
  };

  const openFileInFocusedPaneBackground = (ids: readonly string[]) => {
    const target = focusedPane === "side" && isSplit && side ? "side" : "main";
    patchPane(target, (current) => {
      let next = current;
      for (const id of ids) next = openFileInPaneBackground(next, id);
      return next;
    });
  };

  const openFileInOtherPane = (ids: readonly string[]) => {
    const next = assignFilesToOtherPane(focusedPane, isSplit, main, side, ids);
    setMain(next.main);
    setSide(next.side);
    setIsSplit(true);
  };

  const transferFile = (
    from: "main" | "side",
    to: "main" | "side",
    id: string,
    index: number,
  ) => {
    if (from === to || !side) return;
    const next = moveFileBetweenPanes(
      from === "main" ? main : side,
      to === "main" ? main : side,
      id,
      index,
    );
    setMain(from === "main" ? next.from : next.to);
    setSide(from === "side" ? next.from : next.to);
    setFocusedPane(to);
  };

  const toggleSplit = () => {
    if (isSplit) {
      setIsSplit(false);
      setFocusedPane("main");
      return;
    }
    setSide(
      (current) =>
        current ?? {
          selectedId: main.selectedId === INPUT_TAB ? "review" : INPUT_TAB,
          openIds: [],
        },
    );
    setIsSplit(true);
  };

  const roomToolbar = (className?: string) => (
    <div className={cn("flex shrink-0 items-center gap-0.5 px-1.5", className)}>
      <Tooltip content="Feedback" side="bottom">
        <Button
          aria-label="Feedback"
          size="icon-compact"
          type="button"
          variant="ghost"
        >
          <Megaphone aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip
        content={isSplit ? "Unsplit panel" : "Split panel"}
        side="bottom"
      >
        <Button
          aria-label={isSplit ? "Unsplit panel" : "Split panel"}
          aria-pressed={isSplit}
          className="@max-[941px]/case-room:hidden"
          onClick={toggleSplit}
          size="icon-compact"
          type="button"
          variant="ghost"
        >
          <SplitViewIcon aria-hidden="true" />
        </Button>
      </Tooltip>
      <Tooltip
        content={isChatPanelOpen ? "Hide chat" : "Show chat"}
        side="bottom"
      >
        <Button
          aria-controls={chatPanelId}
          aria-expanded={isChatPanelOpen}
          aria-label={isChatPanelOpen ? "Hide chat" : "Show chat"}
          className="@max-[941px]/case-room:hidden"
          onClick={toggleChatPanel}
          size="icon-compact"
          type="button"
          variant="ghost"
        >
          {isChatPanelOpen ? (
            <SidebarRightIcon aria-hidden="true" />
          ) : (
            <LayoutRightIcon aria-hidden="true" />
          )}
        </Button>
      </Tooltip>
    </div>
  );

  return (
    <CaseRecordContext.Provider value={caseItem}>
      <CaseWorkContext.Provider value={work}>
        <div
          className="@container/case-room flex h-full min-h-0 w-full flex-1 flex-col overflow-hidden @max-[941px]/case-room:[&_[data-room-pane=fill]]:grow! @max-[941px]/case-room:[&_[data-room-pane=hidden]]:hidden! @max-[941px]/case-room:[&_[data-room-pane=tabs]]:shrink-0! @max-[941px]/case-room:[&_[data-room-pane=tabs]]:grow-0! @max-[941px]/case-room:[&_[data-room-pane=tabs]]:basis-auto!"
          data-testid="agent-case-room"
        >
          <CaseRoomHeader
            agent={agent}
            caseItem={caseItem}
            caseRef={caseRef}
            detailsOpen={caseItem ? isDetailsOpen : undefined}
            neighbors={neighbors}
            onStatusChange={onStatusChange}
            assign={assign}
            onToggleDetails={() => setIsDetailsOpen((open) => !open)}
          />
          <div className="flex min-h-0 flex-1">
            <AgentSectionNav agent={agent} section="cases" />
            <ResizablePanelGroup
              className="min-h-0 min-w-0 flex-1 @max-[941px]/case-room:flex-col!"
              orientation="horizontal"
            >
              <ResizablePanel
                className="min-h-0 min-w-0 bg-surface-2"
                data-room-pane={
                  caseItem && isDetailsOpen
                    ? "hidden"
                    : isChatSelected
                      ? "tabs"
                      : "fill"
                }
                id={`${idPrefix}-workspace`}
                minSize={MIN_WORKSPACE_PANEL_SIZE}
                suppressHydrationWarning
              >
                <div className="flex h-full min-h-0 flex-col overflow-hidden bg-surface-2">
                  <CaseInputWorkspace
                    caseFiles={caseFiles}
                    idPrefix={idPrefix}
                    onOpenItem={openFileInFocusedPane}
                    onOpenItemInBackground={openFileInFocusedPaneBackground}
                    onOpenItemInOtherPane={openFileInOtherPane}
                    samples={inputSamples}
                  >
                    {isSplit && side ? (
                      <ResizablePanelGroup
                        className="min-h-0 flex-1"
                        orientation="horizontal"
                      >
                        <ResizablePanel
                          className="min-h-0 min-w-0"
                          data-room-pane="fill"
                          minSize={160}
                        >
                          <CaseWorkspacePane
                            chatSelected={isChatSelected}
                            focused={focusedPane === "main"}
                            idPrefix={`${idPrefix}-main`}
                            label="Main case views"
                            name="main"
                            onCloseFile={(id) => closePaneFile("main", id)}
                            onFocus={() => setFocusedPane("main")}
                            onReorderFiles={(ids) =>
                              setMain((current) => ({
                                ...current,
                                openIds: ids,
                              }))
                            }
                            onSelect={selectMainView}
                            onTransferFile={(id, from, index) =>
                              transferFile(from, "main", id, index)
                            }
                            pane={main}
                            toolbar={roomToolbar(
                              "@min-[941px]/case-room:hidden",
                            )}
                          />
                        </ResizablePanel>
                        <ResizableHandle
                          aria-label="Resize split panel"
                          className="@max-[941px]/case-room:hidden"
                        />
                        <ResizablePanel
                          className="min-h-0 min-w-0"
                          data-room-pane="hidden"
                          minSize={160}
                        >
                          <CaseWorkspacePane
                            focused={focusedPane === "side"}
                            idPrefix={`${idPrefix}-side`}
                            label="Split case views"
                            name="side"
                            onCloseFile={(id) => closePaneFile("side", id)}
                            onFocus={() => setFocusedPane("side")}
                            onReorderFiles={(ids) =>
                              setSide((current) =>
                                current
                                  ? { ...current, openIds: ids }
                                  : current,
                              )
                            }
                            onSelect={(id) => selectTab("side", id)}
                            onTransferFile={(id, from, index) =>
                              transferFile(from, "side", id, index)
                            }
                            pane={side}
                            toolbar={roomToolbar()}
                          />
                        </ResizablePanel>
                      </ResizablePanelGroup>
                    ) : (
                      <CaseWorkspacePane
                        chatSelected={isChatSelected}
                        focused={false}
                        idPrefix={`${idPrefix}-main`}
                        label="Case views"
                        name="main"
                        onCloseFile={(id) => closePaneFile("main", id)}
                        onFocus={() => setFocusedPane("main")}
                        onReorderFiles={(ids) =>
                          setMain((current) => ({ ...current, openIds: ids }))
                        }
                        onSelect={selectMainView}
                        pane={main}
                        toolbar={roomToolbar()}
                      />
                    )}
                  </CaseInputWorkspace>
                </div>
              </ResizablePanel>
              {caseItem && isDetailsOpen ? (
                <>
                  <ResizableHandle
                    aria-label="Resize details"
                    className="@max-[941px]/case-room:hidden"
                  />
                  <ResizablePanel
                    aria-label="Details"
                    className="flex min-h-0 min-w-0 flex-col bg-surface-2"
                    data-room-pane="fill"
                    defaultSize={360}
                    id={`${idPrefix}-details`}
                    maxSize="40%"
                    minSize={300}
                    role="complementary"
                  >
                    <CaseRoomDetails item={caseItem} />
                  </ResizablePanel>
                </>
              ) : null}
              <ResizableHandle
                aria-label="Resize chat panel"
                className="@max-[941px]/case-room:hidden"
                onPointerDown={stopPanelAnimation}
              />
              <ResizablePanel
                aria-hidden={!isChatPanelOpen}
                aria-label="Chat"
                className="h-full min-w-0 overflow-hidden bg-surface-2"
                collapsedSize={0}
                collapsible={chatPanelMinSize === 0}
                data-room-pane={
                  isChatSelected && !(caseItem && isDetailsOpen)
                    ? "fill"
                    : "hidden"
                }
                data-state={isChatPanelOpen ? "open" : "closed"}
                defaultSize={DEFAULT_CHAT_PANEL_SIZE}
                groupResizeBehavior="preserve-pixel-size"
                id={chatPanelId}
                inert={!isChatPanelOpen}
                maxSize="70%"
                minSize={chatPanelMinSize}
                onResize={(size) => {
                  const group =
                    document.getElementById(chatPanelId)?.parentElement;
                  if (
                    group &&
                    getComputedStyle(group).flexDirection === "column"
                  ) {
                    wasNarrowRef.current = true;
                    return;
                  }
                  if (wasNarrowRef.current) {
                    wasNarrowRef.current = false;
                    setIsChatSelected(false);
                    chatPanelRef.current?.resize(
                      isChatPanelOpen ? lastChatPanelSizeRef.current : 0,
                    );
                    return;
                  }
                  if (
                    isClosingRef.current ||
                    isPanelAnimating ||
                    !hasRestoredChatPanelSizeRef.current
                  ) {
                    return;
                  }

                  const isOpen = size.inPixels > 0;
                  setIsChatPanelOpen(isOpen);
                  if (isOpen && size.inPixels >= MIN_CHAT_PANEL_SIZE) {
                    lastChatPanelSizeRef.current = size.inPixels;
                    setChatContentWidth(size.inPixels);
                    storeChatPanelSize(size.inPixels);
                  }
                }}
                panelRef={chatPanelRef}
                role="complementary"
                suppressHydrationWarning
              >
                <motion.div
                  animate={{ opacity: isChatPanelOpen ? 1 : 0 }}
                  className="h-full min-h-0"
                  id={`${idPrefix}-main-panel-${CHAT_VIEW.id}`}
                  initial={false}
                  style={
                    lockChatContentWidth
                      ? { width: chatContentWidth }
                      : { width: "100%" }
                  }
                  transition={
                    isChatPanelOpen ? spring.moderate : spring.moderate.exit
                  }
                >
                  <CaseRoomChat
                    className="h-full min-h-0"
                    key={`${caseRef.agentId}/${caseRef.caseId}`}
                  />
                </motion.div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
          <ScriptOnce>
            {getInitialChatPanelLayoutScript(chatPanelId)}
          </ScriptOnce>
        </div>
      </CaseWorkContext.Provider>
    </CaseRecordContext.Provider>
  );
}
