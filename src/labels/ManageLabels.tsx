import { useCallback, useEffect, useRef, useState } from "react";

import { LABEL_PALETTE, isApiError, platform, type LabelUsage } from "../platform";
import { useLayerExit } from "../navigation";

interface ManageLabelsProps {
  onClose: () => void;
  onChanged: () => void;
}

export function ManageLabels({ onClose, onChanged }: ManageLabelsProps) {
  const [labels, setLabels] = useState<LabelUsage[] | null>(null);
  const [name, setName] = useState("");
  const [colour, setColour] = useState(LABEL_PALETTE[0].colour);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useLayerExit(true, onClose);

  const refresh = useCallback(async () => {
    try {
      setLabels(await platform.listLabels());
    } catch {
      setError("Labels could not be loaded. Please try again.");
    }
  }, []);

  useEffect(() => {
    void refresh();
    closeRef.current?.focus();
  }, [refresh]);

  async function run(task: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await task();
      await refresh();
      onChanged();
    } catch (caught) {
      setError(
        isApiError(caught)
          ? caught.message
          : "That label change could not be saved. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="detail-scrim"
        aria-label="Close label manager"
        onClick={close}
      />
      <section
        className="book-detail manage-labels"
        role="dialog"
        aria-modal="true"
        aria-labelledby="manage-labels-title"
        data-testid="manage-labels-panel"
      >
        <button
          ref={closeRef}
          type="button"
          className="detail-close"
          aria-label="Close label manager"
          onClick={close}
        >
          <span aria-hidden="true">×</span>
        </button>
        <p className="kicker">The Label Drawer</p>
        <h2 id="manage-labels-title">Manage labels</h2>
        <p className="manage-note">
          Labels group books without moving them. Deleting a label never
          deletes a book.
        </p>

        <form
          className="label-create"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            void run(async () => {
              await platform.createLabel(name, colour);
              setName("");
            });
          }}
        >
          <label htmlFor="new-label-name">New label</label>
          <input
            id="new-label-name"
            data-testid="label-name"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Gothic"
          />
          <div className="label-palette" role="group" aria-label="Label colour">
            {LABEL_PALETTE.map((entry) => (
              <button
                key={entry.colour}
                type="button"
                className={`label-palette-swatch${
                  colour === entry.colour ? " is-selected" : ""
                }`}
                style={{ backgroundColor: entry.colour }}
                aria-label={entry.name}
                aria-pressed={colour === entry.colour}
                onClick={() => setColour(entry.colour)}
              />
            ))}
          </div>
          <button
            type="submit"
            className="secondary-action"
            data-testid="create-label"
            disabled={busy || !name.trim()}
          >
            Create label
          </button>
        </form>

        {error ? (
          <p className="action-error" role="alert">
            {error}
          </p>
        ) : null}

        {labels === null ? (
          <p className="manage-note" aria-busy="true">
            Opening the drawer…
          </p>
        ) : labels.length === 0 ? (
          <p className="manage-note" data-testid="manage-empty">
            No labels yet. Create one above.
          </p>
        ) : (
          <ul className="manage-list">
            {labels.map((label) => (
              <li
                key={label.id}
                className="manage-row"
                data-testid="label-row"
              >
                <div className="manage-row-head">
                  <span
                    className="manage-dot"
                    style={{ backgroundColor: label.colour }}
                    aria-hidden="true"
                  />
                  {editing?.id === label.id ? (
                    <form
                      className="rename-form"
                      onSubmit={(event) => {
                        event.preventDefault();
                        const next = editing.name;
                        if (!next.trim()) return;
                        void run(async () => {
                          await platform.renameLabel(label.id, next);
                          setEditing(null);
                        });
                      }}
                    >
                      <input
                        data-testid="rename-label"
                        value={editing.name}
                        maxLength={40}
                        autoFocus
                        onChange={(event) =>
                          setEditing({
                            id: label.id,
                            name: event.target.value,
                          })
                        }
                      />
                      <button type="submit" disabled={busy}>
                        Save
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditing(null)}
                      >
                        Cancel
                      </button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="manage-name"
                      onClick={() =>
                        setEditing({ id: label.id, name: label.name })
                      }
                    >
                      {label.name}
                    </button>
                  )}
                  <span className="manage-usage">
                    {label.bookCount === 1
                      ? "1 book"
                      : `${label.bookCount} books`}
                  </span>
                </div>
                <div className="manage-row-foot">
                  <div
                    className="label-palette label-palette-small"
                    role="group"
                    aria-label={`Colour for ${label.name}`}
                  >
                    {LABEL_PALETTE.map((entry) => (
                      <button
                        key={entry.colour}
                        type="button"
                        className={`label-palette-swatch label-palette-swatch-small${
                          label.colour === entry.colour ? " is-selected" : ""
                        }`}
                        style={{ backgroundColor: entry.colour }}
                        aria-label={entry.name}
                        aria-pressed={label.colour === entry.colour}
                        onClick={() =>
                          void run(() =>
                            platform.recolourLabel(label.id, entry.colour),
                          )
                        }
                      />
                    ))}
                  </div>
                  <button
                    type="button"
                    className="manage-delete"
                    aria-label={`Delete ${label.name}`}
                    onClick={() => void run(() => platform.deleteLabel(label.id))}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

