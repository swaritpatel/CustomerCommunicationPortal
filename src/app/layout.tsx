import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CCP (Customer Communication Platform)",
  description:
    "A production-grade customer communication workspace for authentication, team management, and assignment workflows.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full bg-[var(--color-canvas)] text-[var(--color-ink)]">
        {children}
      </body>
    </html>
  );
}
