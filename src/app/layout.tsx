import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Figtree } from "next/font/google";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppHeader } from "@/components/app-header";
import type { ThemeChoice } from "@/components/theme-switcher";
import "./globals.css";

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Instrument Calendar — NKU Chemistry",
  description:
    "Reserve time on departmental instruments in the NKU Chemistry Department.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const [user, cookieStore] = await Promise.all([getSession(), cookies()]);

  const saved = cookieStore.get("theme")?.value;
  const theme: ThemeChoice = saved === "light" || saved === "dark" ? saved : "system";

  return (
    <html
      lang="en"
      // Absent means "follow the device"; globals.css handles that case.
      data-theme={theme === "system" ? undefined : theme}
      className={`${figtree.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg font-sans text-ink">
        <AppHeader user={user} theme={theme} showSignIn={env.ENABLE_DEV_LOGIN} />

        <main className="mx-auto box-border w-full max-w-[1240px] flex-1 px-6 pt-8 pb-16">
          {children}
        </main>

        {env.ENABLE_DEV_LOGIN && (
          <footer className="border-t border-line bg-warn-soft px-6 py-2 text-center text-xs text-warn">
            Development login is enabled. Entra SSO is not wired up yet.
          </footer>
        )}
      </body>
    </html>
  );
}
