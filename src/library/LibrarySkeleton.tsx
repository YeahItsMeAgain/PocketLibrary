import { Masthead } from "../shell/Masthead";

/**
 * First-paint shell for the wall. It paints the masthead and the shelf rhythm
 * immediately; the real cases replace it when shelves and the book index
 * arrive. Dimensions match the rendered wall so the swap does not jump.
 */
export function LibrarySkeleton() {
  return (
    <main
      id="library-main"
      className="library-wall"
      data-testid="library-wall"
      aria-busy="true"
    >
      <div className="library-skeleton" data-testid="library-skeleton">
        <Masthead />
        <div className="wall-inner" aria-hidden="true">
          <div className="skeleton-filter">
            <span />
            <span />
            <span />
          </div>
          {[0, 1, 2].map((index) => (
            <div className="skeleton-shelf" key={index}>
              <span className="skeleton-crown" />
              <span className="skeleton-cavity">
                <i />
                <i />
                <i />
                <i />
              </span>
              <span className="skeleton-board" />
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
