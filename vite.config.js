import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/WH40k-list-reader/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icons/*.png", "favicon.ico"],
      manifest: {
        name: "WH40k Army Viewer",
        short_name: "WH40k Viewer",
        description: "Warhammer 40k Army List Viewer — visualizza la tua lista durante il gioco",
        theme_color: "#8B0000",
        background_color: "#0f0f1a",
        display: "standalone",
        orientation: "portrait",
        scope: "/WH40k-list-reader/",
        start_url: "/WH40k-list-reader/",
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "any"
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "document",
            handler: "NetworkFirst",
            options: {
              cacheName: "html-cache"
            }
          }
        ]
      }
    })
  ]
});
