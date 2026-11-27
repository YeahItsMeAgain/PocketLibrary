import type { ReactNode } from "react";

import type { EditSection } from "./types";

export function Section({
  id,
  title,
  note,
  children,
}: {
  id: EditSection;
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={`edit-section-${id}`}
      className="edit-section"
      data-testid={`edit-section-${id}`}
      aria-labelledby={`edit-section-${id}-title`}
    >
      <h3 id={`edit-section-${id}-title`}>{title}</h3>
      {note ? <p className="edit-section-note">{note}</p> : null}
      {children}
    </section>
  );
}
