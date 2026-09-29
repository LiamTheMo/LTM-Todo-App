import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LTM Todo",
  description: "Personal tasks and planning, without artificial limits."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
