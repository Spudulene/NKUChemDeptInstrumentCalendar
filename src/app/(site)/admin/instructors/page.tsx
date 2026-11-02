import { getSession } from "@/lib/auth";
import { listPeople } from "@/lib/admin/people";
import { PeopleRoster } from "@/components/people-roster";

export default async function InstructorsPage() {
  const user = await getSession();
  if (user?.role !== "ADMIN") return null; // the layout explains

  const people = await listPeople("instructors", new Date());

  return (
    <PeopleRoster
      kind="instructors"
      noun="instructor"
      title="Instructors"
      intro="Instructors can reserve instruments for their classes, which moves student bookings out of the way. Admins already can, so they aren't listed here."
      rows={people.map((p) => ({
        ...p,
        detail:
          p.count === 0
            ? "No upcoming class meetings"
            : `${p.count} upcoming class meeting${p.count === 1 ? "" : "s"}`,
        removeNote:
          p.count === 0
            ? "They'll book like a student from now on."
            : `They'll book like a student from now on. Their ${p.count === 1 ? "class meeting stays" : `${p.count} class meetings stay`} on the calendar until cancelled.`,
      }))}
    />
  );
}
