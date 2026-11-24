import {
  decodeSnapshot,
  historyIdSchema,
  historyTitleSchema,
  historyVersion,
  maxHistoryTitleLength,
  summarize,
  type HistorySnapshot,
  type HistorySummary,
} from "./history-snapshot";

export const historyKeyPrefix = "knowledge-assistant:exploration:";
export const maxSavedExplorations = 20;
export const maxSnapshotLength = 256_000;
const maxHistoryLength = 2_000_000;

const errors = {
  unavailable: "Exploration history is unavailable in this browser.",
  invalid:
    "This exploration could not be saved or opened because its data is invalid or its version is unsupported.",
  missing: "This saved exploration is no longer available.",
  duplicate: "An exploration with this ID is already saved.",
  count: `History holds up to ${maxSavedExplorations} explorations. Delete a saved exploration to make room.`,
  size: "This exploration is too large to save. The last saved version is still in history if one exists.",
  quota: "Browser storage is full. Free some space and try saving again.",
  title: `Enter a title of 1 to ${maxHistoryTitleLength} characters.`,
};

export class HistoryStorageError extends Error {
  constructor(readonly code: keyof typeof errors) {
    super(errors[code]);
    this.name = "HistoryStorageError";
  }
}

function browserStorage() {
  return typeof window === "undefined" ? undefined : window.localStorage;
}

function withStorage<T>(
  getStorage: () => Storage | undefined,
  run: (storage: Storage) => T,
): T {
  try {
    const storage = getStorage();
    if (!storage) throw new HistoryStorageError("unavailable");
    return run(storage);
  } catch (error) {
    if (error instanceof HistoryStorageError) throw error;
    if (
      error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "QuotaExceededError"
    )
      throw new HistoryStorageError("quota");
    throw new HistoryStorageError("unavailable");
  }
}

function recordKeys(storage: Storage) {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(historyKeyPrefix)) keys.push(key);
  }
  return keys;
}

function keyFor(id: string) {
  if (!historyIdSchema.safeParse(id).success)
    throw new HistoryStorageError("invalid");
  return historyKeyPrefix + id;
}

function readRecord(raw: string, key: string) {
  if (raw.length > maxSnapshotLength) throw new HistoryStorageError("invalid");
  let data: unknown;
  try {
    data = JSON.parse(raw) as unknown;
  } catch {
    throw new HistoryStorageError("invalid");
  }
  const parsed = decodeSnapshot(data);
  if (!parsed.success || historyKeyPrefix + parsed.data.id !== key)
    throw new HistoryStorageError("invalid");
  return parsed.data;
}

function getRecord(storage: Storage, id: string) {
  const key = keyFor(id);
  const raw = storage.getItem(key);
  if (raw === null) throw new HistoryStorageError("missing");
  return readRecord(raw, key);
}

function writeRecord(storage: Storage, snapshot: HistorySnapshot) {
  const key = keyFor(snapshot.id);
  const value = JSON.stringify(snapshot);
  if (value.length > maxSnapshotLength) throw new HistoryStorageError("size");
  let total = value.length + key.length;
  for (const other of recordKeys(storage)) {
    if (other !== key)
      total += other.length + (storage.getItem(other)?.length ?? 0);
  }
  if (total > maxHistoryLength) throw new HistoryStorageError("quota");
  storage.setItem(key, value);
}

function timestamp(previous: string) {
  return new Date(Math.max(Date.now(), Date.parse(previous))).toISOString();
}

function validate(value: unknown) {
  const parsed = decodeSnapshot(value);
  if (!parsed.success) throw new HistoryStorageError("invalid");
  return parsed.data;
}

export function createExplorationStorage(getStorage = browserStorage) {
  return {
    list() {
      return withStorage(getStorage, (storage) => {
        const entries: HistorySummary[] = [];
        let skipped = 0;
        for (const key of recordKeys(storage)) {
          const raw = storage.getItem(key);
          if (raw === null) continue;
          try {
            entries.push(summarize(readRecord(raw, key)));
          } catch (error) {
            if (!(error instanceof HistoryStorageError)) throw error;
            skipped += 1;
          }
        }
        return { entries: sortHistory(entries), skipped };
      });
    },

    load(id: string) {
      return withStorage(getStorage, (storage) => getRecord(storage, id));
    },

    create(id: string, topic: string, createdAt: string, content: unknown) {
      return withStorage(getStorage, (storage) => {
        const key = keyFor(id);
        if (storage.getItem(key) !== null)
          throw new HistoryStorageError("duplicate");
        if (recordKeys(storage).length >= maxSavedExplorations)
          throw new HistoryStorageError("count");
        const snapshot = validate({
          version: historyVersion,
          id,
          title: topic.slice(0, maxHistoryTitleLength),
          createdAt,
          updatedAt: createdAt,
          content,
        });
        snapshot.updatedAt = timestamp(snapshot.createdAt);
        writeRecord(storage, snapshot);
        return snapshot;
      });
    },

    update(id: string, content: unknown) {
      return withStorage(getStorage, (storage) => {
        const previous = getRecord(storage, id);
        const snapshot = validate({ ...previous, content });
        if (
          JSON.stringify(snapshot.content) === JSON.stringify(previous.content)
        )
          return previous;
        snapshot.updatedAt = timestamp(previous.updatedAt);
        writeRecord(storage, snapshot);
        return snapshot;
      });
    },

    rename(id: string, title: string) {
      return withStorage(getStorage, (storage) => {
        const parsed = historyTitleSchema.safeParse(title);
        if (!parsed.success) throw new HistoryStorageError("title");
        const previous = getRecord(storage, id);
        if (previous.title === parsed.data) return previous;
        const snapshot = validate({
          ...previous,
          title: parsed.data,
          updatedAt: timestamp(previous.updatedAt),
        });
        writeRecord(storage, snapshot);
        return snapshot;
      });
    },

    remove(id: string) {
      withStorage(getStorage, (storage) => storage.removeItem(keyFor(id)));
    },
  };
}

export function sortHistory(entries: HistorySummary[]) {
  return entries.sort(
    (a, b) =>
      b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id),
  );
}
