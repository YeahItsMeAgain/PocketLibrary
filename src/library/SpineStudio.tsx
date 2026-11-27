import { useCallback, useEffect, useRef, useState } from "react";

import {
  isApiError,
  platform,
  type SpineArtifact,
  type SpineStatus,
  type SpineStyle,
  type SpineVerdict,
} from "../platform";
import {
  STAGE_LABELS,
  useSpineActivity,
  type SpineBookState,
} from "./spineActivity";
import {
  prepareSpinePalette,
  renderSpineStrip,
  renderSpineStyle,
  SPINE_STRIP_SIZE,
  spineStyleSize,
  textDirection,
  type RenderBook,
} from "./spineRenderer";

/* --------------------------------------------------------------- styles */

export const SPINE_STYLES: ReadonlyArray<{
  id: SpineStyle;
  label: string;
  note: string;
}> = [
  {
    id: "wrap",
    label: "Wrap",
    note: "Page-count spine width. Back and spine are composed from the text-free art.",
  },
  {
    id: "full-bleed",
    label: "Full-bleed",
    note: "The crop edge to edge, with the title and author centred over a soft scrim.",
  },
  {
    id: "cloth",
    label: "Cloth",
    note: "Cloth colour sampled from the art, foil type, no art window.",
  },
];

/* --------------------------------------------------------- small views */

function SpineCanvas({
  book,
  style,
  strip = false,
  testId,
}: {
  book: RenderBook;
  style: SpineStyle;
  strip?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const size = strip ? SPINE_STRIP_SIZE : spineStyleSize(style, book);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = "high";
    ctx.clearRect(0, 0, size.width, size.height);
    const meta = strip
      ? renderSpineStrip(ctx, book, style)
      : renderSpineStyle(ctx, book, style);
    canvas.dataset.style = style;
    canvas.dataset.direction = meta.direction;
    canvas.dataset.scrim = String(meta.scrim);
    canvas.dataset.contrast = meta.contrast.toFixed(2);
    canvas.dataset.blockCx = meta.block.x.toFixed(2);
    canvas.dataset.blockCy = meta.block.y.toFixed(2);
    canvas.dataset.blockWidth = meta.block.width.toFixed(2);
    canvas.dataset.blockHeight = meta.block.height.toFixed(2);
    canvas.setAttribute("dir", meta.direction);
  }, [book, style, strip]);
  return <canvas ref={ref} data-testid={testId} />;
}

/* ------------------------------------------------------------ studio -- */

interface StudioProps {
  bookId: number;
  title: string;
  author: string;
  pages: number | null;
  /** The published cover, used for the wrap front; art alone if absent. */
  coverDataUrl?: string | null;
  /** Persisted style from `books.spine_style`; default Wrap. */
  initialStyle?: SpineStyle;
}

type StudioState =
  | { kind: "loading" }
  | { kind: "idle" }
  | { kind: "generating" }
  | { kind: "result"; artifact: SpineArtifact }
  | { kind: "error"; heading: string; message: string };

const VERDICT_LABELS: Record<SpineVerdict, string> = {
  pass: "Pass",
  review: "Review",
  fallback: "Fallback",
};

function engineLabel(status: SpineStatus): string {
  switch (status.models) {
    case "ready":
      return "Engine ready";
    case "bundled":
      return "Engine bundled";
    case "missing":
      return "Models missing";
    case "error":
      return "Engine error";
  }
}

function describeError(error: unknown): { heading: string; message: string } {
  if (isApiError(error)) {
    switch (error.code) {
      case "spine_models_missing":
      case "engine_models_missing":
      case "models_missing":
        return {
          heading: "Spine engine not installed",
          message:
            "The 41.2 MB model bundle is required for art spines. Install it from Settings → Spine, then try again. The cloth spine is unchanged.",
        };
      case "book_not_found":
        return {
          heading: "Book not available",
          message:
            "This book is no longer in the library, so there is nothing to work from.",
        };
      case "cover_missing":
        return {
          heading: "No cover to work from",
          message:
            "Add a cover for this book first. The spine is built from the cover art.",
        };
      default:
        return { heading: "Spine could not be generated", message: error.message };
    }
  }
  return {
    heading: "Spine could not be generated",
    message:
      "The on-device engine stopped before it finished. The cloth spine is unchanged; try again.",
  };
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

function cropTuple(
  artifact: SpineArtifact,
): [number, number, number, number] | null {
  const box = artifact.cropBox;
  if (!box) return null;
  return [box.x, box.y, box.width, box.height];
}

export function SpineStudio({
  bookId,
  title,
  author,
  pages,
  coverDataUrl,
  initialStyle,
}: StudioProps) {
  const { jobs: spineJobs, noteReady } = useSpineActivity();
  const job: SpineBookState | undefined = spineJobs[bookId];
  const [state, setState] = useState<StudioState>({ kind: "loading" });
  const [status, setStatus] = useState<SpineStatus | null>(null);
  const [style, setStyle] = useState<SpineStyle>(initialStyle ?? "wrap");
  const [prepared, setPrepared] = useState<RenderBook | null>(null);
  const [busy, setBusy] = useState(false);

  const chooseStyle = useCallback(
    (next: SpineStyle) => {
      setStyle(next);
      void platform.spineSetStyle(bookId, next).catch(() => {
        // The preview still switches; the next open retries persistence.
      });
    },
    [bookId],
  );

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    setPrepared(null);
    setStyle(initialStyle ?? "wrap");
    setStatus(null);
    // Opening a book must do zero engine work: only read the cache. Model
    // resolution (JNI asset extraction, ONNX Runtime) waits for Generate.
    platform
      .spineArtifact(bookId)
      .then((artifact) => {
        if (!alive) return;
        if (artifact) {
          setState({ kind: "result", artifact });
          if (artifact.verdict === "fallback") setStyle("cloth");
        } else {
          setState({ kind: "idle" });
        }
      })
      .catch((error: unknown) => {
        if (!alive) return;
        const described = describeError(error);
        setState({
          kind: "error",
          heading: described.heading,
          message: described.message,
        });
      });
    return () => {
      alive = false;
    };
  }, [bookId, initialStyle]);

  useEffect(() => {
    // A queued job that finishes while the sheet is open should appear without
    // a reopen. Manual generation already sets the result itself.
    if (job?.state !== "ready") return;
    let alive = true;
    platform
      .spineArtifact(bookId)
      .then((artifact) => {
        if (!alive || !artifact) return;
        setState((current) =>
          current.kind === "result" ? current : { kind: "result", artifact },
        );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [bookId, job?.state]);

  useEffect(() => {
    if (state.kind !== "result") {
      setPrepared(null);
      return;
    }
    let alive = true;
    const artifact = state.artifact;
    void (async () => {
      const [loadedArt, loadedCover] = await Promise.all([
        loadImage(artifact.artDataUrl),
        coverDataUrl ? loadImage(coverDataUrl) : Promise.resolve(null),
      ]);
      const art =
        loadedArt ??
        loadedCover ??
        (await loadImage(artifact.fallbackDataUrl));
      if (!alive) return;
      if (!art) {
        setState({
          kind: "error",
          heading: "Spine preview unavailable",
          message:
            "The generated art could not be decoded. Generate the spine again.",
        });
        return;
      }
      const book: RenderBook = {
        title,
        author,
        pages: pages && pages > 0 ? pages : 320,
        cropBox: cropTuple(artifact),
        art,
        source: loadedCover ?? art,
        verdict: artifact.verdict,
        route: artifact.route,
        palette: null,
        direction: textDirection(`${title} ${author}`),
      };
      prepareSpinePalette(book);
      setPrepared(book);
    })();
    return () => {
      alive = false;
    };
  }, [state, title, author, pages, coverDataUrl]);

  const generate = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setState({ kind: "generating" });
    try {
      // Status/model resolution is allowed here (never on mount). Running it
      // beside generation is safe because the backend resolves models
      // single-flight; a status failure must not block generation.
      const [artifact, nextStatus] = await Promise.all([
        platform.spineGenerate(bookId),
        platform.spineStatus().catch(() => null),
      ]);
      if (nextStatus) setStatus(nextStatus);
      if (artifact.verdict === "fallback") {
        setStyle("cloth");
        void platform.spineSetStyle(bookId, "cloth").catch(() => {});
      }
      setState({ kind: "result", artifact });
      noteReady(bookId, artifact);
    } catch (error) {
      const described = describeError(error);
      setState({
        kind: "error",
        heading: described.heading,
        message: described.message,
      });
    } finally {
      setBusy(false);
    }
  }, [bookId, busy, noteReady]);

  const engineReady =
    status === null ||
    status.models === "ready" ||
    status.models === "bundled";
  const engineProblem =
    status?.models === "missing"
      ? "The engine models are not installed yet. Install them from Settings → Spine. Until then the shelf keeps its cloth spines."
      : status?.models === "error"
        ? (status.error ??
          "The engine models could not be loaded. Reinstall the bundle from Settings → Spine.")
        : null;

  return (
    <section
      className="spine-studio"
      data-testid="spine-studio"
      aria-labelledby="spine-studio-title"
    >
      <header className="spine-studio-head">
        <h3 id="spine-studio-title">Spine</h3>
        {status ? (
          <span className="spine-engine" data-testid="spine-engine">
            {engineLabel(status)}
          </span>
        ) : null}
      </header>

      {job ? (
        <p
          className={`spine-book-state is-${job.state}`}
          data-testid="spine-book-state"
          data-state={job.state}
          data-stage={job.state === "working" ? job.stage : undefined}
        >
          {job.state === "waiting"
            ? "Waiting its turn."
            : job.state === "working"
              ? `Preparing spine · ${STAGE_LABELS[job.stage]}`
              : job.state === "ready"
                ? "Spine ready."
                : "Needs attention — the last attempt did not finish."}
        </p>
      ) : null}

      {state.kind === "loading" ? (
        <p className="spine-fine" role="status">
          Checking for an existing spine…
        </p>
      ) : null}

      {state.kind === "idle" ? (
        <div className="spine-intro">
          <p>
            Turn this cover into a text-free spine on the device. Three styles
            render from the same result; nothing is uploaded.
          </p>
          {engineProblem ? (
            <p className="spine-problem" role="status">
              {engineProblem}
            </p>
          ) : null}
          <button
            type="button"
            className="spine-generate"
            data-testid="spine-generate"
            disabled={!engineReady}
            onClick={() => void generate()}
          >
            Generate spine
          </button>
          <p className="spine-fine">
            Runs locally · 5–20 s on a phone · the shelf keeps its cloth spine
            meanwhile.
          </p>
        </div>
      ) : null}

      {state.kind === "generating" ? (
        <div
          className="spine-generating"
          data-testid="spine-generating"
          role="status"
          aria-live="polite"
        >
          <span className="spine-progress" aria-hidden="true">
            <i />
          </span>
          <p className="spine-generating-title">Working on the spine…</p>
          <p className="spine-fine">
            Finding cover text · Removing text · Checking result
          </p>
          <p className="spine-fine">
            This runs on your device. It takes 5–20 s on a phone; the shelf
            keeps its cloth spine until the result lands.
          </p>
        </div>
      ) : null}

      {state.kind === "error" ? (
        <div
          className="spine-error"
          data-testid="spine-error"
          role="alert"
        >
          <p className="spine-error-title">{state.heading}</p>
          <p>{state.message}</p>
          <button
            type="button"
            className="spine-generate"
            data-testid="spine-retry"
            disabled={busy || !engineReady}
            onClick={() => void generate()}
          >
            Try again
          </button>
        </div>
      ) : null}

      {state.kind === "result" ? (
        <div className="spine-result" data-testid="spine-result">
          <div className="spine-verdict-row">
            <span
              className={`spine-pill spine-pill--${state.artifact.verdict}`}
              data-testid="spine-verdict"
              data-verdict={state.artifact.verdict}
            >
              {VERDICT_LABELS[state.artifact.verdict]}
            </span>
            <span className="spine-meta" data-testid="spine-meta">
              Mask {state.artifact.maskPercent.toFixed(1)}% · Route{" "}
              {state.artifact.route}
            </span>
          </div>

          {state.artifact.pagesApproximate ? (
            <p className="spine-fine" data-testid="spine-approximate-note">
              Approximate spine width — no page count, so the wrap uses a
              ~320-page estimate.
            </p>
          ) : null}

          {state.artifact.verdict === "review" ? (
            <p className="spine-note" data-testid="spine-review-note">
              The check found art it cannot vouch for. Inspect the spine, then
              use Cloth if it reads as cover copy.{" "}
              <button
                type="button"
                className="spine-inline-action"
                data-testid="spine-use-cloth"
                onClick={() => chooseStyle("cloth")}
              >
                Use Cloth
              </button>
            </p>
          ) : state.artifact.verdict === "fallback" ? (
            <p className="spine-note" data-testid="spine-fallback-note">
              Cloth applied automatically. The wrap stays available as a
              preview below.
            </p>
          ) : (
            <p className="spine-fine" data-testid="spine-pass-note">
              Passed the on-device check. Wrap is applied by default.
            </p>
          )}

          {prepared ? (
            <>
              <div
                className={`spine-preview${style === "wrap" ? " is-wrap" : ""}`}
                data-testid="spine-preview"
                data-style={style}
              >
                <SpineCanvas
                  book={prepared}
                  style={style}
                  testId="spine-preview-canvas"
                />
              </div>
              <p className="spine-preview-caption">
                {SPINE_STYLES.find((entry) => entry.id === style)?.note}
              </p>
              <div
                className="spine-style-grid"
                data-testid="spine-style-grid"
                role="group"
                aria-label="Spine style"
              >
                {SPINE_STYLES.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="spine-style"
                    data-testid={`spine-style-${entry.id}`}
                    aria-pressed={style === entry.id}
                    onClick={() => chooseStyle(entry.id)}
                  >
                    <span className="spine-style-art">
                      <SpineCanvas
                        book={prepared}
                        style={entry.id}
                        testId={`spine-canvas-${entry.id}`}
                      />
                    </span>
                    <span className="spine-style-label">{entry.label}</span>
                  </button>
                ))}
              </div>
              <div className="spine-shelf" data-testid="spine-shelf">
                <div className="spine-shelf-art">
                  <SpineCanvas
                    book={prepared}
                    style={style}
                    strip
                    testId="spine-strip-canvas"
                  />
                </div>
                <p className="spine-shelf-copy">
                  <b>At shelf size</b>
                  52 × 236 spine · the shelf swaps to it when ready
                </p>
              </div>
              <p className="spine-fine">
                Switching styles re-renders the cached art; it does not run the
                engine again.
              </p>
            </>
          ) : (
            <p className="spine-fine" role="status">
              Preparing the spine preview…
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}
