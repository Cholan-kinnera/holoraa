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
      <div className="auth__card glass">
        <Link href="/" className="brand">
          <BrandMark />
          Holoraa
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
        <p className="faint auth__footnote">
          Sign-in is in development. <Link href="/status">Check system status</Link>.
        </p>
      </div>
    </main>
  );
}
