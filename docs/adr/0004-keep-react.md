# Keep React 19; refactor the app instead of migrating to SolidJS 2.0

We evaluated SolidJS 2.0 (stable 2.0.4, November 2026) against a near-release React 19 app. Migration would save roughly 55 kB gzip and give finer-grained updates, but it would not fix the real problems: a 4,865-line `App.tsx`, shelves that stay mounted forever, 2,000-node filter writes, or first-paint work. Those are architectural and layout costs, and Solid would write the same DOM with the same structure.

It would also mean a 25–40 person-day rewrite during release, taking on a nine-day-old major with breaking removals (`createResource`, `batch`, `startTransition`, `on`, `produce`, split effects, unowned refs), and re-QA of the imperative foliate/pdfjs readers, drag gestures, and Android back stack.

Consequences: stay on React 19; do the refactor in ticket 18 (feature modules, windowed shelves, deferred filtering, first-paint asset/font work, perf gates). Revisit the framework only if profiling proves React reconciliation is the bottleneck, and then only via a time-boxed spike with a measurable go/no-go.
