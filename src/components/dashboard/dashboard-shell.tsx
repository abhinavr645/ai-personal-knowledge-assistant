"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useExploration } from "@/hooks/use-exploration";
import { exampleGraphPositions } from "@/lib/mock-data/example-exploration";
import { AnswerPanel } from "./answer-panel";
import { DashboardHeader } from "./dashboard-header";
import { DashboardSidebar, type SidebarActions } from "./dashboard-sidebar";
import {
  ExplorationHistoryDialog,
  type HistoryAction,
} from "./exploration-history";
import { KnowledgeGraph } from "./knowledge-graph";
import { SelectedTopicPanel } from "./selected-topic-panel";
import { TopicSearch } from "./topic-search";
import { WorkspaceSettings } from "./workspace-settings";

export function DashboardShell() {
  const exploration = useExploration();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const [historyAction, setHistoryAction] = useState<HistoryAction>();
  const [openError, setOpenError] = useState<string>();
  const searchInput = useRef<HTMLInputElement>(null);
  const returnToSearch = useRef(false);
  const { state, history } = exploration;
  const historyNotice = openError ?? history.saveError ?? history.error;

  function focusSearch() {
    if (sidebarOpen) {
      returnToSearch.current = true;
      setSidebarOpen(false);
    } else {
      searchInput.current?.focus();
    }
  }

  const sidebar: SidebarActions = {
    activeQuery: state.status === "ready" ? state.exploration.topic : null,
    history: {
      ...history,
      activeId: exploration.activeId,
      onOpen(id) {
        const result = history.load(id);
        setSidebarOpen(false);
        if (result.snapshot) {
          setOpenError(undefined);
          if (exploration.activeId !== id) exploration.restore(result.snapshot);
        } else {
          setOpenError(result.error);
        }
      },
      onAction(action) {
        setSidebarOpen(false);
        setHistoryAction(action);
      },
    },
    onNew: () => {
      setOpenError(undefined);
      exploration.reset();
      focusSearch();
    },
    onNavigate: focusSearch,
    onExample: (entry) => {
      setOpenError(undefined);
      void exploration.search(entry.query);
      setSidebarOpen(false);
    },
    onSettings: () => {
      setSidebarOpen(false);
      setSettingsOpen(true);
    },
  };

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[13.5rem_minmax(0,1fr)] xl:grid-cols-[14.5rem_minmax(0,1fr)]">
      <a
        href="#workspace-content"
        className="sr-only z-50 rounded-md bg-primary p-3 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to workspace
      </a>
      <aside className="sticky top-0 hidden h-dvh self-start border-r border-sidebar-border md:block">
        <DashboardSidebar {...sidebar} />
      </aside>
      <div className="min-w-0">
        <DashboardHeader
          sidebar={sidebar}
          open={sidebarOpen}
          onOpenChange={setSidebarOpen}
          returnFocus={() => {
            if (!returnToSearch.current) return true;
            returnToSearch.current = false;
            return searchInput.current;
          }}
        />
        <main
          id="workspace-content"
          tabIndex={-1}
          className="mx-auto max-w-410 px-4 pb-12 focus:outline-none sm:px-6 lg:px-8"
        >
          <TopicSearch
            query={exploration.query}
            pendingQuery={state.status === "loading" ? state.query : null}
            inputError={exploration.inputError}
            inputRef={searchInput}
            onChange={exploration.changeQuery}
            onSearch={(value) => {
              setOpenError(undefined);
              void exploration.search(value);
              if (!value.trim()) searchInput.current?.focus();
            }}
          />
          {historyNotice && (
            <div className="mb-4 flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
              <p
                role="status"
                className="min-w-0 text-sm wrap-anywhere text-muted-foreground"
              >
                {historyNotice}
              </p>
              {history.saveError && !openError && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={history.retrySave}
                >
                  Retry save
                </Button>
              )}
            </div>
          )}
          <div className="grid min-w-0 gap-4 sm:gap-5 min-[1120px]:grid-cols-[minmax(0,1fr)_18rem] min-[1450px]:grid-cols-[minmax(0,1fr)_20rem]">
            <KnowledgeGraph
              graph={exploration.graph}
              layoutHints={
                state.status === "idle" ? exampleGraphPositions : undefined
              }
              resetRevision={exploration.resetRevision}
              restoredPositions={exploration.restoredPositions}
              onPositionsChange={exploration.recordPositions}
              selectedId={exploration.selectedId}
              showLabels={showLabels}
              isExample={state.status === "idle"}
              onSelect={exploration.selectNode}
              expandedNodeIds={exploration.expandedNodeIds}
              loadingNodeIds={exploration.loadingNodeIds}
              emptyMessage={
                state.status === "loading"
                  ? "Searching for concepts…"
                  : "No concepts to display."
              }
            />
            <SelectedTopicPanel
              node={exploration.node}
              related={exploration.related}
              expansion={exploration.expansion}
              sources={exploration.conceptSources}
              canExpand={state.status === "ready"}
              graphFull={exploration.graphFull}
              onSelect={exploration.selectNode}
              onExpand={exploration.expand}
            />
            <AnswerPanel
              knowledge={
                state.status === "ready"
                  ? state.exploration.knowledge
                  : undefined
              }
              searching={state.status === "loading"}
              message={
                state.status === "failed" || state.status === "insufficient"
                  ? state.message
                  : undefined
              }
              failed={state.status === "failed"}
            />
          </div>
        </main>
      </div>
      <WorkspaceSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        showLabels={showLabels}
        onLabelsChange={setShowLabels}
      />
      {historyAction && (
        <ExplorationHistoryDialog
          action={historyAction}
          finalFocus={searchInput}
          onClose={() => setHistoryAction(undefined)}
          onConfirm={(title) => {
            const id = historyAction.entry.id;
            if (historyAction.kind === "rename")
              return history.rename(id, title);
            const failure = history.remove(id);
            if (!failure && id === exploration.activeId) exploration.reset();
            return failure;
          }}
        />
      )}
    </div>
  );
}
