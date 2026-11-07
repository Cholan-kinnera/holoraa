import type { ReactNode } from "react";

import { signOutAction } from "@/app/app/actions";
import type { User } from "@/lib/auth/flows";

import { ProfileMenu } from "./ProfileMenu";
import { ShellFrame } from "./ShellFrame";

/**
 * The signed-in application shell. The sidebar is static: there are no
 * conversations to list yet, so it shows the empty state rather than invented
 * contacts.
 */
export function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <ShellFrame
      sidebar={
        <>
          <h2 className="shell__heading">Conversations</h2>
          <p className="empty">No conversations yet.</p>
          <p className="faint shell__note">Messaging is in development, so conversations are not stored or delivered yet.</p>
        </>
      }
      account={<ProfileMenu user={user} signOut={signOutAction} />}
    >
      {children}
    </ShellFrame>
  );
}
