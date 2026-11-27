import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  platform,
  type SpineArtifact,
  type SpineCachedStrip,
  type SpineQueueState,
  type SpineStage,
} from "../platform";

/** What the UI knows about one book's automatic spine job. */
export type SpineBookState =
  | { state: "waiting" }
  | { state: "working"; stage: SpineStage }
  | { state: "ready" }
  | { state: "needs-attention" };

export interface SpineActivityValue {
  queue: SpineQueueState | null;
  paused: boolean;
  /** Per-book job state, keyed by book id. */
  jobs: Record<number, SpineBookState>;
  /** Ready 52 x 236 spine images, keyed by book id. */
  spines: Record<number, string>;
  /** Queue books for preparation; cached books settle as ready immediately. */
  enqueue(bookIds: number[]): void;
  /** Explicit user stop. A later reader close must not undo it. */
  stop(): void;
  /** Explicit user resume. */
  resume(): void;
  /** Reader opened: pause the worker. */
  readerOpened(bookId: number): void;
  /** Reader closed: resume unless the user stopped the queue explicitly. */
  readerClosed(): void;
  /** Record a manual generation or a known artifact as the book's result. */
  noteReady(bookId: number, artifact?: SpineArtifact | null): void;
  /**
   * Seed the wall from cached strips. A repeated call with `refresh` updates
   * strips that changed since launch (a queue job just finished, or the wall
   * reloaded). Never enqueues work.
   */
  hydrate(strips: SpineCachedStrip[], refresh?: boolean): void;
  /** The bulk launch projection failed; use the per-book read for visible books. */
  hydrateFailed(): void;
  /** Per-book fallback for visible books when the bulk call is unavailable. */
  hydrateVisible(bookIds: number[]): void;
  /** True when the bulk projection failed and the wall should use the fallback. */
  bulkHydrationFailed: boolean;
}

/**
 * Merge cached strips into the wall state. Pure: strips already hydrated are
 * ignored unless `refresh` is set, fallback verdicts keep the Cloth spine, and
 * no book is enqueued.
 */
export function mergeCachedStrips(
  spines: Record<number, string>,
  jobs: Record<number, SpineBookState>,
  strips: readonly SpineCachedStrip[],
  hydrated: ReadonlySet<number>,
  refresh = false,
): {
  spines: Record<number, string>;
  jobs: Record<number, SpineBookState>;
  added: number[];
} {
  let nextSpines = spines;
  let nextJobs = jobs;
  const added: number[] = [];
  for (const strip of strips) {
    const { bookId } = strip;
    if (added.includes(bookId)) continue;
    if (hydrated.has(bookId) && !refresh) continue;
    added.push(bookId);
    if (strip.verdict === "fallback") {
      if (bookId in nextSpines) {
        if (nextSpines === spines) nextSpines = { ...spines };
        delete nextSpines[bookId];
      }
    } else if (nextSpines[bookId] !== strip.spineDataUrl) {
      if (nextSpines === spines) nextSpines = { ...spines };
      nextSpines[bookId] = strip.spineDataUrl;
    }
    const job = nextJobs[bookId];
    if (!job || job.state === "waiting") {
      if (nextJobs === jobs) nextJobs = { ...jobs };
      nextJobs[bookId] = { state: "ready" };
    }
  }
  return { spines: nextSpines, jobs: nextJobs, added };
}

export const STAGE_LABELS: Record<SpineStage, string> = {
  art: "Tracing the art",
  text: "Removing cover text",
  check: "Checking the result",
};

const fallback: SpineActivityValue = {
  queue: null,
  paused: false,
  jobs: {},
  spines: {},
  enqueue: (bookIds) => {
    void platform.spineEnqueue(bookIds).catch(() => {});
  },
  stop: () => {
    void platform.spinePause(true).catch(() => {});
  },
  resume: () => {
    void platform.spinePause(false).catch(() => {});
  },
  readerOpened: () => {
    void platform.spinePause(true).catch(() => {});
  },
  readerClosed: () => {
    void platform.spinePause(false).catch(() => {});
  },
  noteReady: () => {},
  hydrate: () => {},
  hydrateFailed: () => {},
  hydrateVisible: () => {},
  bulkHydrationFailed: false,
};

const SpineActivityContext = createContext<SpineActivityValue | null>(null);

export function useSpineActivity(): SpineActivityValue {
  return useContext(SpineActivityContext) ?? fallback;
}

export function SpineActivityProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<SpineQueueState | null>(null);
  const [paused, setPaused] = useState(false);
  const [jobs, setJobs] = useState<Record<number, SpineBookState>>({});
  const [spines, setSpines] = useState<Record<number, string>>({});
  const [bulkHydrationFailed, setBulkHydrationFailed] = useState(false);
  const [readerOpen, setReaderOpen] = useState(false);
  const prevQueue = useRef<SpineQueueState | null>(null);
  const manualPaused = useRef(false);
  /** Ids the wall already knows a result for; never re-fetched by enqueue. */
  const hydrated = useRef<Set<number>>(new Set());
  /** Ids the per-book fallback already asked the shell about. */
  const requested = useRef<Set<number>>(new Set());
  const spinesRef = useRef(spines);
  const jobsRef = useRef(jobs);
  spinesRef.current = spines;
  jobsRef.current = jobs;

  const applyArtifact = useCallback((artifact: SpineArtifact | null) => {
    if (!artifact) return;
    const bookId = artifact.bookId;
    if (artifact.verdict === "fallback") {
      // The quality gate rejected the generated art, so the shelf keeps its
      // typographic Cloth spine. The detail still previews the artifact.
      setSpines((current) => {
        if (!(bookId in current)) return current;
        const next = { ...current };
        delete next[bookId];
        return next;
      });
    } else {
      setSpines((current) =>
        current[bookId] === artifact.spineDataUrl
          ? current
          : { ...current, [bookId]: artifact.spineDataUrl },
      );
    }
    setJobs((current) =>
      current[bookId]?.state === "ready"
        ? current
        : { ...current, [bookId]: { state: "ready" } },
    );
  }, []);

  const loadArtifact = useCallback(
    async (bookId: number) => {
      try {
        applyArtifact(await platform.spineArtifact(bookId));
      } catch {
        // A missing artifact is not a queue failure; the next event retries.
      }
    },
    [applyArtifact],
  );

  const hydrate = useCallback((strips: SpineCachedStrip[], refresh = false) => {
    const merged = mergeCachedStrips(
      spinesRef.current,
      jobsRef.current,
      strips,
      hydrated.current,
      refresh,
    );
    setBulkHydrationFailed(false);
    if (merged.added.length === 0) return;
    for (const bookId of merged.added) hydrated.current.add(bookId);
    setSpines(merged.spines);
    setJobs(merged.jobs);
  }, []);

  const refreshCached = useCallback(async () => {
    try {
      hydrate(await platform.spineCachedStrips(), true);
    } catch {
      // The per-book fallback and the next queue event retry.
    }
  }, [hydrate]);

  const handleQueue = useCallback(
    (next: SpineQueueState) => {
      const prev = prevQueue.current;
      prevQueue.current = next;
      setQueue(next);
      setPaused(next.paused);
      setJobs((current) => {
        let jobsNext = current;
        const write = (bookId: number, state: SpineBookState) => {
          if (jobsNext === current) jobsNext = { ...current };
          jobsNext[bookId] = state;
        };
        if (prev?.currentBookId != null) {
          const bookId = prev.currentBookId;
          if (next.failed > prev.failed) {
            write(bookId, { state: "needs-attention" });
          } else if (next.completed > prev.completed) {
            write(bookId, { state: "ready" });
            void loadArtifact(bookId);
            // The bulk projection is the reliable path: refresh it so every
            // completed job appears on the wall even if the per-book read
            // races the cache install.
            void refreshCached();
          }
        }
        if (next.currentBookId != null) {
          write(next.currentBookId, {
            state: "working",
            stage: next.stage ?? "art",
          });
        }
        return jobsNext;
      });
    },
    [loadArtifact, refreshCached],
  );

  useEffect(() => {
    let alive = true;
    let offQueue: (() => void) | null = null;
    let offProgress: (() => void) | null = null;
    void platform.onSpineQueue((next) => {
      if (alive) handleQueue(next);
    }).then((off) => {
      offQueue = off;
      if (!alive) off();
    });
    void platform.onSpineProgress((progress) => {
      if (!alive) return;
      setJobs((current) => ({
        ...current,
        [progress.bookId]: { state: "working", stage: progress.stage },
      }));
    }).then((off) => {
      offProgress = off;
      if (!alive) off();
    });
    void platform
      .spineQueue()
      .then((next) => {
        if (alive) handleQueue(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
      offQueue?.();
      offProgress?.();
    };
  }, [handleQueue]);

  const enqueue = useCallback(
    (bookIds: number[]) => {
      const unique = [...new Set(bookIds)].filter((id) =>
        Number.isInteger(id),
      );
      if (unique.length === 0) return;
      setJobs((current) => {
        const next = { ...current };
        for (const id of unique) {
          if (next[id]?.state !== "ready") next[id] = { state: "waiting" };
        }
        return next;
      });
      // A cached book is skipped by the worker, so it never emits a queue
      // transition; settle those to ready from the cache seam. Books already
      // seeded by `hydrate` need no second artifact read.
      for (const id of unique) {
        if (hydrated.current.has(id)) continue;
        void platform.spineArtifact(id).then(applyArtifact).catch(() => {});
      }
      void platform
        .spineEnqueue(unique)
        .then(() => platform.spineQueue())
        .then(handleQueue)
        .catch(() => {});
    },
    [applyArtifact, handleQueue],
  );

  const stop = useCallback(() => {
    manualPaused.current = true;
    setPaused(true);
    void platform.spinePause(true).catch(() => {});
  }, []);

  const resume = useCallback(() => {
    manualPaused.current = false;
    setPaused(false);
    void platform.spinePause(false).catch(() => {});
  }, []);

  const readerOpened = useCallback((bookId: number) => {
    void bookId;
    setReaderOpen(true);
    void platform.spinePause(true).catch(() => {});
  }, []);

  const readerClosed = useCallback(() => {
    setReaderOpen(false);
    // A manual Stop outlives the reader; only an automatic reader pause is
    // lifted on close.
    if (!manualPaused.current) {
      setPaused(false);
      void platform.spinePause(false).catch(() => {});
    }
  }, []);

  const noteReady = useCallback(
    (bookId: number, artifact?: SpineArtifact | null) => {
      if (artifact) {
        applyArtifact(artifact);
        return;
      }
      setJobs((current) => ({
        ...current,
        [bookId]: { state: "ready" },
      }));
      void loadArtifact(bookId);
    },
    [applyArtifact, loadArtifact],
  );

  const hydrateFailed = useCallback(() => {
    setBulkHydrationFailed(true);
  }, []);

  const hydrateVisible = useCallback(
    (bookIds: number[]) => {
      for (const bookId of bookIds) {
        if (!Number.isInteger(bookId) || requested.current.has(bookId)) continue;
        if (hydrated.current.has(bookId)) continue;
        requested.current.add(bookId);
        void loadArtifact(bookId);
      }
    },
    [loadArtifact],
  );

  const value = useMemo<SpineActivityValue>(
    () => ({
      queue,
      paused,
      jobs,
      spines,
      enqueue,
      stop,
      resume,
      readerOpened,
      readerClosed,
      noteReady,
      hydrate,
      hydrateFailed,
      hydrateVisible,
      bulkHydrationFailed,
    }),
    [
      queue,
      paused,
      jobs,
      spines,
      enqueue,
      stop,
      resume,
      readerOpened,
      readerClosed,
      noteReady,
      hydrate,
      hydrateFailed,
      hydrateVisible,
      bulkHydrationFailed,
    ],
  );

  return (
    <SpineActivityContext.Provider value={value}>
      <SpineReaderContext.Provider value={readerOpen}>
        {children}
      </SpineReaderContext.Provider>
    </SpineActivityContext.Provider>
  );
}

const SpineReaderContext = createContext(false);

/** True while a book is open in the reader; the activity chip hides. */
export function useSpineReaderOpen(): boolean {
  return useContext(SpineReaderContext);
}
