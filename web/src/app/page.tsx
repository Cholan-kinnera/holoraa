import type { Metadata } from "next";

import { FinalCta } from "@/components/landing/FinalCta";
import { Holories } from "@/components/landing/Holories";
import { Hero } from "@/components/landing/Hero";
import { Principles } from "@/components/landing/Principles";
import { ProductPreview } from "@/components/landing/ProductPreview";
import { SiteFooter } from "@/components/landing/SiteFooter";
import { SiteHeader } from "@/components/landing/SiteHeader";
import { MotionRoot } from "@/components/ui/MotionRoot";

export const metadata: Metadata = {
  title: "Talk, share, and hang out, simply",
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
      <SiteHeader />
      <main id="main">
        <Hero />
        <ProductPreview />
        <Principles />
        <Holories />
        <FinalCta />
      </main>
      <SiteFooter />
    </MotionRoot>
  );
}
