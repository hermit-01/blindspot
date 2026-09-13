import type { Metadata } from "next";
import { IBM_Plex_Mono, Public_Sans } from "next/font/google";
import "./globals.css";

/*
 * Public Sans is the US government design system face - chosen because this is
 * a government service tool, not because it is a safe default. Plex Mono is
 * restricted to figures, where tabular alignment actually earns it.
 */
const ui = Public_Sans({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const num = IBM_Plex_Mono({
  variable: "--font-num",
  subsets: ["latin"],
  weight: ["400", "600"],
});

export const metadata: Metadata = {
  title: "Blindspot — Wayanad relief coverage",
  description:
    "Ranks the places nobody has reached yet, so relief goes where it is missing rather than where it is easy.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${ui.variable} ${num.variable}`}>
      <body>{children}</body>
    </html>
  );
}
