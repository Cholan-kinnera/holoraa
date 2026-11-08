"use server";

import { redirect } from "next/navigation";

import { sendCode, verifyCode } from "@/lib/auth/flows";
import { applyCookies, currentCookieHeader, requestContext } from "@/lib/auth/server";
import { validateCode, validateEmail } from "@/lib/auth/validation";

export interface SendCodeState {
  challenge: { challengeId: string; email: string } | null;
  error: string | null;
}

export interface VerifyCodeState {
  error: string | null;
}

export interface ResendCodeState {
  challengeId: string | null;
  error: string | null;
  success: boolean;
}

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Step 1: asks the API to send a code. The response is the same for known and unknown addresses. */
export async function sendCodeAction(_previous: SendCodeState, formData: FormData): Promise<SendCodeState> {
  const email = String(formData.get("email") ?? "").trim();
  const invalid = validateEmail(email);
  if (invalid !== null) {
    return { challenge: null, error: invalid };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { challenge: null, error: context.message };
  }

  const result = await sendCode(context.client, context.origin, email);
  if (!result.ok) {
    return { challenge: null, error: result.message };
  }
  return { challenge: { challengeId: result.challengeId, email }, error: null };
}

/**
 * Step 2: checks the code. On success the API sets the session cookie, and any
 * session this request carried is revoked. Then the user goes to the app.
 */
export async function verifyCodeAction(_previous: VerifyCodeState, formData: FormData): Promise<VerifyCodeState> {
  const challengeId = String(formData.get("challengeId") ?? "");
  const code = String(formData.get("code") ?? "").trim();
  if (!UUID.test(challengeId)) {
    return { error: "This code request has ended. Request a new code." };
  }
  const invalid = validateCode(code);
  if (invalid !== null) {
    return { error: invalid };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { error: context.message };
  }

  const result = await verifyCode(context.client, {
    origin: context.origin,
    cookieHeader: await currentCookieHeader(),
    challengeId,
    code,
  });
  if (!result.ok) {
    return { error: result.message };
  }

  // Without the session cookie, /app would send the user straight back here.
  if (result.cookies.length === 0) {
    return { error: "Sign-in could not start a session. Try again." };
  }
  await applyCookies(result.cookies);
  if (!result.user.profileComplete || result.user.username === null) {
    redirect("/app/profile?setup=1");
  }
  redirect("/app");
}

/** Resends a code to the current email and returns the new challenge ID. */
export async function resendCodeAction(_previous: ResendCodeState, formData: FormData): Promise<ResendCodeState> {
  const email = String(formData.get("email") ?? "").trim();
  const invalid = validateEmail(email);
  if (invalid !== null) {
    return { challengeId: null, error: invalid, success: false };
  }

  const context = await requestContext();
  if (!context.ok) {
    return { challengeId: null, error: context.message, success: false };
  }

  const result = await sendCode(context.client, context.origin, email);
  if (!result.ok) {
    return { challengeId: null, error: result.message, success: false };
  }
  return { challengeId: result.challengeId, error: null, success: true };
}
