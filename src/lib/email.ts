import { Resend } from "resend";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatRange } from "@/lib/time";
import { findOpenings } from "@/lib/booking/availability";

const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

type Mail = { to: string; subject: string; html: string; text: string };

/**
 * Sending is best-effort by design. A booking that succeeded must not appear to have
 * failed because Resend had a bad minute, so callers log and move on.
 */
async function send(mail: Mail): Promise<boolean> {
  if (!resend) {
    // Until DNS is verified, make the mail visible rather than silently dropping it.
    console.info(
      `[email] RESEND_API_KEY unset — would send to ${mail.to}: ${mail.subject}`,
    );
    return false;
  }

  const { error } = await resend.emails.send({
    from: env.MAIL_FROM,
    to: mail.to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
  });

  if (error) {
    console.error(`[email] send failed to ${mail.to}:`, error);
    return false;
  }

  return true;
}

function layout(heading: string, body: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f5f4;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c1917;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e5e4;border-radius:12px;padding:32px;">
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${heading}</h1>
      ${body}
      <hr style="border:none;border-top:1px solid #e7e5e4;margin:28px 0 16px;" />
      <p style="margin:0;font-size:12px;color:#78716c;">
        NKU Chemistry Instrument Calendar · This mailbox is not monitored.
      </p>
    </div>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Preempted bookings that still owe their owner an email.
 *
 * `preemptionNotifiedAt` is the queue. It is stamped only after a successful send, so
 * a crash halfway through a batch resumes rather than re-mailing everyone who already
 * heard — and the immediate send and the sweeper can never double up.
 */
async function pendingPreemptionNotices(bookingIds?: string[], limit = 50) {
  return db.booking.findMany({
    where: {
      status: "PREEMPTED",
      preemptionNotifiedAt: null,
      endsAt: { gt: new Date() },
      ...(bookingIds ? { id: { in: bookingIds } } : {}),
    },
    include: {
      user: { select: { name: true, email: true } },
      instrument: { select: { id: true, name: true, slug: true, location: true } },
      preemptedBy: {
        select: { description: true, type: true, startsAt: true, endsAt: true },
      },
    },
    take: limit,
  });
}

/**
 * Send the "you were bumped" notices.
 *
 * Called two ways, deliberately:
 *
 *   1. Immediately after a preemption commits, with the affected ids. This is what
 *      students actually experience — a notice within seconds, while there is still
 *      time to rebook.
 *   2. With no ids, as a periodic sweeper, to pick up anything the immediate send
 *      missed because the email provider was down.
 *
 * The sweeper is a safety net, not the primary path. That distinction is what lets
 * this run on a once-a-day scheduler without students waiting a day for bad news.
 */
export async function deliverPreemptionNotices(
  bookingIds?: string[],
): Promise<{ sent: number; failed: number }> {
  const pending = await pendingPreemptionNotices(bookingIds);
  let sent = 0;
  let failed = 0;

  for (const booking of pending) {
    const durationMinutes =
      (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000;

    // Suggestions come from the same availability engine the calendar uses, so a
    // suggested slot is one the booking form will actually accept.
    const openings = await findOpenings({
      instrumentId: booking.instrument.id,
      durationMinutes,
      from: new Date(),
      limit: 3,
    }).catch(() => []);

    const reason = booking.preemptedBy?.description?.trim();
    const kind = booking.preemptedBy?.type === "MAINTENANCE" ? "maintenance" : "a class";
    const bookingUrl = `${env.APP_URL}/instruments/${booking.instrument.slug}`;

    const openingsHtml = openings.length
      ? `<p style="margin:0 0 8px;font-weight:600;">Next available times:</p>
         <ul style="margin:0 0 20px;padding-left:20px;line-height:1.7;">
           ${openings.map((o) => `<li>${escapeHtml(formatRange(o.start, o.end))}</li>`).join("")}
         </ul>`
      : `<p style="margin:0 0 20px;">There's no comparable opening in the next few days — check the calendar for what's left.</p>`;

    const html = layout(
      `Your ${escapeHtml(booking.instrument.name)} booking was cancelled`,
      `<p style="margin:0 0 16px;line-height:1.6;">Hi ${escapeHtml(booking.user.name.split(" ")[0])},</p>
       <p style="margin:0 0 16px;line-height:1.6;">
         Your booking on <strong>${escapeHtml(booking.instrument.name)}</strong> for
         <strong>${escapeHtml(formatRange(booking.startsAt, booking.endsAt))}</strong>
         has been cancelled. The instrument was reserved for ${kind}, which takes priority
         over individual bookings.
       </p>
       ${reason ? `<p style="margin:0 0 16px;padding:12px 16px;background:#f5f5f4;border-radius:8px;line-height:1.6;"><strong>Reason:</strong> ${escapeHtml(reason)}</p>` : ""}
       ${openingsHtml}
       <p style="margin:0 0 24px;line-height:1.6;">You can rebook any open time on the calendar.</p>
       <a href="${bookingUrl}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;">
         Rebook on the calendar
       </a>`,
    );

    const text = [
      `Hi ${booking.user.name.split(" ")[0]},`,
      "",
      `Your booking on ${booking.instrument.name} for ${formatRange(booking.startsAt, booking.endsAt)} has been cancelled. The instrument was reserved for ${kind}, which takes priority over individual bookings.`,
      reason ? `\nReason: ${reason}` : "",
      "",
      openings.length
        ? `Next available times:\n${openings.map((o) => `  - ${formatRange(o.start, o.end)}`).join("\n")}`
        : "There's no comparable opening in the next few days — check the calendar for what's left.",
      "",
      `Rebook: ${bookingUrl}`,
    ]
      .filter(Boolean)
      .join("\n");

    const ok = await send({
      to: booking.user.email,
      subject: `Cancelled: ${booking.instrument.name}, ${formatRange(booking.startsAt, booking.endsAt)}`,
      html,
      text,
    });

    if (ok) {
      await db.booking.update({
        where: { id: booking.id },
        data: { preemptionNotifiedAt: new Date() },
      });
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, failed };
}

/** Sweeper entry point for the scheduled route. */
export function sendPendingPreemptionNotices() {
  return deliverPreemptionNotices();
}
