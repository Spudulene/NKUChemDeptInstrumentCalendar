"use client";

import { useState } from "react";
import type { AgendaDay, AgendaItem } from "@/lib/agenda";
import { useBooking } from "@/components/booking-provider";

const BOOK =
  "inline-flex min-h-11 items-center rounded-[9px] bg-gold px-3.5 text-sm font-extrabold text-on-gold no-underline";

const TAKEN_TONE: Record<
  Extract<AgendaItem, { kind: "taken" }>["tone"],
  string
> = {
  student: "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--ui-border2)]",
  mine: "bg-mine text-on-mine",
  class: "stripes-class text-ink shadow-[inset_0_0_0_2px_var(--ui-gold)]",
  maintenance:
    "stripes-maintenance text-ink-2 shadow-[inset_0_0_0_1px_var(--ui-border2)]",
};

/**
 * The phone layout of a week, from the "Phone · Day schedule" artboard: a strip of the
 * week's days, then the chosen day as a list of open and taken time. A seven-column
 * time grid at 390px wide shows three days and scrolls sideways; this shows one day
 * that fits.
 *
 * Every day is computed on the server and switching is local state, so tapping a day
 * is instant and the page (or the embed's iframe) never reloads.
 *
 * Inside a `BookingProvider` (the instrument page), "Book" opens the booking dialog on
 * the gap's start times. Given `embedSlug` instead, it opens the app in a new tab,
 * since booking needs a sign-in the embed's frame can't hold.
 */
export function DayAgenda({
  days,
  initialKey,
  embedSlug,
}: {
  days: AgendaDay[];
  initialKey: string;
  embedSlug?: string;
}) {
  const [selectedKey, setSelectedKey] = useState(initialKey);
  const booking = useBooking();
  const day = days.find((d) => d.key === selectedKey) ?? days[0];

  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div
        role="group"
        aria-label="Choose a day"
        className="grid grid-cols-7 gap-1 border-b border-line p-2"
      >
        {days.map((d) => {
          const on = d.key === day.key;
          return (
            <button
              key={d.key}
              type="button"
              aria-pressed={on}
              aria-current={d.isToday ? "date" : undefined}
              aria-label={`${d.title}${d.isToday ? ", today" : ""}${d.hasMine ? ", you have a booking" : ""}${
                d.windows.length === 0
                  ? ", no bookable hours"
                  : d.hasOpen
                    ? ", has open time"
                    : ", nothing left to book"
              }`}
              onClick={() => setSelectedKey(d.key)}
              className={`flex min-h-[62px] flex-col items-center justify-center gap-px rounded-xl ${
                on
                  ? "bg-ink text-bg"
                  : d.isToday
                    ? "text-ink shadow-[inset_0_0_0_2px_var(--ui-gold)]"
                    : "text-ink"
              }`}
            >
              <span className="text-[11px] font-bold tracking-[0.04em] uppercase">
                {d.weekday}
              </span>
              <span className="text-lg leading-tight font-extrabold">
                {d.dayOfMonth}
              </span>
              {/* Your booking that day, as in the artboard; else gold if there's room left. */}
              <span
                aria-hidden="true"
                className={`mt-0.5 size-1.5 rounded-full ${
                  d.hasMine && !on ? "bg-mine" : d.hasMine || d.hasOpen ? "bg-gold" : "bg-transparent"
                }`}
              />
            </button>
          );
        })}
      </div>

      <div className="p-4" aria-live="polite">
        <h2 className="text-xl font-extrabold tracking-[-0.01em]">
          {day.title}
        </h2>
        <p className="mt-1 text-[13px] text-ink-2">
          {day.windows.length > 0
            ? day.windows.join(" · ")
            : "No bookable hours this day."}
        </p>

        {day.items.length > 0 ? (
          <ol className="mt-3.5 flex flex-col gap-2">
            {day.items.map((item) => (
              <li
                key={item.key}
                className="grid grid-cols-[56px_minmax(0,1fr)] items-stretch gap-2.5"
              >
                <div className="pt-2.5 tabular-nums">
                  <div className="text-sm font-bold">
                    {item.start}
                    {item.startsNextDay && (
                      <span className="text-[11px] font-semibold text-ink-3">
                        {" "}
                        +1
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-ink-3">
                    {item.end}
                    {item.endsNextDay && " +1"}
                  </div>
                </div>

                {item.kind === "open" ? (
                  <div className="box-border flex min-h-[52px] items-center justify-between gap-2.5 rounded-xl border-[1.5px] border-dashed border-line-2 py-2 pr-2 pl-3.5 text-ink-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">
                        Open · {item.free}
                      </span>
                      {item.unbookable && (
                        <span className="mt-0.5 block text-[13px] leading-snug text-ink-3">
                          {item.unbookable.detail}
                        </span>
                      )}
                    </span>
                    {item.unbookable ? null : embedSlug ? (
                      <a
                        href={`/instruments/${embedSlug}?week=${day.key}`}
                        target="_blank"
                        rel="noopener"
                        className={BOOK}
                      >
                        Book
                        <span className="sr-only">
                          {" "}
                          {item.start} to {item.end}
                          {item.endsNextDay ? " the next day" : ""} (opens in a
                          new tab)
                        </span>
                      </a>
                    ) : (
                      // No button where this viewer can't book: signed out, staff, or
                      // ruled out by lead time, the horizon or changeover.
                      booking &&
                      item.starts.length > 0 && (
                        <button
                          type="button"
                          onClick={() => booking.select(item.starts[0], item.starts)}
                          className={BOOK}
                        >
                          Book
                          <span className="sr-only">
                            {" "}
                            {item.start} to {item.end}
                            {item.endsNextDay ? " the next day" : ""}
                          </span>
                        </button>
                      )
                    )}
                  </div>
                ) : (
                  <div
                    className={`box-border min-h-[52px] rounded-xl px-3.5 py-2 ${TAKEN_TONE[item.tone]}`}
                  >
                    {item.tone === "class" && (
                      <span className="block text-[10px] font-extrabold tracking-[0.07em] text-gold-ink uppercase">
                        Class
                      </span>
                    )}
                    <span className="block text-[15px] font-bold">
                      {item.label}
                    </span>
                    {item.sublabel && (
                      <span className="mt-px block text-[13px] font-medium">
                        {item.sublabel}
                      </span>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : (
          day.windows.length > 0 && (
            <p className="mt-3.5 text-sm text-ink-2">
              Nothing left to book this day.
            </p>
          )
        )}
      </div>
    </div>
  );
}
