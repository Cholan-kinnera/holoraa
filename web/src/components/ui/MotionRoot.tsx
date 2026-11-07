"use client";

import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";

/**
 * Scopes Motion to the user's motion preference. With reducedMotion="user",
 * Motion drops transform and layout animation for people who ask for less
 * motion, while opacity and colour changes still give feedback.
 */
export function MotionRoot({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
