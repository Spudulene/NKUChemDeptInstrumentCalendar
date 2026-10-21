import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { signInAction } from "./actions";

export const metadata = { title: "Sign in — Instrument Calendar" };

export default async function DevLoginPage({
  searchParams,
}: PageProps<"/dev-login">) {
  // Not merely hidden — the route does not exist when dev login is off.
  if (!env.ENABLE_DEV_LOGIN) notFound();

  const { error } = await searchParams;

  const seeded = await db.user.findMany({
    orderBy: [{ role: "desc" }, { name: "asc" }],
    select: { email: true, name: true, role: true },
    take: 10,
  });

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-sm text-ink-2">
          Stand-in for university SSO. Any email works — unknown addresses are created
          as students.
        </p>
      </div>

      {typeof error === "string" && (
        <p className="rounded-lg border border-err/30 bg-err-soft px-4 py-2 text-sm text-err">
          {error}
        </p>
      )}

      <form
        action={signInAction}
        className="space-y-4 rounded-xl border border-line bg-surface p-6"
      >
        <div className="space-y-1.5">
          <label htmlFor="email" className="block text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoFocus
            placeholder="student@nku.edu"
            className="w-full rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-ink-3"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="name" className="block text-sm font-medium">
            Name <span className="font-normal text-ink-3">(optional)</span>
          </label>
          <input
            id="name"
            name="name"
            type="text"
            className="w-full rounded-lg border border-line-2 px-3 py-2 text-sm outline-none focus:border-ink-3"
          />
        </div>

        <button
          type="submit"
          className="w-full rounded-lg bg-gold px-4 py-2 text-sm font-medium text-on-gold transition hover:brightness-95"
        >
          Sign in
        </button>
      </form>

      {seeded.length > 0 && (
        <div className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium">Seeded accounts</h2>
          <ul className="mt-3 space-y-1.5 text-sm">
            {seeded.map((user) => (
              <li key={user.email} className="flex justify-between gap-4">
                <span className="font-mono text-xs text-ink-2">{user.email}</span>
                <span className="text-xs uppercase tracking-wide text-ink-3">
                  {user.role.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
