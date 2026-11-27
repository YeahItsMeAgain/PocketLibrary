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
  const [readerOpen, setReaderOpen] = useState(false);
  const prevQueue = useRef<SpineQueueState | null>(null);
  const manualPaused = useRef(false);

  const applyArtifact = useCallback((artifact: SpineArtifact | null) => {
    if (!artifact) return;
    const bookId = artifact.bookId;
    setSpines((current) =>
      current[bookId] === artifact.spineDataUrl
        ? current
        : { ...current, [bookId]: artifact.spineDataUrl },
    );
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
    [loadArtifact],
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
      // transition; settle those to ready from the cache seam.
      for (const id of unique) {
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
