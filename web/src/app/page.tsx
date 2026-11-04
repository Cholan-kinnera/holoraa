import type { Metadata } from "next";

import { HoloraaApp } from "@/components/HoloraaApp";
import { MotionRoot } from "@/components/ui/MotionRoot";

export const metadata: Metadata = {
  title: "Holoraa — One quiet place for the people who matter",
  description: "One minimal social space to chat, hang out, and share. Private by default, with no ads and no feed built to hold your attention.",
};

// Dynamic so every request gets its own CSP nonce. A prerendered page would have
// inline scripts without a nonce, and the strict script-src would block them.
export const dynamic = "force-dynamic";

export default function LandingPage() {
  return (
    <MotionRoot>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <HoloraaApp />
    </MotionRoot>
  );
}
