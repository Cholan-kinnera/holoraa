import { ThreadSkeleton } from "./ThreadSkeleton";

/** Shown instantly while a conversation route loads; the sidebar stays live. */
export default function Loading() {
  return <ThreadSkeleton />;
}
