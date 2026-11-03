import { Resend } from "resend";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { formatRange } from "@/lib/time";
import { findOpenings } from "@/lib/booking/availability";
import { preemptionExplanation } from "@/lib/notice-copy";

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
    // The body too in development, so links (a swap request's) can be followed.
    if (env.NODE_ENV !== "production") console.info(mail.text);
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
        select: {
          title: true,
          description: true,
          type: true,
          startsAt: true,
          endsAt: true,
          user: { select: { name: true } },
        },
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
    const explanation = preemptionExplanation({
      instrumentName: booking.instrument.name,
      range: formatRange(booking.startsAt, booking.endsAt),
      type: booking.preemptedBy?.type === "MAINTENANCE" ? "MAINTENANCE" : "CLASS",
      title: booking.preemptedBy?.title ?? null,
      reservedBy: booking.preemptedBy?.user.name ?? null,
    });
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
       <p style="margin:0 0 16px;line-height:1.6;">${escapeHtml(explanation)}</p>
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
      explanation,
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

// ---------------------------------------------------------------------------
// Swap requests ("Ask for this time")
// ---------------------------------------------------------------------------

const button = (href: string, label: string) =>
  `<a href="${href}" style="display:inline-block;background:#4f46e5;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600;">${escapeHtml(label)}</a>`;

/**
 * Tell a holder someone is asking for their time. The link carries the single-use
 * token; it opens a page where they choose, so a mail scanner following it does
 * nothing. Stamps `holderNotifiedAt` only after a successful send.
 */
export async function notifySwapHolder(requestId: string, token: string): Promise<boolean> {
  const request = await db.swapRequest.findUnique({
    where: { id: requestId },
    include: {
      requester: { select: { name: true } },
      booking: {
        include: {
          user: { select: { name: true, email: true } },
          instrument: { select: { name: true } },
        },
      },
    },
  });
  if (!request || request.status !== "PENDING") return false;

  const { booking, requester } = request;
  const range = formatRange(booking.startsAt, booking.endsAt);
  const link = `${env.APP_URL}/swap/${token}`;
  const first = booking.user.name.split(" ")[0];
  const intro = `${requester.name} is asking if you can give them your ${booking.instrument.name} booking for ${range}.`;
  const after =
    "If you give it up, it becomes their booking and leaves your schedule. If you don't answer, the request ends when your booking starts. You can also answer from My bookings.";

  const ok = await send({
    to: booking.user.email,
    subject: `${requester.name} is asking for your ${booking.instrument.name} time, ${range}`,
    html: layout(
      `${escapeHtml(requester.name)} is asking for your ${escapeHtml(booking.instrument.name)} time`,
      `<p style="margin:0 0 16px;line-height:1.6;">Hi ${escapeHtml(first)},</p>
       <p style="margin:0 0 16px;line-height:1.6;">${escapeHtml(intro)}</p>
       ${request.note ? `<p style="margin:0 0 16px;padding:12px 16px;background:#f5f5f4;border-radius:8px;line-height:1.6;"><strong>Their note:</strong> ${escapeHtml(request.note)}</p>` : ""}
       <p style="margin:0 0 24px;line-height:1.6;">${escapeHtml(after)}</p>
       ${button(link, "Give it up or keep it")}`,
    ),
    text: [
      `Hi ${first},`,
      "",
      intro,
      request.note ? `\nTheir note: ${request.note}` : "",
      "",
      after,
      "",
      `Give it up or keep it: ${link}`,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  if (ok) {
    await db.swapRequest.update({ where: { id: requestId }, data: { holderNotifiedAt: new Date() } });
  }
  return ok;
}

/**
 * Tell requesters how their requests ended: given, kept, or gone. With no ids, every
 * ended request still owing an email (the sweeper's retry). Withdrawn requests are
 * stamped when withdrawn, so they never land here.
 */
export async function notifySwapOutcomes(requestIds?: string[]): Promise<{ sent: number; failed: number }> {
  const requests = await db.swapRequest.findMany({
    where: {
      status: { in: ["ACCEPTED", "DECLINED", "EXPIRED"] },
      requesterNotifiedAt: null,
      ...(requestIds ? { id: { in: requestIds } } : {}),
    },
    include: {
      requester: { select: { name: true, email: true } },
      booking: {
        include: {
          user: { select: { name: true } },
          instrument: { select: { id: true, name: true, slug: true } },
          swapRequests: { where: { status: "ACCEPTED" }, select: { id: true } },
        },
      },
    },
    take: 50,
  });

  let sent = 0;
  let failed = 0;
  const now = new Date();

  for (const request of requests) {
    const { booking } = request;
    const instrument = booking.instrument.name;
    const range = formatRange(booking.startsAt, booking.endsAt);
    const holder = booking.user.name;
    const calendar = `${env.APP_URL}/instruments/${booking.instrument.slug}`;

    let heading: string;
    let message: string;
    let action: { href: string; label: string } | null = { href: calendar, label: "Find another time" };

    if (request.status === "ACCEPTED") {
      heading = `${holder} gave you their ${instrument} time`;
      message = `The ${instrument} booking for ${range} is yours now. It's in My bookings, and the usual cancellation rules apply.`;
      action = { href: `${env.APP_URL}/my-bookings`, label: "See My bookings" };
    } else if (request.status === "DECLINED") {
      heading = `${holder} is keeping their ${instrument} time`;
      message = `${holder} is keeping the ${instrument} booking for ${range}.`;
    } else if (booking.swapRequests.length > 0) {
      heading = `That ${instrument} time went to someone else`;
      message = `${holder} gave the ${instrument} booking for ${range} to another student who asked.`;
    } else if (booking.status === "CANCELLED" && booking.startsAt > now) {
      heading = `That ${instrument} time may be open now`;
      message = `${holder} cancelled the ${instrument} booking for ${range}. If nobody has taken it yet, you can book it.`;
      action = { href: calendar, label: "Book it on the calendar" };
    } else if (booking.status === "PREEMPTED") {
      heading = `That ${instrument} time was reserved`;
      message = `The ${instrument} booking for ${range} was replaced by a class or maintenance, so your request has ended.`;
    } else {
      heading = `Your request for ${instrument} time has ended`;
      message = `${holder} didn't answer before the ${instrument} booking for ${range} started.`;
    }

    // Openings are a nicety; the email is not worth failing over them.
    const openings =
      request.status === "ACCEPTED"
        ? []
        : await findOpenings({
            instrumentId: booking.instrument.id,
            durationMinutes: (booking.endsAt.getTime() - booking.startsAt.getTime()) / 60_000,
            from: now,
            limit: 3,
          }).catch(() => []);

    const first = request.requester.name.split(" ")[0];
    const ok = await send({
      to: request.requester.email,
      subject: heading,
      html: layout(
        escapeHtml(heading),
        `<p style="margin:0 0 16px;line-height:1.6;">Hi ${escapeHtml(first)},</p>
         <p style="margin:0 0 16px;line-height:1.6;">${escapeHtml(message)}</p>
         ${
           openings.length
             ? `<p style="margin:0 0 8px;font-weight:600;">Next available times:</p>
                <ul style="margin:0 0 20px;padding-left:20px;line-height:1.7;">
                  ${openings.map((o) => `<li>${escapeHtml(formatRange(o.start, o.end))}</li>`).join("")}
                </ul>`
             : ""
         }
         ${action ? button(action.href, action.label) : ""}`,
      ),
      text: [
        `Hi ${first},`,
        "",
        message,
        openings.length
          ? `\nNext available times:\n${openings.map((o) => `  - ${formatRange(o.start, o.end)}`).join("\n")}`
          : "",
        "",
        action ? `${action.label}: ${action.href}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    });

    if (ok) {
      await db.swapRequest.update({ where: { id: request.id }, data: { requesterNotifiedAt: new Date() } });
      sent += 1;
    } else {
      failed += 1;
    }
  }

  return { sent, failed };
}
