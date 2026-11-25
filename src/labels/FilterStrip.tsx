import { useCallback, useEffect, useRef } from "react";

import type { Book, LabelUsage, ReadingStatus } from "../platform";
import { STATUS_LABELS } from "../library/spine";

interface FilterStripProps {
  labels: LabelUsage[];
  books: Book[];
  onApply: (selected: number[], status: ReadingStatus | null) => void;
  onManage: () => void;
}

/**
 * Filter state is kept in refs and applied to the strip/spines imperatively.
 * A chip click never re-renders the wall, so dimming 2,000 spines is one
 * class/attribute pass rather than a React reconciliation of every spine.
 */
export function FilterStrip({ labels, books, onApply, onManage }: FilterStripProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const selectedRef = useRef<number[]>([]);
  const statusRef = useRef<ReadingStatus | null>(null);

  const apply = useCallback(
    (nextSelected: number[], nextStatus: ReadingStatus | null) => {
      selectedRef.current = nextSelected;
      statusRef.current = nextStatus;
      const active = nextSelected.length > 0 || nextStatus !== null;
      let matchingCount = 0;
      if (active) {
        for (const book of books) {
          const worn = book.labels ?? [];
          if (
            nextSelected.every((labelId) =>
              worn.some((label) => label.id === labelId),
            ) &&
            (nextStatus === null || book.readingStatus === nextStatus)
          ) {
            matchingCount += 1;
          }
        }
      }
      const root = sectionRef.current;
      if (root) {
        root
          .querySelectorAll<HTMLElement>("[data-label-id]")
          .forEach((button) => {
            button.setAttribute(
              "aria-pressed",
              String(nextSelected.includes(Number(button.dataset.labelId))),
            );
          });
        root
          .querySelectorAll<HTMLElement>("[data-status-filter]")
          .forEach((button) => {
            button.setAttribute(
              "aria-pressed",
              String(button.dataset.statusFilter === nextStatus),
            );
          });
        const clear = root.querySelector<HTMLElement>(
          '[data-testid="filter-clear"]',
        );
        if (clear) clear.hidden = !active;
        const count = root.querySelector<HTMLElement>(".fb-count b");
        if (count) count.textContent = String(active ? matchingCount : books.length);
        const live = root.querySelector<HTMLElement>(
          '[data-testid="filter-count"]',
        );
        if (live) {
          live.textContent = active
            ? `${matchingCount} of ${books.length} books match`
            : `${books.length} books on the wall`;
        }
      }
      onApply(nextSelected, nextStatus);
    },
    [books, onApply],
  );
  const applyRef = useRef(apply);
  applyRef.current = apply;

  useEffect(() => {
    const next = selectedRef.current.filter((id) =>
      labels.some((label) => label.id === id),
    );
    if (next.length !== selectedRef.current.length) {
      applyRef.current(next, statusRef.current);
    }
  }, [labels]);

  const active = selectedRef.current.length > 0 || statusRef.current !== null;
  let matchingCount = books.length;
  if (active) {
    matchingCount = 0;
    for (const book of books) {
      const worn = book.labels ?? [];
      if (
        selectedRef.current.every((labelId) =>
          worn.some((label) => label.id === labelId),
        ) &&
        (statusRef.current === null ||
          book.readingStatus === statusRef.current)
      ) {
        matchingCount += 1;
      }
    }
  }
  const countText = active
    ? `${matchingCount} of ${books.length} books match`
    : `${books.length} books on the wall`;
  const statusColour: Record<ReadingStatus, string> = {
    unread: "#7c7364",
    reading: "#a83238",
    finished: "#b58a34",
  };
  return (
    <section
      ref={sectionRef}
      className="filterbar fb-1"
      data-testid="filter-strip"
      aria-label="Shelf filters"
      role="toolbar"
    >
      <div className="fb-row">
        <div className="fb-scroll" role="group" aria-label="Label filters">
          {labels.length === 0 ? (
            <span className="fb-empty">No labels yet</span>
          ) : (
            labels.map((label) => (
              <button
                key={label.id}
                type="button"
                className="chip filter-label-chip"
                data-testid="filter-label-chip"
                data-label-id={label.id}
                aria-pressed={selectedRef.current.includes(label.id)}
                onClick={() => {
                  const next = selectedRef.current.includes(label.id)
                    ? selectedRef.current.filter((id) => id !== label.id)
                    : [...selectedRef.current, label.id];
                  apply(next, statusRef.current);
                }}
              >
                <span
                  className="dot"
                  style={{ backgroundColor: label.colour }}
                  aria-hidden="true"
                />
                <span>{label.name}</span>
                <span className="filter-count">{label.bookCount}</span>
              </button>
            ))
          )}
        </div>
        <button
          type="button"
          className="chip clear filter-clear"
          data-testid="filter-clear"
          onClick={() => apply([], null)}
          hidden={!active}
          aria-label="Clear filters"
        >
          Clear
        </button>
        <div className="fb-count" aria-hidden="true">
          <b>{matchingCount}</b>
          <span>vols</span>
        </div>
        <span className="visually-hidden" data-testid="filter-count" aria-live="polite">
          {countText}
        </span>
      </div>
      <div className="fb-row">
        <span className="fb-cap">Status</span>
        <div
          className="fb-scroll"
          role="group"
          aria-label="Reading status filters"
        >
          {(["unread", "reading", "finished"] as ReadingStatus[]).map(
            (value) => (
              <button
                key={value}
                type="button"
                className="chip filter-status-chip"
                data-testid={`filter-status-${value}`}
                data-status-filter={value}
                aria-pressed={statusRef.current === value}
                onClick={() =>
                  apply(
                    selectedRef.current,
                    statusRef.current === value ? null : value,
                  )
                }
              >
                <span
                  className="dot status-dot"
                  style={{ backgroundColor: statusColour[value] }}
                  aria-hidden="true"
                />
                {STATUS_LABELS[value]}
              </button>
            ),
          )}
        </div>
        <button
          type="button"
          className="fb-manage filter-manage"
          data-testid="manage-labels"
          aria-label="Manage labels"
          onClick={onManage}
        >
          Manage
        </button>
      </div>
    </section>
  );
}

