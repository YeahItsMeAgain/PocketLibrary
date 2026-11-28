import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";

import { useLayerExit } from "../navigation";
import {
  READER_FONTS,
  READER_MARGINS,
  READER_SIZES,
  READER_SPACINGS,
  READER_THEMES,
  type ReaderSettings,
  type ReaderTheme,
} from "./settings";

/**
 * One close path for the reader: the desk's Shelf action, Escape and
 * Android/browser back all end here.
 *
 * The shared navigation guard owns the history entry, so the reader joins the
 * same one-layer-at-a-time stack as the drawer, detail and sheets instead of
 * competing with a second history system.
 */
export function useReaderExit(onClose: () => void): () => void {
  return useLayerExit(true, onClose);
}

const DESK_ID = "reader-desk";
const DESK_TITLE_ID = "reader-desk-title";

/** Milliseconds the dismiss animation takes before the sheet unmounts. */
const DISMISS_MS = 250;
/** Share of the finger's downward travel the sheet follows. */
const DRAG_RATIO = 0.85;
const DRAG_DISMISS_PX = 64;
const DRAG_VELOCITY = 0.35;
const DRAG_VELOCITY_MIN_PX = 16;
const DRAG_START_PX = 6;
const TOUCH_START_PX = 8;

/**
 * Whether the "Swipe down to close" hint has been retired for this session.
 * It retires after the first successful swipe, as the lab specified, and is
 * deliberately not persisted.
 */
let deskHintSeen = false;

export interface ReaderPullProps {
  /** Fraction read, 0..1. */
  progress: number;
  /** Small-caps readout, e.g. "42%". */
  percentLabel: string;
  /** Whether the reading desk is open (the pull reports it as expanded). */
  expanded: boolean;
  onOpen: () => void;
  buttonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * The closed-state chrome: a paper dock band with the library's brass drawer
 * plate at centre, the reading percentage at the right and a 3px progress
 * hairline along the floor. The pull and the percentage are the only two ways
 * into the reading desk.
 */
export function ReaderPull({
  progress,
  percentLabel,
  expanded,
  onOpen,
  buttonRef,
}: ReaderPullProps) {
  const percent = Math.max(0, Math.min(100, progress * 100));
  return (
    <div className="reader-dock" data-testid="reader-dock">
      <button
        ref={buttonRef}
        type="button"
        className="reader-pull"
        data-testid="reader-pull"
        aria-label="Open the reading desk"
        aria-expanded={expanded}
        aria-controls={DESK_ID}
        onClick={onOpen}
      >
        <span className="reader-pull-plate" aria-hidden="true">
          <span className="reader-pull-slot" />
        </span>
      </button>
      <button
        type="button"
        className="reader-percent"
        data-testid="reader-persistent-percent"
        aria-label={`Open the reading desk, ${Math.round(percent)} percent`}
        aria-expanded={expanded}
        aria-controls={DESK_ID}
        onClick={onOpen}
      >
        <span data-testid="reader-progress">{percentLabel}</span>
      </button>
      <div
        className="reader-dock-track"
        data-testid="reader-persistent-progress"
        role="progressbar"
        aria-label="Reading progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(percent)}
      >
        <span
          className="reader-dock-fill"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

export interface DeskTab {
  id: string;
  label: string;
}

export interface ReaderDeskProps {
  /** Book title in the display serif. */
  title: string;
  /** Small-caps readout beside the title, e.g. "42% · page 5 of 18". */
  meta: string;
  tabs: ReadonlyArray<DeskTab>;
  activeTab: string;
  onTabChange: (id: string) => void;
  /** Quiet ledger line for the footer. */
  summary: string;
  /** The single close path (the navigation layer's guarded close). */
  onClose: () => void;
  onShelf: () => void;
  /** Focus returns here when the desk closes. */
  returnFocusRef?: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}

interface DragSample {
  t: number;
  y: number;
}

interface DragState {
  y0: number;
  active: boolean;
  onControl: boolean;
  fromBody: boolean;
  samples: DragSample[];
}

function canFocus(element: Element): boolean {
  if (element.hasAttribute("disabled")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  return true;
}

/**
 * The 48dvh reading desk: grip, header, tabs, scrolling body and a quiet
 * summary footer. It is mounted only while open, so the entrance animation
 * plays on open, Escape/back travel through the shared layer stack, and focus
 * returns to the pull on every close path.
 *
 * Swipe down closes from the grip, the header, or the body while it is at its
 * top; the sheet follows at 0.85x and either dismisses past 64px (or 0.35px/ms)
 * or springs back. Scrolled body drags keep scrolling.
 */
export function ReaderDesk({
  title,
  meta,
  tabs,
  activeTab,
  onTabChange,
  summary,
  onClose,
  onShelf,
  returnFocusRef,
  children,
}: ReaderDeskProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const onTabChangeRef = useRef(onTabChange);
  onTabChangeRef.current = onTabChange;
  const dismissingRef = useRef(false);
  const [dismissing, setDismissing] = useState(false);
  const [hintSeen, setHintSeen] = useState(deskHintSeen);

  dismissingRef.current = dismissing;

  // Focus the close control on open and return it to the pull on close. The
  // pull is only refocused when it is still in the document: leaving the
  // reader unmounts both in one commit.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      closeRef.current?.focus({ preventScroll: true });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      const target = returnFocusRef?.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
    // The desk mounts once per open; the ref objects are stable.
  }, [returnFocusRef]);

  const changeTab = useCallback((id: string) => {
    onTabChangeRef.current(id);
    bodyRef.current?.scrollTo({ top: 0 });
  }, []);

  // Pointer and touch swipe-to-close. Native listeners: touchmove must be
  // non-passive so an active downward pull can take the gesture away from the
  // scrolling body.
  useEffect(() => {
    const layer = layerRef.current;
    const sheet = sheetRef.current;
    const body = bodyRef.current;
    const scrim = scrimRef.current;
    if (!layer || !sheet) return;

    let drag: DragState | null = null;
    let touchDrag: DragState | null = null;
    let suppressClick = false;
    let suppressTimer = 0;
    let springTimer = 0;
    let dismissTimer = 0;

    const canDrag = (target: EventTarget | null): boolean => {
      if (dismissingRef.current) return false;
      if (!(target instanceof Node) || !sheet.contains(target)) return false;
      if (
        target instanceof Element &&
        target.closest("input, select, textarea")
      ) {
        return false;
      }
      if (body && body.contains(target) && body.scrollTop > 0) return false;
      return true;
    };

    const applyDrag = (dy: number) => {
      const height = Math.max(1, sheet.offsetHeight);
      const distance = Math.min(Math.max(0, dy * DRAG_RATIO), height);
      layer.classList.add("is-dragging");
      sheet.style.setProperty("--reader-drag", `${Math.round(distance)}px`);
      if (scrim) {
        scrim.style.opacity = String(
          Math.max(0.08, 1 - distance / (height * 0.9)),
        );
      }
    };

    const clearDragStyles = () => {
      layer.classList.remove("is-dragging");
      sheet.style.removeProperty("--reader-drag");
      if (scrim) scrim.style.removeProperty("opacity");
    };

    const springBack = () => {
      layer.classList.remove("is-dragging");
      sheet.style.setProperty("--reader-drag", "0px");
      if (scrim) scrim.style.opacity = "1";
      window.clearTimeout(springTimer);
      window.clearTimeout(dismissTimer);
      springTimer = window.setTimeout(() => {
        if (dismissingRef.current) return;
        if (layer.classList.contains("is-dragging")) return;
        sheet.style.removeProperty("--reader-drag");
        if (scrim) scrim.style.removeProperty("opacity");
      }, 280);
    };

    const velocity = (samples: DragSample[]): number => {
      if (samples.length === 0) return 0;
      const now = performance.now();
      let first = samples[0];
      for (let index = samples.length - 1; index >= 0; index -= 1) {
        if (samples[index].t >= now - 150) {
          first = samples[index];
          break;
        }
      }
      const last = samples[samples.length - 1];
      const elapsed = last.t - first.t;
      return elapsed > 10 ? (last.y - first.y) / elapsed : 0;
    };

    const shouldDismiss = (dy: number, speed: number): boolean =>
      dy >= DRAG_DISMISS_PX ||
      (dy > DRAG_VELOCITY_MIN_PX && speed >= DRAG_VELOCITY);

    const dismiss = () => {
      dismissingRef.current = true;
      setDismissing(true);
      deskHintSeen = true;
      setHintSeen(true);
      layer.classList.remove("is-dragging");
      sheet.style.setProperty("--reader-drag", "102%");
      if (scrim) scrim.style.opacity = "0";
      window.clearTimeout(springTimer);
      window.clearTimeout(dismissTimer);
      dismissTimer = window.setTimeout(() => {
        onCloseRef.current();
      }, DISMISS_MS);
    };

    const pushSample = (state: DragState, y: number) => {
      state.samples.push({ t: performance.now(), y });
      if (state.samples.length > 8) state.samples.shift();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      if (!canDrag(event.target)) return;
      const target = event.target as Element;
      const onControl = Boolean(
        target.closest("button, a, [role='tab'], [role='button']"),
      );
      if (!onControl) event.preventDefault();
      drag = {
        y0: event.clientY,
        active: false,
        onControl,
        fromBody: Boolean(body?.contains(target)),
        samples: [{ t: performance.now(), y: event.clientY }],
      };
    };

    const onPointerMove = (event: PointerEvent) => {
      if (!drag) return;
      const dy = event.clientY - drag.y0;
      if (!drag.active) {
        if (dy < DRAG_START_PX) return;
        drag.active = true;
        if (drag.onControl) {
          suppressClick = true;
          window.clearTimeout(suppressTimer);
          suppressTimer = window.setTimeout(() => {
            suppressClick = false;
          }, 400);
        }
      }
      pushSample(drag, event.clientY);
      applyDrag(dy);
    };

    const onPointerUp = (event: PointerEvent) => {
      if (!drag) return;
      const state = drag;
      drag = null;
      if (!state.active) return;
      const dy = event.clientY - state.y0;
      if (shouldDismiss(dy, velocity(state.samples))) dismiss();
      else springBack();
    };

    const onPointerCancel = () => {
      if (!drag) return;
      drag = null;
      springBack();
    };

    const onSuppressClick = (event: MouseEvent) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || !canDrag(event.target)) return;
      const touch = event.touches[0];
      touchDrag = {
        y0: touch.clientY,
        active: false,
        onControl: Boolean(
          (event.target as Element)?.closest?.(
            "button, a, [role='tab'], [role='button']",
          ),
        ),
        fromBody: Boolean(body?.contains(event.target as Node)),
        samples: [{ t: performance.now(), y: touch.clientY }],
      };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!touchDrag || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const dy = touch.clientY - touchDrag.y0;
      if (!touchDrag.active) {
        if (dy < TOUCH_START_PX) return;
        if (touchDrag.fromBody && body && body.scrollTop > 0) {
          touchDrag = null;
          return;
        }
        touchDrag.active = true;
      }
      if (event.cancelable) event.preventDefault();
      pushSample(touchDrag, touch.clientY);
      applyDrag(dy);
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (!touchDrag) return;
      const state = touchDrag;
      touchDrag = null;
      if (!state.active) return;
      const touch = event.changedTouches[0];
      const dy = (touch?.clientY ?? state.y0) - state.y0;
      if (shouldDismiss(dy, velocity(state.samples))) dismiss();
      else springBack();
    };

    const onTouchCancel = () => {
      if (!touchDrag) return;
      touchDrag = null;
      springBack();
    };

    sheet.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("click", onSuppressClick, true);
    sheet.addEventListener("touchstart", onTouchStart, { passive: true });
    sheet.addEventListener("touchmove", onTouchMove, { passive: false });
    sheet.addEventListener("touchend", onTouchEnd, { passive: true });
    sheet.addEventListener("touchcancel", onTouchCancel, { passive: true });

    return () => {
      window.clearTimeout(suppressTimer);
      window.clearTimeout(springTimer);
      window.clearTimeout(dismissTimer);
      sheet.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("click", onSuppressClick, true);
      sheet.removeEventListener("touchstart", onTouchStart);
      sheet.removeEventListener("touchmove", onTouchMove);
      sheet.removeEventListener("touchend", onTouchEnd);
      sheet.removeEventListener("touchcancel", onTouchCancel);
      clearDragStyles();
    };
  }, []);

  const onSheetKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const sheet = sheetRef.current;
    if (!sheet) return;
    const focusable = Array.from(
      sheet.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element) => {
      if (!canFocus(element)) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    });
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const onTabKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const next = tabs[(index + step + tabs.length) % tabs.length];
    changeTab(next.id);
    document
      .getElementById(`${DESK_ID}-tab-${next.id}`)
      ?.focus({ preventScroll: true });
  };

  return (
    <div className="reader-desk-layer" ref={layerRef} data-testid="reader-desk-layer">
      <button
        ref={scrimRef}
        type="button"
        className="reader-desk-scrim"
        data-testid="reader-desk-scrim"
        aria-label="Close the reading desk"
        tabIndex={-1}
        onClick={() => onCloseRef.current()}
      />
      <section
        ref={sheetRef}
        id={DESK_ID}
        className="reader-desk"
        role="dialog"
        aria-modal="true"
        aria-labelledby={DESK_TITLE_ID}
        data-testid="reader-desk"
        data-dismissing={dismissing || undefined}
        onKeyDown={onSheetKeyDown}
      >
        <div className="reader-desk-grip" aria-hidden="true">
          <span className="reader-desk-grip-bar" />
          <span
            className={`reader-desk-hint${hintSeen ? " is-gone" : ""}`}
            data-testid="reader-desk-hint"
          >
            Swipe down to close
          </span>
        </div>
        <header className="reader-desk-head">
          <button
            type="button"
            className="reader-desk-shelf"
            data-testid="reader-shelf"
            aria-label="Back to shelf"
            onClick={onShelf}
          >
            <span aria-hidden="true" className="reader-desk-glyph">
              ←
            </span>
            <span className="reader-desk-shelf-text" aria-hidden="true">
              Shelf
            </span>
          </button>
          <div className="reader-desk-heading">
            <h2 className="reader-desk-title" id={DESK_TITLE_ID}>
              {title}
            </h2>
            <span className="reader-desk-meta" data-testid="reader-desk-meta">
              {meta}
            </span>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="reader-desk-close"
            data-testid="reader-desk-close"
            aria-label="Close the reading desk"
            onClick={() => onCloseRef.current()}
          >
            ×
          </button>
        </header>
        <div
          className="reader-desk-tabs"
          role="tablist"
          aria-label="Reading controls"
        >
          {tabs.map((tab, index) => {
            const selected = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                id={`${DESK_ID}-tab-${tab.id}`}
                aria-selected={selected}
                aria-controls={`${DESK_ID}-panel-${tab.id}`}
                tabIndex={selected ? 0 : -1}
                data-testid={`reader-desk-tab-${tab.id}`}
                onClick={() => changeTab(tab.id)}
                onKeyDown={(event) => onTabKeyDown(event, index)}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
        <div className="reader-desk-body" ref={bodyRef} data-testid="reader-desk-body">
          <div
            className="reader-desk-panel"
            id={`${DESK_ID}-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`${DESK_ID}-tab-${activeTab}`}
            data-testid={`reader-desk-panel-${activeTab}`}
          >
            {children}
          </div>
        </div>
        <footer className="reader-desk-summary" data-testid="reader-desk-summary">
          {summary}
        </footer>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------ type panel */

const THEME_ORDER: ReaderTheme[] = ["paper", "sepia", "night"];

export function themeName(theme: ReaderTheme): string {
  return READER_THEMES[theme].name;
}

interface ReaderThemeRowProps {
  value: ReaderTheme;
  onChange: (theme: ReaderTheme) => void;
}

/** Three printed paper swatches; the selected one keeps a brass inset ring. */
export function ReaderThemeRow({ value, onChange }: ReaderThemeRowProps) {
  return (
    <div className="reader-theme-row" role="group" aria-label="Theme">
      {THEME_ORDER.map((id) => {
        const palette = READER_THEMES[id];
        return (
          <button
            key={id}
            type="button"
            className="reader-theme-swatch"
            data-testid={`reader-theme-${id}`}
            aria-pressed={value === id}
            style={
              {
                "--sw-paper": palette.paper,
                "--sw-ink": palette.ink,
                "--sw-accent": palette.accent,
              } as CSSProperties
            }
            onClick={() => onChange(id)}
          >
            {palette.name}
          </button>
        );
      })}
    </div>
  );
}

/** The first line of the sample book, used as the live typeface specimen. */
export const TYPE_SPECIMEN = "The lamp was lit before the rain began.";

interface ReaderTypePanelProps {
  settings: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  /** The quiet "Open in another app" route lives at the foot of the panel. */
  onOpenExternally?: () => void;
}

/**
 * The reading desk's TYPE panel: one brass two-state mode switch, a live size
 * stepper, printed theme swatches, spacing and margin previews, three typeface
 * specimen rows and a quiet ledger footer. It writes the existing
 * ReaderSettings record; it is a new surface, not a new settings model.
 */
export function ReaderTypePanel({
  settings,
  onChange,
  onOpenExternally,
}: ReaderTypePanelProps) {
  const size = READER_SIZES[settings.size] ?? READER_SIZES[2];
  const font = READER_FONTS.find((entry) => entry.id === settings.font) ?? READER_FONTS[0];
  const canShrink = settings.size > 0;
  const canGrow = settings.size < READER_SIZES.length - 1;

  return (
    <div className="reader-type-panel" data-testid="reader-type-panel">
      <div className="reader-desk-row">
        <div className="reader-desk-block">
          <span className="reader-desk-cap">Reading</span>
          <div
            className="reader-mode-switch"
            data-mode={settings.mode}
            role="group"
            aria-label="Reading mode"
          >
            <button
              type="button"
              data-testid="reader-mode-paginated"
              aria-pressed={settings.mode === "paginated"}
              onClick={() => onChange({ mode: "paginated" })}
            >
              Paged
            </button>
            <button
              type="button"
              data-testid="reader-mode-scrolled"
              aria-pressed={settings.mode === "scrolled"}
              onClick={() => onChange({ mode: "scrolled" })}
            >
              Scroll
            </button>
          </div>
        </div>
        <div className="reader-desk-block">
          <span className="reader-desk-cap">
            Size{" "}
            <span className="reader-cap-value" data-testid="reader-size-px">
              {size.px} px
            </span>
          </span>
          <div className="reader-size-stepper" role="group" aria-label="Text size">
            <button
              type="button"
              className="reader-step"
              data-testid="reader-size-down"
              aria-label="Smaller text"
              disabled={!canShrink}
              onClick={() => onChange({ size: Math.max(0, settings.size - 1) })}
            >
              −
            </button>
            <span
              className="reader-size-specimen"
              data-testid="reader-size-specimen"
              aria-hidden="true"
              style={{ fontSize: `${size.px}px`, fontFamily: `'${font.family}', serif` }}
            >
              Aa
            </span>
            <button
              type="button"
              className="reader-step"
              data-testid="reader-size-up"
              aria-label="Larger text"
              disabled={!canGrow}
              onClick={() =>
                onChange({
                  size: Math.min(READER_SIZES.length - 1, settings.size + 1),
                })
              }
            >
              +
            </button>
          </div>
        </div>
      </div>

      <div className="reader-desk-block">
        <span className="reader-desk-cap">Theme</span>
        <ReaderThemeRow value={settings.theme} onChange={(theme) => onChange({ theme })} />
      </div>

      <div className="reader-desk-row reader-desk-row-secondary">
        <div className="reader-desk-block">
          <span className="reader-desk-cap">Spacing</span>
          <div className="reader-density-row" role="group" aria-label="Line spacing">
            {READER_SPACINGS.map((entry, index) => (
              <button
                key={entry.name}
                type="button"
                className="reader-density"
                data-testid={`reader-spacing-${index}`}
                aria-pressed={settings.spacing === index}
                aria-label={entry.name}
                onClick={() => onChange({ spacing: index })}
              >
                <span
                  className="reader-density-lines"
                  aria-hidden="true"
                  style={{ "--pitch": `${Math.round(entry.value * 4.5)}px` } as CSSProperties}
                >
                  <i />
                  <i />
                  <i />
                </span>
                <span className="reader-density-cap">{entry.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="reader-desk-block">
          <span className="reader-desk-cap">Margins</span>
          <div className="reader-margin-row" role="group" aria-label="Margins">
            {READER_MARGINS.map((entry, index) => (
              <button
                key={entry.name}
                type="button"
                className="reader-margin"
                data-testid={`reader-margin-${index}`}
                aria-pressed={settings.margin === index}
                aria-label={entry.name}
                onClick={() => onChange({ margin: index })}
              >
                <span
                  className="reader-margin-page"
                  aria-hidden="true"
                  style={{ "--m-in": index === 0 ? "8%" : "18%" } as CSSProperties}
                >
                  <span className="reader-margin-text">
                    <i />
                    <i />
                    <i />
                  </span>
                </span>
                <span className="reader-margin-cap">{entry.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="reader-desk-block">
        <span className="reader-desk-cap">Typeface</span>
        <div className="reader-face-list" role="group" aria-label="Typeface">
          {READER_FONTS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="reader-face-row"
              data-testid={`reader-font-${entry.id}`}
              aria-pressed={settings.font === entry.id}
              onClick={() => onChange({ font: entry.id })}
            >
              <span
                className="reader-face-spec"
                style={{ fontFamily: `'${entry.family}', serif` }}
              >
                {TYPE_SPECIMEN}
              </span>
              <span className="reader-face-name">{entry.name}</span>
            </button>
          ))}
        </div>
      </div>

      {onOpenExternally ? (
        <button
          type="button"
          className="reader-quiet-action"
          data-testid="reader-external"
          onClick={onOpenExternally}
        >
          <span aria-hidden="true">↗</span> Open in another app
        </button>
      ) : null}
    </div>
  );
}
