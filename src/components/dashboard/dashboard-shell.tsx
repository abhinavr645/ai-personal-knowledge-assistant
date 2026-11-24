"use client";

import { useRef, useState } from "react";
import {
  exampleExploration,
  exampleGraphPositions,
  searchExample,
} from "@/lib/mock-data/example-exploration";
import type { Exploration } from "@/types/exploration";
import { AnswerPanel } from "./answer-panel";
import { DashboardHeader } from "./dashboard-header";
import { DashboardSidebar, type SidebarActions } from "./dashboard-sidebar";
import { KnowledgeGraph } from "./knowledge-graph";
import { SelectedTopicPanel } from "./selected-topic-panel";
import { TopicSearch } from "./topic-search";
import { WorkspaceSettings } from "./workspace-settings";

export function DashboardShell() {
  const [query, setQuery] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [searching, setSearching] = useState(false);
  const [exploration, setExploration] = useState<Exploration | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [graphResetRevision, setGraphResetRevision] = useState(0);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showLabels, setShowLabels] = useState(true);
  const searchInput = useRef<HTMLInputElement>(null);
  const returnToSearch = useRef(false);
  const requestId = useRef(0);

  const graph = exploration ?? exampleExploration;
  const node = graph.nodes.find(({ id }) => id === selectedId);
  const relatedIds = new Set(
    graph.edges.flatMap(({ source, target }) => {
      if (source === selectedId) return [target];
      if (target === selectedId) return [source];
      return [];
    }),
  );
  const related = graph.nodes.filter(({ id }) => relatedIds.has(id));

  function focusSearch() {
    if (sidebarOpen) {
      returnToSearch.current = true;
      setSidebarOpen(false);
    } else {
      searchInput.current?.focus();
    }
  }

  function cancelSearch() {
    requestId.current += 1;
    setSearching(false);
    setInvalid(false);
  }

  function newExploration() {
    cancelSearch();
    setQuery("");
    setExploration(null);
    setSelectedId(null);
    setGraphResetRevision((revision) => revision + 1);
    focusSearch();
  }

  function openExample(
    query: string,
    rootNodeId: string,
    selection = rootNodeId,
  ) {
    cancelSearch();
    setQuery(query);
    setExploration({ ...exampleExploration, query, rootNodeId });
    setSelectedId(selection);
  }

  async function search(value: string) {
    if (searching) return;
    const trimmed = value.trim();
    if (!trimmed) {
      setInvalid(true);
      searchInput.current?.focus();
      return;
    }

    const currentRequest = ++requestId.current;
    setQuery(trimmed);
    setInvalid(false);
    setSearching(true);
    const result = await searchExample(trimmed);

    if (currentRequest !== requestId.current) return;
    setExploration(result);
    setSelectedId(result.rootNodeId);
    setSearching(false);
  }

  function selectNode(id: string) {
    if (!exploration) {
      openExample(exampleExploration.query, exampleExploration.rootNodeId, id);
      return;
    }

    setSelectedId(id);
  }

  const sidebar: SidebarActions = {
    activeQuery: exploration?.query ?? null,
    onNew: newExploration,
    onNavigate: focusSearch,
    onRecent: (entry) => {
      openExample(entry.query, entry.nodeId);
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
            query={query}
            searching={searching}
            invalid={invalid}
            inputRef={searchInput}
            onChange={(value) => {
              setQuery(value);
              setInvalid(false);
            }}
            onSearch={search}
          />
          <div className="grid min-w-0 gap-4 sm:gap-5 min-[1120px]:grid-cols-[minmax(0,1fr)_18rem] min-[1450px]:grid-cols-[minmax(0,1fr)_20rem]">
            <KnowledgeGraph
              graph={graph}
              layoutHints={exampleGraphPositions}
              resetRevision={graphResetRevision}
              selectedId={selectedId}
              showLabels={showLabels}
              isExample={!exploration}
              onSelect={selectNode}
            />
            <SelectedTopicPanel
              node={node}
              related={related}
              onSelect={selectNode}
              onExplore={(concept) => openExample(concept.name, concept.id)}
            />
            <AnswerPanel answer={exploration?.answer} searching={searching} />
          </div>
        </main>
      </div>
      <WorkspaceSettings
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        showLabels={showLabels}
        onLabelsChange={setShowLabels}
      />
    </div>
  );
}
