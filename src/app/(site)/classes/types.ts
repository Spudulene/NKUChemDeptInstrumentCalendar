/**
 * Shapes shared by the class-reservation page and its preview endpoint. No server
 * imports here — the client form imports this file.
 */

export type ClassPreviewRow = {
  id: string;
  name: string;
  initials: string;
  group: string | null;
  /** "13:00 – 14:30" when it sits on the reservation's day, a full range otherwise. */
  time: string;
  /** Campus-time range in the wording the preemption email uses. */
  range: string;
  /** "2 h 40 min" when the booking starts within a day, else null. */
  startsIn: string | null;
  startsSoon: boolean;
  /** For a running booking: the first half-hour after it ends, if that is still a usable start. */
  resumeFrom: string | null;
  type: "STUDENT" | "CLASS" | "MAINTENANCE";
};

export type ClassPreviewResponse =
  | {
      ok: true;
      /** Echo of the inputs, so the form can tell a current preview from a stale one. */
      key: string;
      asOf: string;
      targets: ClassPreviewRow[];
      inProgress: ClassPreviewRow[];
      blockedBy: ClassPreviewRow[];
    }
  | { ok: false; key: string; error: string };

export function previewKey(fields: {
  instrumentId: string;
  date: string;
  from: string;
  to: string;
}): string {
  return [fields.instrumentId, fields.date, fields.from, fields.to].join("|");
}

/** One meeting of a weekly series, with who it would affect. */
export type SeriesPreviewDate = {
  /** YYYY-MM-DD, the id the form uses to skip it. */
  date: string;
  /** "Tue, Nov 3" */
  label: string;
  targets: ClassPreviewRow[];
  inProgress: ClassPreviewRow[];
  blockedBy: ClassPreviewRow[];
};

export type SeriesPreviewResponse =
  | { ok: true; key: string; asOf: string; dates: SeriesPreviewDate[] }
  | { ok: false; key: string; error: string };

export function seriesKey(fields: {
  instrumentId: string;
  first: string;
  until: string;
  days: string;
  from: string;
  to: string;
}): string {
  return [fields.instrumentId, fields.first, fields.until, fields.days, fields.from, fields.to].join("|");
}
