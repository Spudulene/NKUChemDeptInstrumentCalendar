import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { AdminNav } from "@/components/admin-nav";

/**
 * Admin screens: the instrument list on the left, the chosen screen on the right, as
 * on the canvas. Department pages (instructors, advisors, maintenance, reports) are
 * not built yet, so the sidebar only lists instruments.
 */
export default async function AdminLayout({ children }: LayoutProps<"/admin">) {
  const user = await getSession();

  if (user?.role !== "ADMIN") {
    return (
      <div className="max-w-[680px]">
        <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em]">Admin</h1>
        <p className="mt-2 text-[17px] leading-normal text-ink-2">
          Instrument settings are for the instrument manager.{" "}
          <Link href={user ? "/" : "/dev-login"} className="font-semibold underline underline-offset-4">
            {user ? "Back to instruments" : "Sign in"}
          </Link>
        </p>
      </div>
    );
  }

  const instruments = await db.instrument.findMany({
    select: { slug: true, name: true, color: true, isActive: true },
    orderBy: { name: "asc" },
  });

  return (
    <div className="flex flex-wrap items-start gap-7">
      <AdminNav instruments={instruments} />
      <div className="min-w-0 flex-[999_1_640px]">{children}</div>
    </div>
  );
}
