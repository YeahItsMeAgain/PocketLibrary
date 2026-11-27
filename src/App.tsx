import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  isApiError,
  platform,
  type Download,
  type LibraryStatus,
} from "./platform";
import { useLayerExit } from "./navigation";
import { ReportAction } from "./Diagnostics";
import { DIAGNOSTICS_HINT_EVENT, noteFailure } from "./diagnostics";
import "./App.css";

import { Masthead } from "./shell/Masthead";
import { AppInfoFooter } from "./shell/AppInfoFooter";
import { Onboarding, Reconnect } from "./shell/LibraryGate";
import { LibraryWall } from "./library/LibraryWall";
import { LibrarySkeleton } from "./library/LibrarySkeleton";
import { disconnected, runScan, scanNotice } from "./library/scan";
import { UpdateBanner } from "./updates/UpdateBanner";
import { useUpdateCheck } from "./updates/useUpdateCheck";
import { useAutomaticEnrichment } from "./settings/useAutomaticEnrichment";
import {
  SpineActivityProvider,
  useSpineActivity,
} from "./library/spineActivity";
import { SpineActivityChip } from "./library/SpineActivityChip";

// Search and Settings are navigation destinations, not first-paint content.
const SearchView = lazy(() =>
  import("./search/SearchView").then((module) => ({
    default: module.SearchView,
  })),
);
const SettingsView = lazy(() =>
  import("./settings/SettingsView").then((module) => ({
    default: module.SettingsView,
  })),
);

const DRAWER_HINT_KEY = "pocketlibrary.drawerHintSeen";
const UPDATE_DISMISSED_KEY = "pocketlibrary.updateDismissedVersion";

type View = "library" | "search" | "settings";

const NAV_ITEMS: ReadonlyArray<{ view: View; label: string; note: string }> = [
  { view: "library", label: "Library", note: "The wall" },
  { view: "search", label: "Search", note: "Front desk" },
  { view: "settings", label: "Settings", note: "The study" },
];

function ViewSkeleton() {
  return (
    <main
      id="library-main"
      className="placeholder"
      data-testid="view-skeleton"
      aria-busy="true"
    >
      <div className="wall-inner" />
    </main>
  );
}



export default function App() {
  return (
    <SpineActivityProvider>
      <AppShell />
    </SpineActivityProvider>
  );
}

function AppShell() {
  const spineActivity = useSpineActivity();
  const [view, setView] = useState<View>("library");
  const [status, setStatus] = useState<LibraryStatus | null>(null);
  const [statusFailed, setStatusFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeFailed, setNoticeFailed] = useState(false);
  const [diagnosticsHint, setDiagnosticsHint] = useState(false);
  const [shelfCapacity, setShelfCapacity] = useState<number | null>(null);
  const [downloads, setDownloads] = useState<Download[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [focusBookId, setFocusBookId] = useState<number | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerOffset, setDrawerOffset] = useState<number | null>(null);
  const [drawerDragging, setDrawerDragging] = useState(false);
  const [drawerOpening, setDrawerOpening] = useState(false);
  const [showDrawerHint, setShowDrawerHint] = useState(false);
  const [dismissedUpdateVersion, setDismissedUpdateVersion] = useState<
    string | null
  >(() => {
    try {
      return window.localStorage.getItem(UPDATE_DISMISSED_KEY);
    } catch {
      return null;
    }
  });
  const [updateFocusRequest, setUpdateFocusRequest] = useState(0);
  const update = useUpdateCheck(status !== null);
  useAutomaticEnrichment(status?.state === "ready");
  const pullRef = useRef<HTMLButtonElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const firstItemRef = useRef<HTMLButtonElement>(null);
  const drawerDragRef = useRef<{
    fromOpen: boolean;
    opened: boolean;
    y0: number;
    t0: number;
    height: number;
    y: number;
    moved: boolean;
  } | null>(null);
  const suppressRailRef = useRef(0);
  const lastHandleGestureRef = useRef(0);
  const drawerOpenedAtRef = useRef(0);
  const drawerTrackingRef = useRef(false);

  const openDrawer = useCallback((animate = false) => {
    setShowDrawerHint(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    setDrawerOpen(true);
    // Only a genuine tap replays the rail entrance. Drags and snap-backs
    // already track the finger, so animating them would flicker.
    setDrawerOpening(animate);
    try {
      window.localStorage.setItem(DRAWER_HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
    drawerOpenedAtRef.current = performance.now();
  }, []);

  const dismissDrawerHint = useCallback(() => {
    setShowDrawerHint(false);
    try {
      window.localStorage.setItem(DRAWER_HINT_KEY, "1");
    } catch {
      // A private WebView may refuse storage; the hint simply returns.
    }
  }, []);

  const closeView = useLayerExit(
    view !== "library",
    useCallback(() => setView("library"), []),
  );

  const closeDrawer = useLayerExit(drawerOpen, () => {
    setDrawerOpen(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    setDrawerOpening(false);
    pullRef.current?.focus();
  });

  useEffect(() => {
    const showHint = () => setDiagnosticsHint(true);
    window.addEventListener(DIAGNOSTICS_HINT_EVENT, showHint);
    return () => window.removeEventListener(DIAGNOSTICS_HINT_EVENT, showHint);
  }, []);

  useEffect(() => {
    let seen = false;
    try {
      seen = window.localStorage.getItem(DRAWER_HINT_KEY) === "1";
    } catch {
      seen = false;
    }
    if (seen) return;
    const show = window.setTimeout(() => {
      setShowDrawerHint(true);
      // The hint is one-time: mark it as seen as soon as it appears, so a
      // dismissal or a reload never brings it back.
      try {
        window.localStorage.setItem(DRAWER_HINT_KEY, "1");
      } catch {
        // A private WebView may refuse storage; the hint simply returns.
      }
    }, 900);
    const hide = window.setTimeout(() => setShowDrawerHint(false), 7100);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);

  useEffect(() => {
    if (!showDrawerHint) return;
    const dismiss = () => dismissDrawerHint();
    window.addEventListener("pointerdown", dismiss, { passive: true });
    return () => window.removeEventListener("pointerdown", dismiss);
  }, [showDrawerHint, dismissDrawerHint]);

  function startDrawerDrag(fromOpen: boolean, event: ReactPointerEvent) {
    if (fromOpen && !drawerOpen) return;
    if (!fromOpen && drawerOpen) return;
    if (fromOpen && (event.target as HTMLElement).closest("button")) return;
    const rail = railRef.current;
    const height = rail?.offsetHeight || 208;
    dismissDrawerHint();
    drawerDragRef.current = {
      fromOpen,
      opened: fromOpen,
      y0: event.clientY,
      t0: performance.now(),
      height,
      y: fromOpen ? 0 : height,
      moved: false,
    };
    setDrawerOpening(false);
    setDrawerDragging(true);
    setDrawerOffset(fromOpen ? 0 : height);
    try {
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    } catch {
      // Pointer capture is an enhancement; the window listeners still work.
    }
    if (!(event.target as HTMLElement).closest("button")) {
      event.preventDefault();
    }
    trackDrawerDrag();
  }

  // Attach the move/end listeners in the same turn as pointerdown. Waiting
  // for a React effect would drop the first few pixels of a quick drag.
  function trackDrawerDrag() {
    if (drawerTrackingRef.current) return;
    drawerTrackingRef.current = true;
    const onMove = (event: PointerEvent) => {
      const drag = drawerDragRef.current;
      if (!drag) return;
      const dy = event.clientY - drag.y0;
      if (Math.abs(dy) > 6) drag.moved = true;
      if (!drag.fromOpen && !drag.opened && drag.moved) {
        // Mount the rail on the first real movement, not on pointerdown, so a
        // tap has one render path: the animated open on pointerup.
        drag.opened = true;
        setDrawerOpen(true);
        drawerOpenedAtRef.current = performance.now();
      }
      const y = drag.fromOpen
        ? Math.max(0, Math.min(drag.height, dy))
        : Math.max(0, Math.min(drag.height, drag.height + dy));
      drag.y = y;
      setDrawerOffset(y);
      if (event.cancelable) event.preventDefault();
    };
    const onEnd = (event: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
      drawerTrackingRef.current = false;
      const drag = drawerDragRef.current;
      drawerDragRef.current = null;
      setDrawerDragging(false);
      if (!drag) return;
      const dy = (event.clientY ?? drag.y0) - drag.y0;
      const dt = Math.max(1, performance.now() - drag.t0);
      const velocity = dy / dt;
      if (!drag.fromOpen) lastHandleGestureRef.current = performance.now();
      if (drag.moved && drag.fromOpen) {
        suppressRailRef.current = performance.now() + 500;
      }
      let shouldOpen: boolean;
      if (drag.fromOpen) {
        shouldOpen = !(drag.y > drag.height * 0.25 || velocity > 0.45);
      } else {
        shouldOpen =
          drag.y < drag.height * 0.55 || velocity < -0.45;
        if (!drag.moved && dt < 420) shouldOpen = true;
      }
      if (shouldOpen) openDrawer(!drag.fromOpen && !drag.moved);
      else closeDrawer();
    };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  const navigate = useCallback((next: View) => {
    // Let the view's layer take over before the drawer's layer leaves, so the
    // guard history entry is replaced rather than popped and re-pushed.
    setView(next);
    setDrawerOpen(false);
    setDrawerOffset(null);
    setDrawerDragging(false);
    setDrawerOpening(false);
  }, []);

  const seeUpdate = useCallback(() => {
    navigate("settings");
    setUpdateFocusRequest((count) => count + 1);
  }, [navigate]);

  const dismissUpdate = useCallback((version: string) => {
    setDismissedUpdateVersion(version);
    try {
      window.localStorage.setItem(UPDATE_DISMISSED_KEY, version);
    } catch {
      // A private WebView may refuse storage; the session still dismisses it.
    }
  }, []);

  const initialLoadStarted = useRef(false);
  const spineBackfillStarted = useRef(false);
  const spineHydratedStarted = useRef(false);
  const enqueueSpines = spineActivity.enqueue;
  const hydrateSpines = spineActivity.hydrate;

  useEffect(() => {
    // Seed the wall from the cache as soon as the library is ready. This is
    // independent of `backfillPending`: a warm cache has no queue work left,
    // so the worker never emits a completion for it.
    if (status?.state !== "ready" || spineHydratedStarted.current) return;
    spineHydratedStarted.current = true;
    void platform
      .spineCachedStrips()
      .then((strips) => hydrateSpines(strips))
      .catch(() => {
        // A cold or unreadable cache is not a wall failure; jobs fill in.
      });
  }, [status?.state, hydrateSpines]);

  useEffect(() => {
    // The shell queues the existing library once per model bundle and reports
    // `backfillPending` in the queue payload. Wait for that state, then only
    // pay for a catalogue load when the backfill is genuinely still due.
    if (status?.state !== "ready" || spineBackfillStarted.current) return;
    const queue = spineActivity.queue;
    if (!queue) return;
    spineBackfillStarted.current = true;
    if (queue.backfillPending === false) return;
    let alive = true;
    void platform
      .listBooks()
      .then((all) => {
        if (!alive) return;
        enqueueSpines(all.map((book) => book.id));
      })
      .catch(() => {
        // The wall's own load retries; the backfill can wait for it.
      });
    return () => {
      alive = false;
    };
  }, [status?.state, spineActivity.queue, enqueueSpines]);

  useEffect(() => {
    // A single launch reconciliation; StrictMode may replay this effect, but
    // scanning twice would waste a scan.
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    (async () => {
      try {
        const next = await platform.libraryStatus();
        // Paint the wall as soon as the folder state is known. The launch
        // rescan is a background reconciliation, not a gate on first shelf.
        setStatus(next);
        if (next.state !== "ready") return;
        const outcome = await runScan();
        if (outcome.kind === "unavailable") {
          setStatus(disconnected(next));
        } else if (
          outcome.kind === "report" &&
          (outcome.report.added > 0 ||
            outcome.report.relinked > 0 ||
            outcome.report.removed > 0)
        ) {
          if (outcome.report.added > 0) {
            enqueueSpines(
              outcome.report.placements.map((placement) => placement.bookId),
            );
          }
          setReloadKey((key) => key + 1);
        }
      } catch {
        setStatusFailed(true);
      }
    })();
  }, [enqueueSpines]);

  const announcedDownloads = useRef(new Set<number>());
  const failedDownloads = useRef(new Set<number>());
  const refreshDownloads = useCallback(async () => {
    const rows = await platform.listDownloads();
    setDownloads(rows);
    return rows;
  }, []);
  useEffect(() => {
    // The one download poller. Search reads the same rows, so leaving it
    // cannot lose progress, and completions still refresh and focus the wall.
    let alive = true;
    let initialized = false;
    const check = async () => {
      let rows: Download[];
      try {
        rows = await refreshDownloads();
      } catch {
        // The queue is advisory here; the next tick retries.
        return;
      }
      if (!alive) return;
      if (!initialized) {
        initialized = true;
        for (const row of rows) {
          announcedDownloads.current.add(row.id);
          if (row.state === "failed") failedDownloads.current.add(row.id);
        }
        return;
      }
      for (const row of rows) {
        if (row.state === "failed" && !failedDownloads.current.has(row.id)) {
          failedDownloads.current.add(row.id);
          noteFailure();
        }
      }
      const fresh = rows.filter(
        (row) =>
          row.state === "completed" &&
          row.bookId !== null &&
          !announcedDownloads.current.has(row.id),
      );
      for (const row of fresh) {
        announcedDownloads.current.add(row.id);
      }
      if (fresh.length > 0) {
        enqueueSpines(
          fresh
            .map((row) => row.bookId)
            .filter((bookId): bookId is number => bookId !== null),
        );
        setFocusBookId(fresh[0].bookId);
        setReloadKey((key) => key + 1);
      }
    };
    void check();
    const timer = window.setInterval(check, 450);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [refreshDownloads, enqueueSpines]);

  useEffect(() => {
    let alive = true;
    platform
      .getShelfCapacity()
      .then((next) => {
        if (alive) setShelfCapacity(next);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const chooseFolder = useCallback(async () => {
    setBusy(true);
    setActionError(null);
    setNotice(null);
    setNoticeFailed(false);
    try {
      let next = await platform.chooseLibraryFolder();
      if (next.state === "ready") {
        const outcome = await runScan();
        if (outcome.kind === "report") {
          setNotice(scanNotice(outcome.report));
          if (outcome.report.added > 0) {
            enqueueSpines(
              outcome.report.placements.map((placement) => placement.bookId),
            );
          }
        } else if (outcome.kind === "unavailable") {
          next = disconnected(next);
        } else {
          setActionError("The folder was granted, but the first scan failed.");
        }
      }
      setStatus(next);
      setReloadKey((key) => key + 1);
    } catch {
      noteFailure();
      setActionError("The folder picker could not be opened. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [enqueueSpines]);

  const rescan = useCallback(async () => {
    setBusy(true);
    setNotice(null);
    setNoticeFailed(false);
    try {
      const outcome = await runScan();
      if (outcome.kind === "report") {
        setNotice(scanNotice(outcome.report));
        if (outcome.report.added > 0) {
          enqueueSpines(
            outcome.report.placements.map((placement) => placement.bookId),
          );
        }
        setReloadKey((key) => key + 1);
      } else if (outcome.kind === "unavailable") {
        setStatus((current) => (current ? disconnected(current) : current));
        setNotice(null);
      } else {
        setNoticeFailed(true);
        setNotice("The scan could not be completed. Please try again.");
      }
    } finally {
      setBusy(false);
    }
  }, [enqueueSpines]);

  const saveCapacity = useCallback(async (capacity: number) => {
    setBusy(true);
    setNotice(null);
    setNoticeFailed(false);
    try {
      const applied = await platform.setShelfCapacity(capacity);
      setShelfCapacity(applied);
      setReloadKey((key) => key + 1);
      setNotice(`Shelf capacity set to ${applied}.`);
    } catch (error) {
      noteFailure();
      setNoticeFailed(true);
      setNotice(
        isApiError(error)
          ? error.message
          : "Shelf capacity could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!drawerOpen) return;
    firstItemRef.current?.focus();
  }, [drawerOpen]);

  function renderMain() {
    if (view === "search") {
      return (
        <SearchView
          onBack={closeView}
          downloads={downloads}
          onRefreshDownloads={refreshDownloads}
        />
      );
    }
    if (view === "settings") {
      if (status === null) {
        return <ViewSkeleton />;
      }
      return (
        <SettingsView
          status={status}
          busy={busy}
          notice={notice}
          shelfCapacity={shelfCapacity}
          update={update}
          updateFocusRequest={updateFocusRequest}
          onRescan={rescan}
          onChoose={chooseFolder}
          onSetCapacity={saveCapacity}
          onLibraryChanged={() => setReloadKey((key) => key + 1)}
          onBack={closeView}
        />
      );
    }
    if (statusFailed) {
      return (
        <main id="library-main" className="placeholder" data-testid="library-error">
          <section className="placeholder-card">
            <p className="kicker">The Keeper's Ledger</p>
            <h2>Library unavailable</h2>
            <p>The library folder state could not be read just now.</p>
            <ReportAction testId="library-state-report" label="Report" />
          </section>
        </main>
      );
    }
    if (status === null) {
      return <LibrarySkeleton />;
    }
    if (status.state === "needsFolder") {
      return (
        <Onboarding busy={busy} error={actionError} onChoose={chooseFolder} />
      );
    }
    if (status.state === "disconnected") {
      return (
        <Reconnect
          folderName={status.folderName}
          busy={busy}
          error={actionError}
          onChoose={chooseFolder}
        />
      );
    }
    return (
      <LibraryWall
        reloadKey={reloadKey}
        focusBookId={focusBookId}
        notice={notice}
        noticeFailed={noticeFailed}
        onAddBooks={chooseFolder}
        onFindBook={() => setView("search")}
      />
    );
  }

  const libraryReady = view === "library" && status?.state === "ready";
  const offeredVersion =
    update.info?.available && !update.error
      ? (update.info.latestVersion ?? "newer")
      : null;
  const updateBanner =
    update.info &&
    offeredVersion !== null &&
    offeredVersion !== dismissedUpdateVersion
      ? update.info
      : null;
  return (
    <div className={`room v4-room${drawerOpen ? " is-drawer-open" : ""}`}>
      {!libraryReady ? <Masthead /> : null}
      {updateBanner ? (
        <UpdateBanner
          info={updateBanner}
          downloaded={update.downloaded}
          onSeeUpdate={seeUpdate}
          onDismiss={dismissUpdate}
        />
      ) : null}
      <AppInfoFooter hidden={view !== "settings"} />

      {diagnosticsHint ? (
        <div
          className="diagnostics-hint"
          role="status"
          data-testid="diagnostics-hint"
        >
          <p>
            A few things have stumbled. A short diagnostics report can help
            put them right.
          </p>
          <button
            type="button"
            className="secondary-action"
            data-testid="diagnostics-hint-open"
            onClick={() => {
              setDiagnosticsHint(false);
              navigate("settings");
            }}
          >
            Help &amp; diagnostics
          </button>
          <button
            type="button"
            className="diagnostics-hint-close"
            aria-label="Dismiss diagnostics hint"
            data-testid="diagnostics-hint-dismiss"
            onClick={() => setDiagnosticsHint(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ) : null}

      <Suspense fallback={<ViewSkeleton />}>{renderMain()}</Suspense>

      <SpineActivityChip />

      <div
        className="edge-zone"
        aria-hidden="true"
        onPointerDown={(event) => startDrawerDrag(false, event)}
      />
      <button
        ref={pullRef}
        type="button"
        className="drawer-pull"
        aria-label="Open navigation"
        aria-expanded={drawerOpen}
        aria-controls="navigation-drawer"
        onPointerDown={(event) => startDrawerDrag(false, event)}
        onClick={() => {
          if (performance.now() - lastHandleGestureRef.current < 500) return;
          if (drawerOpen) closeDrawer();
          else openDrawer(true);
        }}
      >
        <span className="pull-slot" aria-hidden="true" />
      </button>

      {showDrawerHint && !drawerOpen ? (
        <p className="drawer-hint show" role="status">
          <span className="up" aria-hidden="true">↑</span> Swipe up to open the drawer
        </p>
      ) : null}

      {drawerOpen && (
        <>
          <button
            type="button"
            className="drawer-scrim"
            aria-label="Close navigation"
            onClick={() => closeDrawer()}
          />
          <div id="navigation-drawer" className="drawer is-open">
            <div
              ref={railRef}
              className={`drawer-rail${drawerDragging ? " is-dragging" : ""}${drawerOpening ? " is-opening" : ""}`}
              role="dialog"
              aria-modal="true"
              aria-labelledby="drawer-title"
              style={
                drawerOffset !== null
                  ? { transform: `translate3d(0, ${drawerOffset}px, 0)` }
                  : undefined
              }
              onPointerDown={(event) => startDrawerDrag(true, event)}
              onAnimationEnd={(event) => {
                if (event.animationName === "drawer-rail-in") {
                  setDrawerOpening(false);
                }
              }}
              onClickCapture={(event) => {
                if (performance.now() < suppressRailRef.current) {
                  event.preventDefault();
                  event.stopPropagation();
                }
              }}
            >
              <h2 id="drawer-title" className="visually-hidden">
                Navigation
              </h2>
              <div className="drawer-grip" aria-hidden="true" />
              <p className="drawer-cap">The Household Catalogue</p>
              <div className="drawer-items">
                {NAV_ITEMS.map((item, index) => (
                  <button
                    key={item.view}
                    ref={index === 0 ? firstItemRef : undefined}
                    type="button"
                    className="drawer-item"
                    aria-current={view === item.view ? "page" : undefined}
                    onClick={() => navigate(item.view)}
                  >
                    <svg
                      width="25"
                      height="25"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      {item.view === "library" ? (
                        <>
                          <path d="M4 4.5h3v15H4zM9 6h3v13.5H9zM14 3.5l3 .8-4 14.8-3-.8z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                          <path d="M3 20.5h18" stroke="currentColor" strokeWidth="1.2" />
                        </>
                      ) : item.view === "search" ? (
                        <>
                          <circle cx="10.5" cy="10.5" r="6" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M15 15l5 5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </>
                      ) : (
                        <>
                          <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.3" />
                          <path d="M12 3.2v2M12 18.8v2M20.8 12h-2M5.2 12h-2M18.2 5.8l-1.4 1.4M7.2 16.8l-1.4 1.4M18.2 18.2l-1.4-1.4M7.2 7.2L5.8 5.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
                        </>
                      )}
                    </svg>
                    <b>{item.label}</b>
                    <span aria-hidden="true">{item.note}</span>
                  </button>
                ))}
              </div>
              <p className="drawer-foot">Tap outside or swipe down to close</p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
