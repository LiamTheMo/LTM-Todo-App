import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LTM Todo",
  description: "Personal tasks and planning, without artificial limits.",
  applicationName: "LTM Todo",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "LTM Todo",
    statusBarStyle: "default"
  },
  other: {
    "apple-mobile-web-app-capable": "yes"
  },
  icons: {
    icon: [
      { url: "/icons/ltm-todo-192-apple.png", type: "image/png", sizes: "192x192" },
      { url: "/icons/ltm-todo-512-apple.webp", type: "image/webp", sizes: "512x512" },
      { url: "/favicon.ico", type: "image/x-icon", sizes: "any" },
      { url: "/icons/ltm-todo-512.webp", type: "image/webp", sizes: "512x512" }
    ],
    apple: [
      { url: "/apple-touch-icon.png", type: "image/png", sizes: "180x180" }
    ]
  }
};

export const viewport: Viewport = {
  themeColor: "#f7f4ef"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
