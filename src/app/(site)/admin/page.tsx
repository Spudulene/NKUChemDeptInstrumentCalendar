import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

/** /admin opens the first instrument's settings, or Add instrument when there are none. */
export default async function AdminHome() {
  const user = await getSession();
  if (user?.role !== "ADMIN") return null; // the layout explains

  const first = await db.instrument.findFirst({
    where: { isActive: true },
    select: { slug: true },
    orderBy: { name: "asc" },
  });
  redirect(first ? `/admin/instruments/${first.slug}` : "/admin/instruments/new");
}
