import type { Metadata } from "next";
import "./globals.css";
import { ApiQueryProvider } from "@/lib/api/queryProvider";

export const metadata: Metadata = {
  title: "Ethiopian Property Intelligence Platform",
  description: "Property marketplace and market intelligence for Addis Ababa and beyond.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900 antialiased">
        <ApiQueryProvider>{children}</ApiQueryProvider>
      </body>
    </html>
  );
}
