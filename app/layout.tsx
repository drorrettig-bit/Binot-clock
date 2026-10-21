import type { Metadata, Viewport } from "next";
import { ToastProvider } from "@/components/Toast";
import { APP_NAME } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: APP_NAME,
  description: "דיווח נוכחות לפי מיקום עבור הישיבה",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "default" },
  icons: { icon: "/icon.svg", apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#edf1ef" },
    { media: "(prefers-color-scheme: dark)", color: "#0b1316" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Assistant:wght@400;500;600;700&family=Frank+Ruhl+Libre:wght@500;700;900&family=JetBrains+Mono:wght@500;700&display=swap"
        />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
