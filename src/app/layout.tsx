import type { Metadata } from "next";
import { Fredoka, Geist, Geist_Mono } from "next/font/google";
import { AdminPanel } from "@/components/AdminPanel";
import { AuthButton } from "@/components/AuthButton";
import { IdeaBox } from "@/components/IdeaBox";
import { PresenceBar } from "@/components/PresenceBar";
import { VersionWatcher } from "@/components/VersionWatcher";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const fredoka = Fredoka({
  variable: "--font-fredoka",
  subsets: ["latin"],
  weight: ["600", "700"],
});

export const metadata: Metadata = {
  title: "StudyQuest.Party",
  description: "A shared work and break timer for everyone",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${fredoka.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="flex h-14 items-center justify-end px-6">
          <AuthButton />
        </header>
        {children}
        <PresenceBar />
        <VersionWatcher />
        <AdminPanel />
        <IdeaBox />
      </body>
    </html>
  );
}
