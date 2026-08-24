import type { Metadata } from "next";
import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
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
  title: "Instrument Calendar — NKU Chemistry",
  description:
    "Reserve time on departmental instruments in the NKU Chemistry Department.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const user = await getSession();

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <header className="border-b border-stone-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-6 py-4">
            <Link href="/" className="font-semibold tracking-tight">
              Instrument Calendar
            </Link>

            <div className="flex items-center gap-4 text-sm">
              {user ? (
                <>
                  <span className="text-stone-600">
                    {user.name}
                    <span className="ml-2 rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium uppercase tracking-wide text-stone-500">
                      {user.role.toLowerCase()}
                    </span>
                  </span>
                  <form action="/api/dev-login/sign-out" method="post">
                    <button
                      type="submit"
                      className="text-stone-500 underline-offset-4 hover:text-stone-900 hover:underline"
                    >
                      Sign out
                    </button>
                  </form>
                </>
              ) : (
                env.ENABLE_DEV_LOGIN && (
                  <Link
                    href="/dev-login"
                    className="text-stone-500 underline-offset-4 hover:text-stone-900 hover:underline"
                  >
                    Sign in
                  </Link>
                )
              )}
            </div>
          </div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">{children}</main>

        {env.ENABLE_DEV_LOGIN && (
          <footer className="border-t border-stone-200 bg-amber-50 px-6 py-2 text-center text-xs text-amber-900">
            Development login is enabled. Entra SSO is not wired up yet.
          </footer>
        )}
      </body>
    </html>
  );
}
