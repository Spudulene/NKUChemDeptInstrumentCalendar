import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { civilToISODate, todayCivil } from "@/lib/time";
import { ReserveForm } from "@/components/reserve-form";

export default async function ClassReservationsPage({
  searchParams,
}: PageProps<"/classes">) {
  const { instrument: requested } = await searchParams;
  const user = await getSession();

  if (!user || (user.role !== "INSTRUCTOR" && user.role !== "ADMIN")) {
    return (
      <div className="max-w-[680px]">
        <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em]">
          Reserve for a class
        </h1>
        <p className="mt-2 text-[17px] leading-normal text-ink-2">
          Class reservations are for instructors and the instrument manager.{" "}
          {user ? (
            <Link href="/" className="font-semibold underline underline-offset-4">
              Back to instruments
            </Link>
          ) : (
            <Link href="/dev-login" className="font-semibold underline underline-offset-4">
              Sign in
            </Link>
          )}
        </p>
      </div>
    );
  }

  const instruments = await db.instrument.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, location: true },
    orderBy: { name: "asc" },
  });

  const initial =
    instruments.find((i) => i.slug === requested) ?? instruments[0] ?? null;

  return (
    <div>
      <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em]">
        Reserve for a class
      </h1>
      <p className="mt-2 max-w-[680px] text-[17px] leading-normal text-ink-2">
        Class reservations take priority over student bookings. You&apos;ll see exactly
        who is affected before anything is cancelled.
      </p>

      {initial ? (
        <ReserveForm
          instruments={instruments}
          initialInstrumentId={initial.id}
          today={civilToISODate(todayCivil())}
          reservedBy={user.name}
        />
      ) : (
        <p className="mt-7 text-ink-2">There are no active instruments to reserve.</p>
      )}
    </div>
  );
}
