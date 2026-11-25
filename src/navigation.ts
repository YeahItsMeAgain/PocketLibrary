import { useCallback, useEffect, useRef } from "react";

/**
 * One history entry guards every open layer: drawer, book detail, label
 * manager, Search/Settings and the reader. Only one entry is ever pushed, so
 * Android/browser back unwinds exactly one layer and never leaves the app
 * while a layer is open. Escape uses the same close path as the visible
 * controls, so a layer cannot be closed twice.
 *
 * When the top layer changes (a second layer opens, or one closes without
 * emptying the stack) the guard entry is replaced in place. Only the last
 * close pops it.
 */
const HISTORY_KEY = "__pocketLibraryLayer";

interface LayerEntry {
  token: string;
  closed: boolean;
  onClose: () => void;
}

let layerToken = 0;
const stack: LayerEntry[] = [];
let armed = false;
let popTimer = 0;
let listenersAttached = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function currentState(): Record<string, unknown> {
  return isRecord(window.history.state) ? window.history.state : {};
}

function armEntry(entry: LayerEntry) {
  window.history.pushState(
    { ...currentState(), [HISTORY_KEY]: entry.token },
    "",
  );
  armed = true;
}

function replaceIfArmed() {
  if (!armed) return;
  const top = stack[stack.length - 1];
  if (!top) return;
  window.history.replaceState(
    { ...currentState(), [HISTORY_KEY]: top.token },
    "",
  );
}

function scheduleSentinelPop() {
  window.clearTimeout(popTimer);
  popTimer = window.setTimeout(() => {
    if (!armed || stack.length > 0) return;
    armed = false;
    window.history.back();
  }, 0);
}

function removeEntry(entry: LayerEntry) {
  const index = stack.indexOf(entry);
  if (index === -1) return;
  const wasTop = index === stack.length - 1;
  stack.splice(index, 1);
  if (!wasTop) return;
  if (stack.length > 0) {
    replaceIfArmed();
  } else {
    scheduleSentinelPop();
  }
}

function finishEntry(entry: LayerEntry) {
  if (entry.closed) return;
  entry.closed = true;
  removeEntry(entry);
  entry.onClose();
}

function onPopState() {
  if (!armed) return;
  // The user (or Android) went back over the guard entry. Close only the
  // layer that guard represented; anything below it stays open for the next
  // back press, which re-arms a fresh guard entry.
  armed = false;
  const entry = stack.pop();
  if (!entry) return;
  entry.closed = true;
  const next = stack[stack.length - 1];
  if (next) armEntry(next);
  entry.onClose();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== "Escape" || stack.length === 0) return;
  event.preventDefault();
  event.stopPropagation();
  finishEntry(stack[stack.length - 1]);
}

function ensureListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  window.addEventListener("popstate", onPopState);
  window.addEventListener("keydown", onKeyDown);
}

function addEntry(entry: LayerEntry) {
  ensureListeners();
  stack.push(entry);
  // If a guard entry already exists (another layer is open) replace its token
  // rather than stacking a second browser entry.
  if (armed) replaceIfArmed();
  else armEntry(entry);
}

/**
 * Registers a closeable layer. `active` controls whether the layer owns a
 * slot in the back stack; the returned callback is the single close path for
 * buttons, scrims and drag gestures.
 */
export function useLayerExit(
  active: boolean,
  onClose: () => void,
): () => void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const tokenRef = useRef("");
  if (!tokenRef.current) {
    layerToken += 1;
    tokenRef.current = `layer-${layerToken}`;
  }
  const entryRef = useRef<LayerEntry | null>(null);
  const cleanupTimer = useRef(0);

  const close = useCallback(() => {
    const entry = entryRef.current;
    if (!entry || entry.closed) return;
    finishEntry(entry);
  }, []);

  useEffect(() => {
    window.clearTimeout(cleanupTimer.current);
    if (!active) {
      const entry = entryRef.current;
      if (entry && !entry.closed) {
        entry.closed = true;
        removeEntry(entry);
      }
      entryRef.current = null;
      return;
    }
    if (entryRef.current?.closed) entryRef.current = null;
    const entry: LayerEntry = entryRef.current ?? {
      token: tokenRef.current,
      closed: false,
      onClose: () => onCloseRef.current(),
    };
    entryRef.current = entry;
    // StrictMode may replay this effect; only the first pass adds the layer.
    if (!stack.includes(entry)) addEntry(entry);
    return () => {
      // StrictMode mounts, cleans up and remounts immediately. Deferring the
      // removal lets the remount reuse the same guard entry.
      cleanupTimer.current = window.setTimeout(() => {
        const current = entryRef.current;
        if (!current || current.closed || current !== entry) return;
        current.closed = true;
        entryRef.current = null;
        removeEntry(current);
      }, 0);
    };
  }, [active]);

  return close;
}
