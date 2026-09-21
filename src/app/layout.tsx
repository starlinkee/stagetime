import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AuthButton } from "@/components/AuthButton";
import { PresenceBar } from "@/components/PresenceBar";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "stagetime.io",
  description: "A shared work and break timer for everyone",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="flex h-14 items-center justify-end px-6">
          <AuthButton />
        </header>
        {children}
        <PresenceBar />
      </body>
    </html>
  );
}
