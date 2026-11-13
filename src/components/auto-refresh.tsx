"use client";

import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";

// Keeps data pages current without a manual reload: while the tab is visible,
// the page quietly re-fetches its data once a minute. Pages where a refresh
// would be disruptive or costly (chat, settings, your own analytics) are left alone.
const LIVE = ["/games", "/watchlist", "/niches", "/compare", "/alerts"];

export function AutoRefresh({ seconds = 60 }: { seconds?: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const live = pathname === "/" || LIVE.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (!live) return;
    const tick = () => {
      // Skip while hidden, and while the user is typing somewhere.
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (document.visibilityState === "visible" && !typing) router.refresh();
    };
    const timer = setInterval(tick, seconds * 1000);
    return () => clearInterval(timer);
  }, [live, seconds, router]);

  return null;
}
