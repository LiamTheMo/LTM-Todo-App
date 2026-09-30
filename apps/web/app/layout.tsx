import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LTM Todo",
  description: "Personal tasks and planning, without artificial limits.",
  icons: {
    icon: [
      { url: "/icons/ltm-todo-512.webp", type: "image/webp", sizes: "512x512" },
      { url: "/favicon.ico", type: "image/x-icon", sizes: "any" }
    ]
  }
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
