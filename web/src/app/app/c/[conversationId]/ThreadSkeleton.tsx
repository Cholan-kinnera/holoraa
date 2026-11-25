import { Skeleton, SkeletonAvatar, SkeletonText } from "@/components/ui/Skeleton";

// Alternating bubble outlines; true = mine (right side). Widths in percent.
const GHOSTS: ReadonlyArray<[boolean, number]> = [
  [false, 38],
  [false, 52],
  [true, 44],
  [false, 30],
  [true, 58],
  [true, 26],
  [false, 46],
];

/** Bubble outlines shown while a conversation's messages load. */
export function ThreadGhosts() {
  return (
    <div className="thread__placeholder" aria-busy="true" aria-label="Loading messages">
      {GHOSTS.map(([mine, width], i) => (
        <Skeleton
          key={i}
          className={`skeleton--pill thread__ghost${mine ? " thread__ghost--mine" : ""} thread__ghost--w${width}`}
        />
      ))}
    </div>
  );
}

/** Whole-thread skeleton for route navigation: header, bubbles, composer. */
export function ThreadSkeleton() {
  return (
    <section className="chat thread" aria-label="Loading conversation">
      <header className="thread__header">
        <SkeletonAvatar size="lg" />
        <div className="thread-skel__who">
          <SkeletonText className="thread-skel__name" />
          <SkeletonText className="thread-skel__handle" />
        </div>
      </header>
      <div className="thread__viewport">
        <div className="thread__scroll">
          <div className="thread__content">
            <ThreadGhosts />
          </div>
        </div>
      </div>
      <div className="composer thread__composer" aria-hidden="true">
        <Skeleton className="skeleton--pill thread-skel__input" />
        <Skeleton className="skeleton--circle thread-skel__send" />
      </div>
    </section>
  );
}
