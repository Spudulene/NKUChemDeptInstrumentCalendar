import { getSession } from "@/lib/auth";
import { listPeople } from "@/lib/admin/people";
import { PeopleRoster } from "@/components/people-roster";

export default async function AdvisorsPage() {
  const user = await getSession();
  if (user?.role !== "ADMIN") return null; // the layout explains

  const people = await listPeople("advisors", new Date());

  return (
    <PeopleRoster
      kind="advisors"
      noun="research advisor"
      title="Research advisors"
      intro="The research groups students choose from. Each booking records the group it's for, which is what usage reports count by."
      rows={people.map((p) => ({
        ...p,
        detail:
          p.count === 0
            ? "No students in this group"
            : `${p.count} student${p.count === 1 ? "" : "s"} in this group`,
        removeNote:
          p.count === 0
            ? "Past bookings stay attributed to this group."
            : `${p.count === 1 ? "Their student will" : `Their ${p.count} students will`} be asked to pick a group again. Past bookings stay attributed to this group.`,
      }))}
    />
  );
}
