/**
 * The sentence telling a student why their booking is gone.
 *
 * Lives apart from email.ts, which pulls in the database and Resend, so the
 * class-reservation page can render it in the browser: what the instructor previews
 * is word for word what the student receives.
 */
export function preemptionExplanation(args: {
  instrumentName: string;
  range: string;
  type: "CLASS" | "MAINTENANCE";
  title: string | null;
  reservedBy: string | null;
}): string {
  const purpose =
    args.type === "MAINTENANCE" ? "maintenance" : (args.title?.trim() || "a class");
  const reserved = args.reservedBy
    ? `${args.reservedBy} reserved the instrument for ${purpose}`
    : `The instrument was reserved for ${purpose}`;

  return `Your booking on ${args.instrumentName} for ${args.range} has been cancelled. ${reserved}, which takes priority over individual bookings.`;
}
