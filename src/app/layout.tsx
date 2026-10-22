import type { Metadata } from "next";
import { Figtree } from "next/font/google";
import { savedThemeChoice } from "@/lib/theme";
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
  const theme = await savedThemeChoice();

  return (
    <html
      lang="en"
      // Absent means "follow the device"; globals.css handles that case.
      data-theme={theme === "system" ? undefined : theme}
      className={`${figtree.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col bg-bg font-sans text-ink">{children}</body>
    </html>
  );
}
