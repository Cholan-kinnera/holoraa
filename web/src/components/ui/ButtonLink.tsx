"use client";

import Link from "next/link";
import { motion } from "motion/react";
import type { ComponentProps, ReactNode } from "react";

type ButtonLinkProps = Omit<ComponentProps<typeof Link>, "className"> & {
  variant?: "primary" | "ghost";
  className?: string;
  children: ReactNode;
};

/**
 * A real link styled as a button. Motion gives press and hover feedback on a
 * wrapper, so the Link itself keeps its typed props. Links are used instead of
 * buttons because every CTA navigates somewhere.
 */
export function ButtonLink({ variant = "primary", className, children, ...rest }: ButtonLinkProps) {
  const classes = ["btn", `btn--${variant}`, className].filter(Boolean).join(" ");
  return (
    <motion.span
      className="btn-wrap"
      whileHover={{ y: -2 }}
      whileTap={{ scale: 0.97 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
    >
      <Link className={classes} {...rest}>
        {children}
      </Link>
    </motion.span>
  );
}
