export interface UndoState {
  message: string;
  restore: () => Promise<void>;
}

export function UndoToast({
  undo,
  onUndo,
}: {
  undo: UndoState | null;
  onUndo: () => Promise<void>;
}) {
  return (
    <div
      className="edit-undo"
      role="status"
      aria-live="polite"
      data-testid="edit-undo-toast"
    >
      {undo ? (
        <>
          <span>{undo.message}</span>
          <button
            type="button"
            className="edit-undo-button"
            data-testid="edit-undo"
            onClick={() => void onUndo()}
          >
            Undo
          </button>
        </>
      ) : null}
    </div>
  );
}
