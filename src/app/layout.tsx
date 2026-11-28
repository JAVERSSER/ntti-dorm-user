import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { SiteFooter, SiteHeader } from "@/components/site-chrome";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Dormitory Fee Payment", template: "%s · Dormitory" },
  description: "Pay your dormitory fee with ABA KHQR.",
  robots: { index: false, follow: false },
  icons: { icon: "/logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#1d5ce6",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full`}>
      <body className="flex min-h-full flex-col font-sans">
        <SiteHeader />
        <main id="main" className="mx-auto w-full max-w-2xl flex-1 px-4 py-6 sm:py-10">
          {children}
        </main>
        <SiteFooter />
      </body>
    </html>
  );
}
