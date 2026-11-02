import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app/AppShell";
import { Unavailable } from "@/components/app/Unavailable";
import { getSession } from "@/lib/auth/server";

// Each request checks the session. A prerendered copy would be served to everyone.
export const dynamic = "force-dynamic";

/**
 * Session gate for everything under /app. It fails closed: anything other than a
 * confirmed session never shows application content.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (session.state === "unavailable") {
    return <Unavailable />;
  }
  if (session.state === "signed-out") {
    redirect("/sign-in");
  }
  if (session.state === "expired") {
    redirect("/sign-in?expired=1");
  }
  return <AppShell user={session.user}>{children}</AppShell>;
}
