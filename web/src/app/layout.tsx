import "@fontsource-variable/fraunces";
import "@fontsource-variable/inter";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Holoraa", template: "%s · Holoraa" },
  description: "Holoraa is one minimal social space to chat, hang out, and share. Private by default, with no ads.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
