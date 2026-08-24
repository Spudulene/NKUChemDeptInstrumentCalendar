import {
  addCivilDays,
  civilToInstant,
  civilToISODate,
  formatTimeOnly,
  type CivilDate,
} from "@/lib/time";

export type GridBlock = {
  id: string;
  start: Date;
  end: Date;
  label: string;
  sublabel?: string;
  tone: "student" | "mine" | "class" | "maintenance";
};

export type GridBand = {
  id: string;
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

/**
 * A week of one instrument, one column per campus day.
 *
 * Anything crossing midnight — every overnight booking — is clipped per column and
 * drawn as two pieces. Positions are a fraction of each column's real duration, so
 * the 23- and 25-hour DST days lay out correctly instead of overflowing.
 */
export function WeekGrid({
  weekStart,
  bands,
  blocks,
  today,
}: {
  weekStart: CivilDate;
  bands: GridBand[];
  blocks: GridBlock[];
  today: CivilDate;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addCivilDays(weekStart, i));
  const todayKey = civilToISODate(today);

  return (
    <div className="overflow-x-auto rounded-xl border border-stone-200 bg-white">
      <div className="min-w-3xl">
        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] border-b border-stone-200">
          <div />
          {days.map((day) => {
            const isToday = civilToISODate(day) === todayKey;
            return (
              <div
                key={civilToISODate(day)}
                className={`px-2 py-2 text-center text-xs ${
                  isToday ? "font-semibold text-stone-900" : "text-stone-500"
                }`}
              >
                <div>
                  {new Date(Date.UTC(day.y, day.m - 1, day.d)).toLocaleDateString(
                    "en-US",
                    { weekday: "short", timeZone: "UTC" },
                  )}
                </div>
                <div className={isToday ? "text-indigo-600" : ""}>{day.d}</div>
              </div>
            );
          })}
        </div>

        <div className="grid grid-cols-[3.5rem_repeat(7,minmax(0,1fr))]">
          <div className="relative h-[36rem]">
            {HOUR_LABELS.map((hour) => (
              <div
                key={hour}
                className="absolute right-2 -translate-y-1/2 text-[10px] text-stone-400"
                style={{ top: `${(hour / 24) * 100}%` }}
              >
                {hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`}
              </div>
            ))}
          </div>

          {days.map((day) => (
            <DayColumn
              key={civilToISODate(day)}
              day={day}
              bands={bands}
              blocks={blocks}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function DayColumn({
  day,
  bands,
  blocks,
}: {
  day: CivilDate;
  bands: GridBand[];
  blocks: GridBlock[];
}) {
  const dayStart = civilToInstant(day, 0);
  const dayEnd = civilToInstant(addCivilDays(day, 1), 0);
  const span = dayEnd.getTime() - dayStart.getTime();

  /** Fraction of the column an interval occupies, or null if it misses this day. */
  const place = (start: Date, end: Date) => {
    const from = Math.max(start.getTime(), dayStart.getTime());
    const to = Math.min(end.getTime(), dayEnd.getTime());
    if (to <= from) return null;

    return {
      top: ((from - dayStart.getTime()) / span) * 100,
      height: ((to - from) / span) * 100,
      clippedStart: start.getTime() < dayStart.getTime(),
      clippedEnd: end.getTime() > dayEnd.getTime(),
    };
  };

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

      {blocks.map((block) => {
        const pos = place(block.start, block.end);
        if (!pos) return null;
        return (
          <div
            key={`${block.id}-${block.start.getTime()}`}
            className={`absolute inset-x-0.5 overflow-hidden rounded border px-1 py-0.5 text-[10px] leading-tight ${TONE_CLASSES[block.tone]} ${
              pos.clippedStart ? "rounded-t-none border-t-0" : ""
            } ${pos.clippedEnd ? "rounded-b-none border-b-0" : ""}`}
            style={{ top: `${pos.top}%`, height: `${pos.height}%` }}
            title={`${block.label} · ${formatTimeOnly(block.start)}–${formatTimeOnly(block.end)}`}
          >
            {!pos.clippedStart && (
              <div className="font-medium">{formatTimeOnly(block.start)}</div>
            )}
            <div className="truncate">{block.label}</div>
            {block.sublabel && (
              <div className="truncate opacity-75">{block.sublabel}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
