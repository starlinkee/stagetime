import type { Metadata } from "next";
import { Fredoka, Geist, Geist_Mono } from "next/font/google";
import { AboutGameButton } from "@/components/AboutGameButton";
import { AdminPanel } from "@/components/AdminPanel";
import { AuthButton } from "@/components/AuthButton";
import { HowToPlayButton } from "@/components/HowToPlayButton";
import { FirstVisitGuideOverlay } from "@/components/FirstVisitGuideOverlay";
import { AllIdeasLink, IdeaBox } from "@/components/IdeaBox";
import { PresenceBar } from "@/components/PresenceBar";
import { SoundToggleButton } from "@/components/SoundToggleButton";
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
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-zinc-800/60 bg-zinc-950/90 px-3 backdrop-blur sm:px-6">
          <div className="flex flex-1 items-center gap-1 sm:gap-2">
            <AdminPanel />
            <AllIdeasLink />
          </div>
          <div className="flex shrink-0 justify-center">
            <PresenceBar />
          </div>
          <div className="flex flex-1 items-center justify-end gap-1 sm:gap-2">
            <SoundToggleButton />
            <AboutGameButton />
            <HowToPlayButton />
            <IdeaBox />
            <AuthButton />
          </div>
        </header>
        {children}
        <FirstVisitGuideOverlay />
        <VersionWatcher />
      </body>
    </html>
  );
}
