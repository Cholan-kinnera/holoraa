"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import {
  followUser,
  getPublicProfile,
  saveProfile,
  searchUsers,
  signOut,
  unfollowUser,
  type FlowResult,
  type PublicProfile,
  type UserSummary,
} from "@/lib/auth/flows";
import { applyCookies, clearSessionCookies, currentCookieHeader, requestContext } from "@/lib/auth/server";
import {
  validateAvatarUrl,
  validateBio,
  validateDisplayName,
  validateUsername,
} from "@/lib/auth/validation";

export interface ProfileState {
  status: "idle" | "saved" | "error";
  message: string | null;
}

/**
 * Revokes the session and clears the cookie. If the API cannot confirm the
 * revocation, the browser's cookie is still cleared. The server-side session
 * then stays valid until it expires, and the UI says nothing more than
 * "signed out".
 */
export async function signOutAction(): Promise<void> {
  const context = await requestContext();
  if (context.ok) {
    const result = await signOut(context.client, {
      origin: context.origin,
      cookieHeader: await currentCookieHeader(),
    });
    if (result.ok) {
      await applyCookies(result.cookies);
    } else {
      await clearSessionCookies();
    }
  } else {
    await clearSessionCookies();
  }
  redirect("/sign-in");
}

/** Saves the profile. Empty bio and avatar are sent as null, which clears them. */
export async function updateProfileAction(_previous: ProfileState, formData: FormData): Promise<ProfileState> {
  const username = String(formData.get("username") ?? "").trim();
  const displayName = String(formData.get("displayName") ?? "").trim();
  const bio = String(formData.get("bio") ?? "").trim();
  const avatarUrl = String(formData.get("avatarUrl") ?? "").trim();

  const problem = [
    validateUsername(username),
    validateDisplayName(displayName),
    validateBio(bio),
    validateAvatarUrl(avatarUrl),
  ].find((message): message is string => message !== null);
  if (problem !== undefined) {
    return { status: "error", message: problem };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { status: "error", message: context.message };
  }

  const result = await saveProfile(context.client, {
    origin: context.origin,
    cookieHeader: await currentCookieHeader(),
    values: {
      username,
      displayName,
      bio: bio === "" ? null : bio,
      avatarUrl: avatarUrl === "" ? null : avatarUrl,
    },
  });
  if (!result.ok) {
    if (result.expired === true) {
      redirect("/sign-in?expired=1");
    }
    return { status: "error", message: result.message };
  }

  // Refresh the layout so the setup banner and the menu show the saved profile.
  revalidatePath("/app", "layout");
  if (formData.get("isSetup") === "1") {
    redirect("/app");
  }
  return { status: "saved", message: "Profile saved." };
}

/** Authenticated user discovery search action. */
export async function searchUsersAction(
  query: string,
  limit = 10,
): Promise<FlowResult<{ users: UserSummary[] }>> {
  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  return searchUsers(context.client, {
    cookieHeader: await currentCookieHeader(),
    query,
    limit,
  });
}

/** Fetches a public user profile by username. */
export async function getPublicProfileAction(
  username: string,
): Promise<FlowResult<{ profile: PublicProfile }>> {
  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  return getPublicProfile(context.client, {
    cookieHeader: await currentCookieHeader(),
    username,
  });
}

/** Creates a directional follow edge to the target user. */
export async function followUserAction(
  username: string,
): Promise<FlowResult> {
  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  const result = await followUser(context.client, {
    origin: context.origin,
    cookieHeader: await currentCookieHeader(),
    username,
  });
  if (result.ok) {
    revalidatePath("/app", "layout");
  }
  return result;
}

/** Removes a directional follow edge to the target user. */
export async function unfollowUserAction(
  username: string,
): Promise<FlowResult> {
  const context = await requestContext();
  if (!context.ok) {
    return { ok: false, message: context.message };
  }
  const result = await unfollowUser(context.client, {
    origin: context.origin,
    cookieHeader: await currentCookieHeader(),
    username,
  });
  if (result.ok) {
    revalidatePath("/app", "layout");
  }
  return result;
}
