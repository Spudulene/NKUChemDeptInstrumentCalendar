"use client";

import { useState } from "react";
import type { BookableSlot } from "@/lib/booking/slots";
import { BookingDialog, type AdvisorOption } from "@/components/booking-dialog";

export type GridBlock = {
  id: string;
  start: Date;
  end: Date;
  label: string;
  sublabel?: string;
  tone: "student" | "mine" | "class" | "maintenance";
};

export type GridBand = { id: string; start: Date; end: Date };

export type GridDay = {
  /** YYYY-MM-DD, campus-local. Used as the column key. */
  key: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  /** Column bounds as instants, so DST days lay out at their real length. */
  start: Date;
  end: Date;
};

const TONE_CLASSES: Record<GridBlock["tone"], string> = {
  student: "bg-stone-200/90 border-stone-300 text-stone-700",
  mine: "bg-indigo-100 border-indigo-300 text-indigo-900",
  class: "bg-amber-100 border-amber-300 text-amber-900",
  maintenance: "bg-rose-100 border-rose-300 text-rose-900",
};

const HOUR_LABELS = [0, 3, 6, 9, 12, 15, 18, 21];

const hourLabel = (hour: number) =>
  hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`;

/**
 * A week of one instrument, one column per campus day.
 *
 * Anything crossing midnight — every overnight booking — is clipped per column and
 * drawn as two pieces. Positions are a fraction of each column's real duration, so
 * the 23- and 25-hour DST days lay out correctly instead of overflowing.
 *
 * Day boundaries are computed on the server and passed in as instants; this component
 * never does timezone arithmetic, which keeps the campus-time rule in one place.
 */
export function WeekGrid({
  slug,
  days,
  bands,
  blocks,
  slots,
  advisors,
  defaultAdvisorId,
  advisorRequired,
  timeZone,
  canBook,
}: {
  slug: string;
  days: GridDay[];
  bands: GridBand[];
  blocks: GridBlock[];
  slots: BookableSlot[];
  advisors: AdvisorOption[];
  defaultAdvisorId: string | null;
  advisorRequired: boolean;
  timeZone: string;
  canBook: boolean;
}) {
  const [selected, setSelected] = useState<BookableSlot | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
        <div className="min-w-3xl">
          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-stone-200">
            <div />
            {days.map((day) => (
              <div
                key={day.key}
                className={`px-2 py-2 text-center text-xs ${
                  day.isToday ? "font-semibold text-stone-900" : "text-stone-500"
                }`}
              >
                <div>{day.weekday}</div>
                <div className={day.isToday ? "text-indigo-600" : ""}>
                  {day.dayOfMonth}
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
            <div className="relative h-[36rem]">
              {HOUR_LABELS.map((hour) => (
                <div
                  key={hour}
                  className="absolute right-2 -translate-y-1/2 text-[10px] text-stone-400"
                  style={{ top: `${(hour / 24) * 100}%` }}
                >
                  {hourLabel(hour)}
                </div>
              ))}
            </div>

            {days.map((day) => (
              <DayColumn
                key={day.key}
                day={day}
                bands={bands}
                blocks={blocks}
                slots={canBook ? slots : []}
                onSelect={setSelected}
              />
            ))}
          </div>
        </div>
      </div>

      {selected && (
        <BookingDialog
          slug={slug}
          slot={selected}
          advisors={advisors}
          defaultAdvisorId={defaultAdvisorId}
          advisorRequired={advisorRequired}
          timeZone={timeZone}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function DayColumn({
  day,
  bands,
  blocks,
  slots,
  onSelect,
}: {
  day: GridDay;
  bands: GridBand[];
  blocks: GridBlock[];
  slots: BookableSlot[];
  onSelect: (slot: BookableSlot) => void;
}) {
  const dayStart = day.start.getTime();
  const span = day.end.getTime() - dayStart;

  /** Fraction of the column an interval occupies, or null if it misses this day. */
  const place = (start: Date, end: Date) => {
    const from = Math.max(start.getTime(), dayStart);
    const to = Math.min(end.getTime(), day.end.getTime());
    if (to <= from) return null;

    return {
      top: ((from - dayStart) / span) * 100,
      height: ((to - from) / span) * 100,
      clippedStart: start.getTime() < dayStart,
      clippedEnd: end.getTime() > day.end.getTime(),
    };
  };

  const daySlots = slots.filter(
    (slot) => slot.start.getTime() >= dayStart && slot.start.getTime() < day.end.getTime(),
  );

  return (
    <div className="relative h-[36rem] border-l border-stone-100">
      {HOUR_LABELS.map((hour) => (
        <div
          key={hour}
          className="absolute inset-x-0 border-t border-stone-100"
          style={{ top: `${(hour / 24) * 100}%` }}
        />
      ))}

      {bands.map((band) => {
        const pos = place(band.start, band.end);
        if (!pos) return null;
        return (
          <div
            key={`${band.id}-${band.start.getTime()}`}
            className="absolute inset-x-0 bg-emerald-50/70"
            style={{ top: `${pos.top}%`, height: `${pos.height}%` }}
          />
        );
      })}

      {/* Beneath the booked blocks, so a taken slot can never be clicked. */}
      {daySlots.map((slot) => {
        const shortest = slot.durations[0];
        const end = new Date(slot.start.getTime() + shortest * 60_000);
        const pos = place(slot.start, end);
        if (!pos) return null;

        return (
          <button
            key={slot.start.getTime()}
            type="button"
            onClick={() => onSelect(slot)}
            title={`Book ${slot.windowName}`}
            className="group absolute inset-x-0.5 rounded border border-transparent transition hover:border-indigo-300 hover:bg-indigo-50/80"
            style={{ top: `${pos.top}%`, height: `${pos.height}%` }}
          >
            <span className="pointer-events-none flex h-full items-center justify-center text-[11px] font-medium text-indigo-600 opacity-0 transition group-hover:opacity-100">
              +
            </span>
          </button>
        );
      })}

      {blocks.map((block) => {
        const pos = place(block.start, block.end);
        if (!pos) return null;
        return (
          <div
            key={`${block.id}-${block.start.getTime()}`}
            className={`pointer-events-none absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-[10px] leading-tight ${TONE_CLASSES[block.tone]} ${
              pos.clippedStart ? "rounded-t-none border-t-0" : ""
            } ${pos.clippedEnd ? "rounded-b-none border-b-0" : ""}`}
            style={{ top: `${pos.top}%`, height: `${pos.height}%` }}
            title={block.label}
          >
            {!pos.clippedStart && <div className="truncate font-medium">{block.label}</div>}
            {block.sublabel && <div className="truncate opacity-75">{block.sublabel}</div>}
          </div>
        );
      })}
    </div>
  );
}
