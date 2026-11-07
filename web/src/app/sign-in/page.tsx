import Link from "next/link";
import { redirect } from "next/navigation";

import { BrandMark } from "@/components/ui/Brand";
import { getSession } from "@/lib/auth/server";

import { SignInForm } from "./SignInForm";

export const metadata = {
  title: "Sign in",
  description: "Sign in to Holoraa with a one-time code sent to your email.",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const session = await getSession();
  if (session.state === "signed-in") {
    redirect("/app");
  }
  const { expired } = await searchParams;

  return (
    <main className="auth">
      <div className="auth__backdrop" aria-hidden="true" />
      <div className="auth__card glass">
        <Link href="/" className="brand" aria-label="Holoraa home">
          <BrandMark />
          <span>Holoraa</span>
        </Link>
        <div>
          <p className="eyebrow">Sign in</p>
          <h1 className="auth__title">Sign in with a code</h1>
          <p className="muted">We email you a six-digit code. There is no password.</p>
        </div>
        {session.state === "unavailable" ? (
          <p className="notice" role="status">
            Holoraa cannot be reached right now. You can still request a code when it is back.
          </p>
        ) : null}
        <SignInForm expired={expired === "1"} />
        <div className="auth__divider">
          <span className="auth__divider-line" />
          <span className="auth__divider-text">Planned</span>
          <span className="auth__divider-line" />
        </div>
        <div className="auth__planned">
          <button
            type="button"
            className="btn btn--ghost btn--full auth__oauth-btn"
            disabled
            aria-disabled="true"
            title="Google Sign-In is planned for Milestone 4"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" fill="#EA4335"/>
            </svg>
            <span>Continue with Google</span>
            <span className="badge badge--neutral">Planned</span>
          </button>
          <p className="auth__hint">Google authentication will be activated after Milestone 4 API verification.</p>
        </div>
        <p className="faint auth__footnote">
          Sign-in is in development. <Link href="/status">Check system status</Link>.
        </p>
      </div>
    </main>
  );
}
