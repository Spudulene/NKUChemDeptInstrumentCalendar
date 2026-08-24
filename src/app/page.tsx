import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { formatDurationMinutes, minutesToClock } from "@/lib/time";
import { crossesMidnight, windowSpanMinutes } from "@/lib/booking/windows";

export default async function HomePage() {
  const [user, instruments] = await Promise.all([
    getSession(),
    db.instrument.findMany({
      where: { isActive: true },
      include: {
        windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Instruments</h1>
        <p className="mt-1 text-stone-600">
          {user
            ? "Pick an instrument to see its schedule."
            : "Sign in with your university account to reserve time."}
        </p>
      </div>

      {instruments.length === 0 ? (
        <p className="rounded-lg border border-dashed border-stone-300 p-8 text-center text-stone-500">
          No instruments yet. Run <code className="font-mono">npm run db:seed</code> to
          load the sample set.
        </p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {instruments.map((instrument) => (
            <li key={instrument.id}>
              <Link
                href={`/instruments/${instrument.slug}`}
                className="block h-full rounded-xl border border-stone-200 bg-white p-5 transition hover:border-stone-300 hover:shadow-sm"
              >
                <div className="flex items-start gap-3">
                  <span
                    aria-hidden
                    className="mt-1.5 size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: instrument.color }}
                  />
                  <div className="min-w-0">
                    <h2 className="font-medium">{instrument.name}</h2>
                    {instrument.location && (
                      <p className="text-sm text-stone-500">{instrument.location}</p>
                    )}
                  </div>
                </div>

                {instrument.description && (
                  <p className="mt-3 text-sm leading-relaxed text-stone-600">
                    {instrument.description}
                  </p>
                )}

                <dl className="mt-4 space-y-1.5 border-t border-stone-100 pt-3 text-sm">
                  {instrument.windows.map((window) => (
                    <div key={window.id} className="flex justify-between gap-4">
                      <dt className="text-stone-500">{window.name}</dt>
                      <dd className="text-right text-stone-700">
                        {minutesToClock(window.startMinute)}–
                        {minutesToClock(window.endMinute)}
                        {crossesMidnight(window) && (
                          <span className="text-stone-400"> +1d</span>
                        )}
                        <span className="text-stone-400">
                          {" · "}
                          {window.wholeBlockOnly
                            ? `${formatDurationMinutes(windowSpanMinutes(window))} block`
                            : `up to ${formatDurationMinutes(window.maxDurationMinutes)}`}
                        </span>
                      </dd>
                    </div>
                  ))}
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
