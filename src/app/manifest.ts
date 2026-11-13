import type { MetadataRoute } from "next";

// Makes the dashboard installable as its own desktop window (Chrome or Edge:
// the install icon in the address bar).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Floppa Charts",
    short_name: "Floppa Charts",
    description: "Find rising Roblox games and niches early.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
