"use client";

import type { CSSProperties } from "react";
import { useBooking } from "@/components/booking-provider";
import type {
  BlockCell,
  BlockRow,
  GridBand,
  GridBlock,
  GridDay,
  GridSlot,
  ScheduleTone,
  ScheduleView,
} from "@/lib/schedule-view";

const TONE: Record<ScheduleTone, string> = {
  student: "bg-surface text-ink shadow-[inset_0_0_0_1px_var(--ui-border2),0_1px_2px_rgba(0,0,0,.06)]",
  mine: "bg-mine text-on-mine",
  class: "stripes-class text-ink shadow-[inset_0_0_0_2px_var(--ui-gold)]",
  maintenance: "stripes-maintenance text-ink-2 shadow-[inset_0_0_0_1px_var(--ui-border2)]",
};

const TAG: Partial<Record<ScheduleTone, { label: string; className: string }>> = {
  class: { label: "Class", className: "text-gold-ink" },
  maintenance: { label: "Maintenance", className: "text-ink-3" },
};

const COLUMNS = "grid-cols-[72px_repeat(7,minmax(0,1fr))]";

/**
 * A week of one instrument, laid out as in the Calendar artboard: the bookable hours
 * as a time grid, and whole-block windows (overnight runs) as a row underneath.
 *
 * Everything is computed on the server (see buildScheduleView) and passed in as
 * instants and pre-formatted labels; this component never does timezone arithmetic
 * or date formatting, which keeps the campus-time rule in one place and the server
 * and browser renders identical. Positions are a fraction of each column's real span,
 * so DST days still line up.
 *
 * Slots and open overnight cells are clickable only inside a BookingProvider.
 */
export function WeekGrid({ view }: { view: ScheduleView }) {
  const booking = useBooking();
  const hours = (view.endMinute - view.startMinute) / 60;
  // Compact when the grid has to show most of the day, so it doesn't run off-screen.
  const hourPx = hours > 12 ? 32 : 56;
  const height = hours * hourPx;
  const hourLabels = Array.from({ length: hours + 1 }, (_, i) => view.startMinute / 60 + i);

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-[var(--ui-shadow)]">
      <div className="overflow-x-auto">
        <div className="min-w-[780px]">
          <div className={`grid ${COLUMNS} border-b border-line`}>
            <div />
            {view.days.map((day) => (
              <div
                key={day.key}
                className={`border-l border-line px-2.5 py-3 ${day.isWeekend ? "bg-surface-2" : ""}`}
              >
                <div className="text-xs font-bold tracking-[0.07em] text-ink-3 uppercase">
                  {day.weekday}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-[22px] font-extrabold tabular-nums">{day.dayOfMonth}</span>
                  {day.isToday ? (
                    <span className="text-[11px] font-bold tracking-[0.04em] text-gold-ink uppercase">
                      Today
                    </span>
                  ) : (
                    day.isWeekend && (
                      <span className="text-[11px] font-bold tracking-[0.04em] text-gold-ink uppercase">
                        Weekend
                      </span>
                    )
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className={`grid ${COLUMNS}`}>
            <div className="relative" style={{ height }}>
              {hourLabels.map((hour, i) => (
                <span
                  key={hour}
                  className="absolute right-2.5 text-xs font-semibold text-ink-3 tabular-nums"
                  // First label hangs below the line, last above it, the rest centred.
                  style={{
                    top: i === 0 ? 4 : i === hours ? height - 18 : i * hourPx - 8,
                  }}
                >
                  {String(hour % 24).padStart(2, "0")}:00
                </span>
              ))}
            </div>
            {view.days.map((day) => (
              <DayColumn
                key={day.key}
                day={day}
                height={height}
                hourPx={hourPx}
                closed={view.closed}
                blocks={view.blocks}
                slots={booking ? view.slots : []}
                onSelect={booking?.select}
              />
            ))}
          </div>

          {view.rows.map((row) => (
            <BlockRowView key={row.id} row={row} onSelect={booking?.select} />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  height,
  hourPx,
  closed,
  blocks,
  slots,
  onSelect,
}: {
  day: GridDay;
  height: number;
  hourPx: number;
  closed: GridBand[];
  blocks: GridBlock[];
  slots: GridSlot[];
  onSelect?: (slot: GridSlot["slot"]) => void;
}) {
  const dayStart = day.start.getTime();
  const span = day.end.getTime() - dayStart;

  /** Pixel position within the column, or null if the interval misses it. */
  const place = (start: Date, end: Date) => {
    const from = Math.max(start.getTime(), dayStart);
    const to = Math.min(end.getTime(), day.end.getTime());
    if (to <= from) return null;
    return {
      top: ((from - dayStart) / span) * height,
      height: ((to - from) / span) * height,
      clippedStart: start.getTime() < dayStart,
    };
  };

  const lines: CSSProperties = {
    height,
    backgroundImage:
      "linear-gradient(to bottom, var(--ui-border) 1px, transparent 1px), linear-gradient(to bottom, var(--ui-surface2) 1px, transparent 1px)",
    backgroundSize: `100% ${hourPx}px, 100% ${hourPx / 2}px`,
  };

  return (
    <div className={`relative border-l border-line ${day.isWeekend ? "bg-surface-2" : ""}`} style={lines}>
      {closed.map((band) => {
        const pos = place(band.start, band.end);
        if (!pos) return null;
        return (
          <div
            key={band.key}
            aria-hidden="true"
            className="absolute inset-x-0 bg-sunken/80"
            style={{ top: pos.top, height: pos.height }}
          />
        );
      })}

      {/* Beneath the booked blocks, so a taken slot can never be clicked. */}
      {onSelect &&
        slots.map(({ slot, time, when }) => {
          if (slot.start.getTime() < dayStart || slot.start.getTime() >= day.end.getTime()) return null;
          const pos = place(slot.start, new Date(slot.start.getTime() + slot.durations[0] * 60_000));
          if (!pos) return null;
          return (
            <button
              key={slot.start.getTime()}
              type="button"
              onClick={() => onSelect(slot)}
              aria-label={`Book from ${when.split(" – ")[0]}, ${slot.windowName}`}
              className="group absolute inset-x-1 rounded-lg border-2 border-dashed border-transparent text-left transition hover:border-mine hover:bg-mine-soft focus-visible:border-mine focus-visible:bg-mine-soft"
              style={{ top: pos.top + 1, height: Math.max(pos.height - 2, 8) }}
            >
              <span className="pointer-events-none block truncate px-1.5 text-xs leading-tight font-bold text-mine opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
                + Book {time}
              </span>
            </button>
          );
        })}

      {blocks.map((block) => {
        const pos = place(block.start, block.end);
        if (!pos) return null;
        const compact = pos.height < 46;
        const tag = TAG[block.tone];
        return (
          <div
            key={`${block.id}-${block.start.getTime()}`}
            title={`${block.label}, ${block.when}`}
            className={`pointer-events-none absolute inset-x-1 box-border overflow-hidden rounded-lg px-2 text-[13px] leading-[1.3] ${compact ? "py-0.5" : "py-1.5"} ${TONE[block.tone]}`}
            style={{ top: pos.top + 2, height: Math.max(pos.height - 4, 10) }}
          >
            <span className="sr-only">
              {pos.clippedStart ? "Continued: " : ""}
              {block.label}, {block.when}
            </span>
            <div aria-hidden="true">
              {compact ? (
                <span className="block truncate font-bold">
                  {block.label} <span className="font-medium tabular-nums">{block.time}</span>
                </span>
              ) : (
                <>
                  {tag && (
                    <span className={`block text-[10px] font-extrabold tracking-[0.07em] uppercase ${tag.className}`}>
                      {tag.label}
                    </span>
                  )}
                  <span className="block truncate font-bold">
                    {pos.clippedStart ? `${block.label} (cont.)` : block.label}
                  </span>
                  <span className="block font-medium tabular-nums">{block.time}</span>
                  {block.sublabel && <span className="mt-0.5 block truncate font-medium">{block.sublabel}</span>}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function MoonIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

/** One whole-block window (e.g. Overnight) as a strip: each night open or taken. */
function BlockRowView({
  row,
  onSelect,
}: {
  row: BlockRow;
  onSelect?: (slot: NonNullable<Extract<BlockCell, { state: "open" }>["slot"]>) => void;
}) {
  return (
    <div className={`grid ${COLUMNS} border-t-2 border-line-2 bg-sunken`}>
      <div className="flex flex-col justify-center py-2.5 pr-2 pl-3">
        <span className="text-xs font-bold">{row.name}</span>
        {/* A zero-width space after the arrow lets "17:00→08:00" wrap in the narrow column. */}
        <span className="text-[11px] text-ink-3 tabular-nums">
          {row.hours.replace(/ /g, "").replace(/([→–])/, "$1​")}
        </span>
      </div>
      {row.cells.map((cell) => (
        <div key={cell.day} className="relative border-l border-line px-1 py-2">
          {cell.state === "open" &&
            (cell.slot && onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(cell.slot!)}
                aria-label={`Book the ${row.name.toLowerCase()} block, ${cell.when}`}
                className="flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-line-2 text-[13px] font-semibold text-ink-2 hover:border-mine hover:bg-mine-soft hover:text-mine"
              >
                <MoonIcon />
                Open
              </button>
            ) : (
              <div className="flex min-h-11 items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-line-2 text-[13px] font-semibold text-ink-2">
                <MoonIcon />
                Open
                <span className="sr-only">, {cell.when}</span>
              </div>
            ))}
          {cell.state === "taken" && (
            <div
              title={`${cell.label}, ${cell.when}`}
              className={`flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-bold ${TONE[cell.tone]}`}
            >
              <MoonIcon />
              <span className="truncate">{cell.label}</span>
              <span className="sr-only">, {cell.when}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
