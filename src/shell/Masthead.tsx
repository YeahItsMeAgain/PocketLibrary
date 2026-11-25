export function CrestMark({ className = "mast-orn" }: { className?: string }) {
  return (
    <svg
      className={className}
      width="52"
      height="14"
      viewBox="0 0 52 14"
      fill="none"
      aria-hidden="true"
    >
      <path d="M2 11h14M36 11h14" stroke="currentColor" opacity=".55" />
      <path
        d="M26 1c-3 3.4-6.4 5-10.4 5 3.6 1.6 6 4 7.2 7 1.2-2.6 2.2-2.6 3.2-4 1 1.4 2 1.4 3.2 4 1.2-3 3.6-5.4 7.2-7C32.4 6 29 4.4 26 1z"
        fill="currentColor"
        opacity=".85"
      />
      <circle cx="26" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}

export function Masthead({
  volumeCount,
  caseCount,
}: {
  volumeCount?: number;
  caseCount?: number;
}) {
  const meta =
    volumeCount === undefined
      ? "A quiet room for your own books"
      : `${volumeCount} ${volumeCount === 1 ? "volume" : "volumes"} · ${
          caseCount ?? 0
        } ${caseCount === 1 ? "case" : "cases"}`;
  return (
    <header className="v4-mast">
      <p className="kicker">Bibliotheca Domestica</p>
      <CrestMark />
      <h1>Pocket Library</h1>
      <div className="rule" aria-hidden="true">
        <span>❦</span>
      </div>
      <p className="meta">{meta}</p>
    </header>
  );
}
