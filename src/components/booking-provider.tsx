"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { AllowedSlot } from "@/lib/booking/quota";
import { BookingDialog, type AdvisorOption, type DialogInstrument } from "@/components/booking-dialog";

type BookingContextValue = {
  /**
   * Opens the dialog on `slot`. Pass `starts` (which includes `slot`) to let the student
   * pick among several start times, as the phone day list does for an open gap.
   */
  select: (slot: AllowedSlot, starts?: AllowedSlot[]) => void;
};

const BookingContext = createContext<BookingContextValue | null>(null);

/**
 * Lets anything on the instrument page open the booking dialog: a slot in the grid,
 * an overnight cell, a gap in the phone day list, or the header's "Book time" button. Outside a provider (the
 * public embed), `useBooking()` returns null and nothing is clickable.
 */
export function BookingProvider({
  instrument,
  windowSummaries,
  advisors,
  defaultAdvisorId,
  advisorRequired,
  timeZone,
  children,
}: {
  instrument: DialogInstrument;
  /** windowId → "Daytime · Mon–Fri 08:00 – 17:00 · …", for the dialog's banner. */
  windowSummaries: Record<string, string>;
  advisors: AdvisorOption[];
  defaultAdvisorId: string | null;
  advisorRequired: boolean;
  timeZone: string;
  children: ReactNode;
}) {
  const [selected, setSelected] = useState<{ slot: AllowedSlot; starts?: AllowedSlot[] } | null>(
    null,
  );
  const select = useCallback(
    (slot: AllowedSlot, starts?: AllowedSlot[]) => setSelected({ slot, starts }),
    [],
  );
  const close = useCallback(() => setSelected(null), []);

  return (
    <BookingContext.Provider value={{ select }}>
      {children}
      {selected && (
        <BookingDialog
          instrument={instrument}
          slot={selected.slot}
          starts={selected.starts}
          windowSummary={windowSummaries[selected.slot.windowId] ?? selected.slot.windowName}
          advisors={advisors}
          defaultAdvisorId={defaultAdvisorId}
          advisorRequired={advisorRequired}
          timeZone={timeZone}
          onClose={close}
        />
      )}
    </BookingContext.Provider>
  );
}

export function useBooking(): BookingContextValue | null {
  return useContext(BookingContext);
}

/** The header's "Book time": opens the dialog on the soonest bookable slot shown. */
export function BookTimeButton({ slot, className }: { slot: AllowedSlot; className: string }) {
  const booking = useBooking();
  if (!booking) return null;
  return (
    <button type="button" onClick={() => booking.select(slot)} className={className}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
      Book time
    </button>
  );
}
