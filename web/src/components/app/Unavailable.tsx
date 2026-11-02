import Link from "next/link";

import { BrandMark } from "@/components/ui/Brand";

/** Shown when the API cannot confirm a session. No application content is rendered. */
export function Unavailable() {
  return (
    <main className="auth">
      <div className="auth__card glass" role="status">
        <BrandMark size={36} />
        <p className="eyebrow">Holoraa</p>
        <h1 className="auth__title">Holoraa cannot be reached right now</h1>
        <p className="muted">Your session could not be confirmed, so nothing is shown. Try again shortly.</p>
        <p className="faint">
          <Link href="/status">Check system status</Link>
        </p>
      </div>
    </main>
  );
}
