import { useCallback, useEffect, useMemo, useState } from "react";

import {
  isApiError,
  platform,
  type BookDetail,
  type CoverChoices,
  type CoverOption,
} from "../platform";
import { useLayerExit } from "../navigation";
import { useSpineActivity } from "./spineActivity";

interface CoverChooserProps {
  bookId: number;
  bookTitle: string;
  onClose: () => void;
  onChanged: (detail: BookDetail) => void;
}

interface DeviceChoice {
  token: string;
  option: CoverOption;
  warning: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  embedded: "Embedded cover",
  rendered: "Rendered cover",
  generated: "Generated plate",
  open_library: "Open Library",
  internet_archive: "Internet Archive",
  device: "This device",
};

function sourceLabel(option: CoverOption): string {
  return SOURCE_LABELS[option.source] ?? option.source;
}

function optionAria(option: CoverOption): string {
  const base = option.isCurrent
    ? `Current cover, ${sourceLabel(option)}`
    : `Preview ${sourceLabel(option)} cover: ${option.label}`;
  return option.detail ? `${base}. ${option.detail}` : base;
}

export function CoverChooser({
  bookId,
  bookTitle,
  onClose,
  onChanged,
}: CoverChooserProps) {
  const [choices, setChoices] = useState<CoverChoices | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [device, setDevice] = useState<DeviceChoice | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const close = useLayerExit(true, onClose);
  const { enqueue: enqueueSpine } = useSpineActivity();

  useEffect(() => {
    let alive = true;
    platform
      .coverChoices(bookId)
      .then((next) => {
        if (!alive) return;
        setChoices(next);
        setSelectedKey(next.current?.key ?? next.original.key);
      })
      .catch((error) => {
        if (!alive) return;
        setNotice(
          isApiError(error)
            ? error.message
            : "The cover choices could not be opened just now.",
        );
      });
    return () => {
      alive = false;
    };
  }, [bookId]);

  const options = useMemo(() => {
    if (!choices) return [] as CoverOption[];
    return [
      ...(choices.current ? [choices.current] : []),
      ...(choices.original.key === choices.current?.key
        ? []
        : [choices.original]),
      ...choices.online,
      ...(device ? [device.option] : []),
    ];
  }, [choices, device]);

  const selected =
    options.find((option) => option.key === selectedKey) ?? null;
  const warning = device && selected?.key === device.option.key
    ? device.warning
    : (selected?.warning ?? null);
  const isCurrent = selected?.isCurrent ?? false;

  const pick = useCallback((option: CoverOption) => {
    setSelectedKey(option.key);
    setAcknowledged(false);
    setNotice(null);
  }, []);

  const findCovers = useCallback(async () => {
    setLookupBusy(true);
    setNotice(null);
    try {
      const outcome = await platform.lookupCoverCandidates(bookId);
      if (outcome.state === "found") {
        setChoices((current) =>
          current ? { ...current, online: outcome.candidates } : current,
        );
        if (outcome.candidates.length > 0) {
          setSelectedKey(outcome.candidates[0].key);
          setAcknowledged(false);
        } else {
          setNotice("No online cover matched this edition.");
        }
      } else if (outcome.state === "unavailable") {
        setNotice(outcome.message);
      } else if (outcome.state === "noMatch") {
        setNotice("No online cover matched this edition.");
      }
    } catch (error) {
      setNotice(
        isApiError(error)
          ? error.message
          : "Open Library could not answer just now. The current cover is unchanged.",
      );
    } finally {
      setLookupBusy(false);
    }
  }, [bookId]);

  const chooseFromDevice = useCallback(async () => {
    setNotice(null);
    try {
      const preview = await platform.chooseDeviceCover(bookId);
      if (!preview) return;
      const option: CoverOption = {
        key: `device:${preview.token}`,
        source: "device",
        label: "Cover chosen from this device",
        detail: `${preview.width} × ${preview.height} image, kept on this device.`,
        previewDataUrl: preview.previewDataUrl,
        isCurrent: false,
        isOriginal: false,
        warning: preview.warning ?? undefined,
      };
      setDevice({
        token: preview.token,
        option,
        warning: preview.warning,
      });
      setSelectedKey(option.key);
      setAcknowledged(false);
    } catch (error) {
      setNotice(
        isApiError(error)
          ? error.message
          : "That image could not be used. The current cover is unchanged.",
      );
    }
  }, [bookId]);

  const useSelected = useCallback(async () => {
    if (!selected || isCurrent || !selected.previewDataUrl) return;
    setApplyBusy(true);
    setNotice(null);
    try {
      if (selected.key === device?.option.key) {
        await platform.applyDeviceCover(bookId, device.token, acknowledged);
      } else {
        await platform.applyCoverChoice(bookId, selected, acknowledged);
      }
      const detail = await platform.getBookDetail(bookId);
      onChanged(detail);
      enqueueSpine([bookId]);
      close();
    } catch (error) {
      if (isApiError(error) && error.code === "cover_needs_acknowledgement") {
        setNotice(error.message);
      } else {
        setNotice(
          isApiError(error)
            ? error.message
            : "That cover could not be saved. The old cover is unchanged.",
        );
      }
    } finally {
      setApplyBusy(false);
    }
  }, [selected, isCurrent, device, bookId, acknowledged, onChanged, close, enqueueSpine]);

  const reset = useCallback(async () => {
    setApplyBusy(true);
    setNotice(null);
    try {
      await platform.resetCover(bookId);
      const detail = await platform.getBookDetail(bookId);
      onChanged(detail);
      enqueueSpine([bookId]);
      close();
    } catch (error) {
      setNotice(
        isApiError(error)
          ? error.message
          : "The original cover could not be restored just now.",
      );
    } finally {
      setApplyBusy(false);
    }
  }, [bookId, onChanged, close, enqueueSpine]);

  const groups = choices
    ? [
        {
          id: "current",
          title: "Current",
          options: choices.current ? [choices.current] : [],
        },
        {
          id: "book",
          title: "From this book",
          options:
            choices.original.key === choices.current?.key
              ? []
              : [choices.original],
        },
      ]
    : [];
  const onlineGroup = choices?.online ?? [];

  return (
    <>
      <button
        type="button"
        className="cover-sheet-scrim"
        aria-label="Close cover chooser"
        onClick={close}
      />
      <section
        className="cover-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cover-sheet-title"
        data-testid="cover-chooser"
      >
        <div className="cover-sheet-head">
          <div>
            <p className="cover-sheet-kicker">The jacket</p>
            <h2 id="cover-sheet-title">Choose a cover</h2>
            <p className="cover-sheet-book">{bookTitle}</p>
          </div>
          <button
            type="button"
            className="cover-sheet-close"
            aria-label="Close cover chooser"
            onClick={close}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="cover-sheet-preview" data-testid="cover-preview">
          {selected?.previewDataUrl ? (
            <img src={selected.previewDataUrl} alt={optionAria(selected)} />
          ) : (
            <div className="cover-sheet-placeholder" aria-hidden="true">
              <span>No preview</span>
            </div>
          )}
        </div>
        {selected ? (
          <p className="cover-sheet-selected" data-testid="cover-selected">
            <strong>{selected.label}</strong>
            <span>
              {sourceLabel(selected)}
              {selected.detail ? ` · ${selected.detail}` : ""}
            </span>
          </p>
        ) : null}

        <div className="cover-sheet-body">
          {groups.map((group) => (
            <section
              key={group.id}
              className="cover-sheet-group"
              aria-labelledby={`cover-group-${group.id}`}
            >
              <h3 id={`cover-group-${group.id}`}>{group.title}</h3>
              {group.options.length > 0 ? (
                <div className="cover-candidates">
                  {group.options.map((option) => (
                    <CoverTile
                      key={option.key}
                      option={option}
                      selected={selectedKey === option.key}
                      onPick={pick}
                    />
                  ))}
                </div>
              ) : (
                <p className="cover-sheet-empty">No file cover was found.</p>
              )}
            </section>
          ))}

          <section
            className="cover-sheet-group"
            aria-labelledby="cover-group-online"
          >
            <h3 id="cover-group-online">From Open Library</h3>
            {onlineGroup.length > 0 ? (
              <div className="cover-candidates">
                {onlineGroup.map((option) => (
                  <CoverTile
                    key={option.key}
                    option={option}
                    selected={selectedKey === option.key}
                    onPick={pick}
                  />
                ))}
              </div>
            ) : (
              <p className="cover-sheet-empty">
                Look up covers only when you ask; opening this sheet sends
                nothing.
              </p>
            )}
            <div className="cover-sheet-actions">
              <button
                type="button"
                className="secondary-action"
                data-testid="cover-find"
                disabled={lookupBusy}
                onClick={() => void findCovers()}
              >
                {lookupBusy
                  ? "Looking up covers…"
                  : onlineGroup.length > 0
                    ? "Find more covers"
                    : "Find covers"}
              </button>
            </div>
          </section>

          <section
            className="cover-sheet-group"
            aria-labelledby="cover-group-device"
          >
            <h3 id="cover-group-device">From this device</h3>
            {device ? (
              <div className="cover-candidates">
                <CoverTile
                  option={device.option}
                  selected={selectedKey === device.option.key}
                  onPick={pick}
                />
              </div>
            ) : (
              <p className="cover-sheet-empty">
                Pick a scan or photograph with the system image picker. It stays
                on this device.
              </p>
            )}
            <div className="cover-sheet-actions">
              <button
                type="button"
                className="secondary-action"
                data-testid="cover-device"
                disabled={applyBusy}
                onClick={() => void chooseFromDevice()}
              >
                {device ? "Choose another image…" : "Choose from device…"}
              </button>
            </div>
          </section>

          {warning ? (
            <p className="cover-sheet-warning" role="alert">
              {warning}
            </p>
          ) : null}
          {notice ? (
            <p
              className="cover-sheet-notice"
              role="status"
              data-testid="cover-notice"
            >
              {notice}
            </p>
          ) : null}
        </div>

        <div className="cover-sheet-footer">
          {warning ? (
            <label className="cover-sheet-ack">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              <span>Use this low-resolution or landscape image anyway</span>
            </label>
          ) : null}
          <button
            type="button"
            className="primary-action"
            data-testid="cover-use"
            disabled={!selected || isCurrent || applyBusy || (warning !== null && !acknowledged)}
            onClick={() => void useSelected()}
          >
            {applyBusy
              ? "Saving cover…"
              : isCurrent
                ? "Current cover"
                : "Use this cover"}
          </button>
          <button
            type="button"
            className="settings-back"
            data-testid="cover-reset"
            disabled={applyBusy}
            onClick={() => void reset()}
          >
            {choices?.original.source === "generated"
              ? "Use generated plate"
              : "Reset to original cover"}
          </button>
          <button
            type="button"
            className="settings-back"
            data-testid="cover-cancel"
            disabled={applyBusy}
            onClick={close}
          >
            Cancel
          </button>
        </div>
      </section>
    </>
  );
}

function CoverTile({
  option,
  selected,
  onPick,
}: {
  option: CoverOption;
  selected: boolean;
  onPick: (option: CoverOption) => void;
}) {
  return (
    <button
      type="button"
      className={`cover-candidate${selected ? " is-selected" : ""}${
        option.isCurrent ? " is-current" : ""
      }`}
      aria-pressed={selected}
      aria-label={optionAria(option)}
      data-testid={`cover-option-${option.key.replace(/[^a-z0-9]+/gi, "-")}`}
      onClick={() => onPick(option)}
    >
      <span className="cover-candidate-art">
        {option.previewDataUrl ? (
          <img src={option.previewDataUrl} alt="" loading="lazy" />
        ) : (
          <span className="cover-candidate-blank" aria-hidden="true">
            ?
          </span>
        )}
      </span>
      <span className="cover-candidate-meta">
        <span className="cover-candidate-label">{option.label}</span>
        <span className="cover-candidate-source">
          {sourceLabel(option)}
          {option.isCurrent ? " · Current" : ""}
        </span>
        {option.detail ? (
          <span className="cover-candidate-detail">{option.detail}</span>
        ) : null}
      </span>
    </button>
  );
}
