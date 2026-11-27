import { useCallback, useState } from "react";

import { platform, type BookDetail } from "../../platform";
import { errorMessage } from "./errors";
import { Section } from "./Section";

interface DangerSectionProps {
  title: string;
  bookId: number;
  detail: BookDetail;
  onDeleted: (bookId: number) => void;
}

export function DangerSection({
  title,
  bookId,
  detail,
  onDeleted,
}: DangerSectionProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteNotice, setDeleteNotice] = useState<string | null>(null);

  const deleteBook = useCallback(async () => {
    setDeleteBusy(true);
    setDeleteNotice(null);
    try {
      await platform.deleteBook(bookId, true);
      onDeleted(bookId);
    } catch (error) {
      setDeleteNotice(
        errorMessage(error, "That book could not be deleted. Try again."),
      );
    } finally {
      setDeleteBusy(false);
    }
  }, [bookId, onDeleted]);

  return (
    <Section
      id="danger"
      title={title}
      note="Deleting removes the book from the shelf and deletes its file. This cannot be undone."
     
    >
      {confirmDelete ? (
        <div
          className="detail-delete-confirm edit-delete-confirm"
          role="alertdialog"
          aria-label="Confirm deleting this book"
          data-testid="detail-delete-confirm"
        >
          <p>
            Delete “{detail.title}” from your library folder? The file will be
            removed too. This cannot be undone.
          </p>
          {deleteNotice ? (
            <p
              className="detail-delete-error"
              role="status"
              data-testid="detail-delete-error"
            >
              {deleteNotice}
            </p>
          ) : null}
          <div className="detail-delete-buttons">
            <button
              type="button"
              className="danger-action"
              data-testid="detail-delete-confirm-button"
              disabled={deleteBusy}
              onClick={() => void deleteBook()}
            >
              {deleteBusy ? "Deleting…" : "Delete book and file"}
            </button>
            <button
              type="button"
              className="secondary-action"
              data-testid="detail-delete-cancel"
              disabled={deleteBusy}
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="danger-action"
          data-testid="detail-delete"
          onClick={() => {
            setConfirmDelete(true);
            setDeleteNotice(null);
          }}
        >
          Delete book…
        </button>
      )}
    </Section>
  );
}
