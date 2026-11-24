import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  summarize,
  type HistorySnapshot,
  type HistorySummary,
} from "@/lib/exploration/history-snapshot";
import {
  createExplorationStorage,
  HistoryStorageError,
  historyKeyPrefix,
  sortHistory,
} from "@/lib/exploration/history-storage";

const historyStorage = createExplorationStorage();

export interface HistoryDraft {
  id: string;
  topic: string;
  createdAt: string;
  restored: boolean;
  content: unknown;
}

interface HistoryList {
  loaded: boolean;
  entries: HistorySummary[];
  skipped: number;
  error?: string;
}

function errorMessage(error: unknown) {
  return error instanceof HistoryStorageError
    ? error.message
    : "Exploration history is unavailable.";
}

export function useExplorationHistory(draft: HistoryDraft | undefined) {
  const [history, setHistory] = useState<HistoryList>({
    loaded: false,
    entries: [],
    skipped: 0,
  });
  const [saveFailure, setSaveFailure] = useState<{
    id: string;
    message: string;
    conflict: boolean;
  }>();
  const saved = useRef<HistorySnapshot | null>(null);

  useEffect(() => {
    let mounted = true;
    function refresh() {
      if (!mounted) return;
      try {
        const list = historyStorage.list();
        setHistory({ loaded: true, ...list });
      } catch (error) {
        setHistory((current) => ({
          ...current,
          loaded: true,
          error: errorMessage(error),
        }));
      }
    }
    function storageChanged(event: StorageEvent) {
      if (event.key === null || event.key.startsWith(historyKeyPrefix))
        refresh();
    }
    queueMicrotask(refresh);
    window.addEventListener("storage", storageChanged);
    return () => {
      mounted = false;
      window.removeEventListener("storage", storageChanged);
    };
  }, []);

  function addOrRefresh(snapshot: HistorySnapshot) {
    const entry = summarize(snapshot);
    setHistory((current) => {
      const earlier = current.entries.find(({ id }) => id === entry.id);
      if (
        current.loaded &&
        !current.error &&
        earlier?.updatedAt === entry.updatedAt &&
        earlier.title === entry.title &&
        earlier.conceptCount === entry.conceptCount
      )
        return current;
      return {
        ...current,
        loaded: true,
        entries: sortHistory([
          ...current.entries.filter(({ id }) => id !== entry.id),
          entry,
        ]),
        error: undefined,
      };
    });
  }

  function save(candidate: HistoryDraft) {
    try {
      const baseline =
        saved.current?.id === candidate.id ? saved.current : undefined;
      if (candidate.restored && !baseline) return;
      const snapshot = baseline
        ? historyStorage.update(candidate.id, candidate.content, baseline)
        : historyStorage.create(
            candidate.id,
            candidate.topic,
            candidate.createdAt,
            candidate.content,
          );
      saved.current = snapshot;
      addOrRefresh(snapshot);
      setSaveFailure(undefined);
    } catch (error) {
      setSaveFailure({
        id: candidate.id,
        message: errorMessage(error),
        conflict:
          error instanceof HistoryStorageError && error.code === "conflict",
      });
    }
  }

  const saveAfterCommit = useEffectEvent(save);
  useEffect(() => {
    if (!draft) return;
    let superseded = false;
    queueMicrotask(() => {
      if (!superseded) saveAfterCommit(draft);
    });
    return () => {
      superseded = true;
    };
  }, [draft]);

  const failure =
    draft && saveFailure?.id === draft.id ? saveFailure : undefined;
  return {
    ...history,
    saveError: failure?.message,
    saveConflict: failure?.conflict ?? false,
    retrySave() {
      if (draft) save(draft);
    },
    load(id: string) {
      try {
        return { snapshot: historyStorage.load(id) };
      } catch (error) {
        return { error: errorMessage(error) };
      }
    },
    rememberRestored(snapshot: HistorySnapshot) {
      saved.current = snapshot;
      setSaveFailure(undefined);
    },
    rename(id: string, title: string) {
      try {
        addOrRefresh(historyStorage.rename(id, title));
      } catch (error) {
        return errorMessage(error);
      }
    },
    remove(id: string) {
      try {
        historyStorage.remove(id);
        setHistory((current) => ({
          ...current,
          entries: current.entries.filter((entry) => entry.id !== id),
        }));
      } catch (error) {
        return errorMessage(error);
      }
    },
  };
}
