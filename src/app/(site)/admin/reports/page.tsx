import Link from "next/link";
import type { CSSProperties } from "react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { compareCivil, parseISODate, todayCivil, type CivilDate } from "@/lib/time";
import {
  NO_GROUP,
  inOrder,
  isoRange,
  previousTerm,
  termOf,
  usageReport,
  type GroupBy,
  type Scope,
  type Term,
} from "@/lib/admin/usage";
import { Button, Card, Field, fieldClass } from "@/components/ui";

type Sort = "hours" | "bookings";

const pick = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  options.includes(value as T) ? (value as T) : fallback;

const hours = (minutes: number) =>
  (minutes / 60).toLocaleString("en-US", { maximumFractionDigits: 1 });

/** "Aug 16 – Dec 31, 2026", or with both years when the range spans two. */
function rangeLabel(first: CivilDate, last: CivilDate): string {
  const fmt = (d: CivilDate, year: boolean) =>
    new Date(Date.UTC(d.y, d.m - 1, d.d)).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      ...(year ? { year: "numeric" } : {}),
      timeZone: "UTC",
    });
  return first.y === last.y ? `${fmt(first, false)} – ${fmt(last, true)}` : `${fmt(first, true)} – ${fmt(last, true)}`;
}

const sameRange = (term: Term, first: CivilDate, last: CivilDate) =>
  compareCivil(term.first, first) === 0 && compareCivil(term.last, last) === 0;

/**
 * Usage reports: instrument time used, by research group or by instrument, over a
 * date range that defaults to the current term. Everything lives in the URL, so a
 * report can be bookmarked or sent to someone, and the page needs no client code.
 */
export default async function UsageReportsPage({ searchParams }: PageProps<"/admin/reports">) {
  const params = await searchParams;
  const user = await getSession();
  if (user?.role !== "ADMIN") return null; // the layout explains

  const thisTerm = termOf(todayCivil());
  const lastTerm = previousTerm(thisTerm);
  const [first, last] = inOrder(
    parseISODate(String(params.from ?? "")) ?? thisTerm.first,
    parseISODate(String(params.to ?? "")) ?? thisTerm.last,
  );
  const groupBy = pick<GroupBy>(params.by, ["group", "instrument"], "group");
  const sort = pick<Sort>(params.sort, ["hours", "bookings"], "hours");
  const scope = pick<Scope>(params.scope, ["students", "all"], "students");
  const instrumentId = typeof params.instrument === "string" ? params.instrument : "";
  const advisorId = typeof params.group === "string" ? params.group : "";

  const [instruments, advisors, report] = await Promise.all([
    db.instrument.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    // Former advisors still own past bookings, so they stay in the filter.
    db.user.findMany({
      where: { OR: [{ isResearchAdvisor: true }, { advisedBookings: { some: {} } }] },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    usageReport({
      first,
      last,
      groupBy,
      scope,
      instrumentId: instrumentId || undefined,
      advisorId: advisorId || undefined,
    }),
  ]);

  const metric = (r: { minutes: number; bookings: number }) => (sort === "hours" ? r.minutes : r.bookings);
  const rows = [...report.rows].sort((a, b) => metric(b) - metric(a) || a.label.localeCompare(b.label));
  const top = Math.max(1, ...rows.map(metric));

  const current = { ...isoRange(first, last), by: groupBy, sort, scope, instrument: instrumentId, group: advisorId };
  const href = (changes: Partial<typeof current>) => {
    const next = { ...current, ...changes };
    const query = new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][]);
    return `/admin/reports?${query}`;
  };
  // A row opens the other breakdown, filtered to it: a group's time by instrument.
  const drill = (id: string) =>
    groupBy === "group" ? href({ by: "instrument", group: id }) : href({ by: "group", instrument: id });

  const termName = sameRange(thisTerm, first, last)
    ? thisTerm.label
    : sameRange(lastTerm, first, last)
      ? lastTerm.label
      : null;
  const filteredTo = [
    instrumentId && instruments.find((i) => i.id === instrumentId)?.name,
    advisorId && (advisorId === NO_GROUP ? "No research group" : advisors.find((a) => a.id === advisorId)?.name),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-3">Department</p>
        <h1 className="mt-0.5 text-[32px] leading-tight font-extrabold tracking-[-0.02em]">Usage reports</h1>
        <p className="mt-1.5 max-w-[620px] text-[15px] leading-normal text-ink-2">
          Instrument time used, counted from bookings that went ahead. Each booking keeps the
          research group it was made for, so a student changing groups doesn&apos;t move past time.
        </p>
      </div>

      <section aria-labelledby="filters-h" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="filters-h" className="sr-only">
          Filters
        </h2>
        {/* Keyed by the filters: the term and drill-down links navigate client-side, and
            a <select> keeps its old choice when only its defaultValue changes. */}
        <form key={href({})} method="get" action="/admin/reports" className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="From" className="flex-[1_1_160px]">
              <input type="date" name="from" defaultValue={current.from} className={`${fieldClass} px-2.5`} />
            </Field>
            <Field label="To" className="flex-[1_1_160px]">
              <input type="date" name="to" defaultValue={current.to} className={`${fieldClass} px-2.5`} />
            </Field>
            <div className="flex flex-[1_1_240px] flex-wrap gap-2">
              {[thisTerm, lastTerm].map((t) => (
                <Link
                  key={t.label}
                  href={href(isoRange(t.first, t.last))}
                  aria-current={sameRange(t, first, last) ? "true" : undefined}
                  className={`flex min-h-11 items-center rounded-[10px] border px-3 text-sm font-bold no-underline ${
                    sameRange(t, first, last)
                      ? "border-ink bg-ink text-bg"
                      : "border-line-2 bg-surface text-ink hover:bg-surface-2"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Group by">
              <select name="by" defaultValue={groupBy} className={fieldClass}>
                <option value="group">Research group</option>
                <option value="instrument">Instrument</option>
              </select>
            </Field>
            <Field label="Sort by">
              <select name="sort" defaultValue={sort} className={fieldClass}>
                <option value="hours">Hours</option>
                <option value="bookings">Bookings</option>
              </select>
            </Field>
            <Field label="Include">
              <select name="scope" defaultValue={scope} className={fieldClass}>
                <option value="students">Student bookings</option>
                <option value="all">Student, class and maintenance</option>
              </select>
            </Field>
            <Field label="Instrument">
              <select name="instrument" defaultValue={instrumentId} className={fieldClass}>
                <option value="">All instruments</option>
                {instruments.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Research group">
              <select name="group" defaultValue={advisorId} className={fieldClass}>
                <option value="">All groups</option>
                {advisors.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
                <option value={NO_GROUP}>No research group</option>
              </select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full sm:w-auto">
                Show report
              </Button>
            </div>
          </div>
        </form>
      </section>

      <section aria-labelledby="result-h">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="result-h" className="text-lg font-bold">
            {termName ? `${termName} · ` : ""}
            {rangeLabel(first, last)}
            {filteredTo.length > 0 && ` · ${filteredTo.join(", ")}`}
          </h2>
          <p className="text-[15px] text-ink-2 tabular-nums">
            <span className="font-bold text-ink">{hours(report.minutes)} hours</span> ·{" "}
            {report.bookings} booking{report.bookings === 1 ? "" : "s"}
          </p>
        </div>

        {rows.length === 0 ? (
          <p className="mt-3 text-[15px] text-ink-3">No bookings went ahead in this range.</p>
        ) : (
          <Card className="mt-3 overflow-hidden">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-line text-xs font-extrabold tracking-[0.07em] text-ink-3 uppercase">
                  <th scope="col" className="px-4 py-3 font-extrabold sm:px-5">
                    {groupBy === "group" ? "Research group" : "Instrument"}
                  </th>
                  <th scope="col" className="w-14 px-2 py-3 text-right font-extrabold sm:w-[88px] sm:px-3">
                    Hours
                  </th>
                  <th scope="col" className="w-20 px-4 py-3 text-right font-extrabold sm:w-[96px] sm:px-5">
                    Bookings
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th scope="row" className="px-4 py-3 text-[15px] font-bold sm:px-5">
                      <span className="flex items-center gap-2.5">
                        {r.color && (
                          <span
                            aria-hidden="true"
                            style={{ "--inst": r.color } as CSSProperties}
                            className="inst-dot size-2.5 flex-none rounded-full"
                          />
                        )}
                        {r.drillId ? (
                          <Link
                            href={drill(r.drillId)}
                            className="underline decoration-line-2 underline-offset-4 hover:decoration-ink"
                          >
                            {r.label}
                          </Link>
                        ) : (
                          <span className="text-ink-2">{r.label}</span>
                        )}
                      </span>
                      <span aria-hidden="true" className="mt-2 block h-1.5 rounded-full bg-sunken">
                        <span
                          className="block h-full rounded-full bg-ink-3"
                          style={{ width: `${(metric(r) / top) * 100}%` }}
                        />
                      </span>
                    </th>
                    <td className="px-2 py-3 text-right sm:px-3 text-[15px] font-semibold tabular-nums">{hours(r.minutes)}</td>
                    <td className="px-4 py-3 text-right text-[15px] tabular-nums sm:px-5">{r.bookings}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        <p className="mt-3 max-w-[680px] text-[13px] leading-normal text-ink-3">
          Counts bookings that have ended and weren&apos;t cancelled or bumped, by the day they
          start on. Terms are approximate: Spring to May 15, Summer to Aug 15, Fall to Dec 31.
          {rows.some((r) => r.drillId) &&
            (groupBy === "group"
              ? " Select a group to see its time by instrument."
              : " Select an instrument to see its time by research group.")}
        </p>
      </section>
    </div>
  );
}
