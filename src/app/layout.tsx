import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AutoRefresh } from "@/components/auto-refresh";
import { CommandPalette } from "@/components/command-palette";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const viewport = { width: "device-width", initialScale: 1, themeColor: "#0a0a0a" };

export const metadata: Metadata = {
  title: "Floppa Charts",
  description: "Find rising Roblox games and niches early.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-background font-sans text-foreground md:flex-row">
        <Sidebar />
        <main className="min-w-0 flex-1 px-4 py-4 md:px-10 md:py-7">{children}</main>
        <CommandPalette />
        <AutoRefresh />
        <Toaster />
      </body>
    </html>
  );
}
