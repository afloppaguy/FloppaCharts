import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { AutoRefresh } from "@/components/auto-refresh";
import { Sidebar } from "@/components/sidebar";
import "./globals.css";

const geistSans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Floppa Charts",
  description: "Find rising Roblox games and niches early.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} dark h-full antialiased`}>
      <body className="flex min-h-full bg-background font-sans text-foreground">
        <Sidebar />
        <main className="min-w-0 flex-1 px-10 py-7">{children}</main>
        <AutoRefresh />
        <Toaster />
      </body>
    </html>
  );
}
