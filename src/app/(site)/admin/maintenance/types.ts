/**
 * Shapes shared by the maintenance page and its preview endpoint. No server imports
 * here — the client form imports this file.
 */
import type { ClassPreviewRow } from "@/app/(site)/classes/types";

export type MaintenanceFields = {
  instrumentId: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
};

export type MaintenancePreviewResponse =
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

export function maintenanceKey(f: MaintenanceFields): string {
  return [f.instrumentId, f.startDate, f.startTime, f.endDate, f.endTime].join("|");
}
