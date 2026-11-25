import { Skeleton, SkeletonText } from "@/components/ui/Skeleton";

/** Shown instantly while an /app page loads; the sidebar stays live. */
export default function Loading() {
  return (
    <section className="chat app-loading" aria-busy="true" aria-label="Loading">
      <div className="app-loading__center">
        <Skeleton className="skeleton--circle app-loading__circle" />
        <SkeletonText className="app-loading__title" />
        <SkeletonText className="app-loading__line" />
        <Skeleton className="skeleton--pill app-loading__button" />
      </div>
    </section>
  );
}
