import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hawaii Fantasy League",
  description: "Weekly 10-leg parlays and head-to-head side bets.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
