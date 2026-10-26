import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { Button, Card, Field, Notice, fieldClass } from "@/components/ui";
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
    <div className="mx-auto max-w-md pt-2">
      <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em]">Sign in</h1>
      <p className="mt-2 text-[17px] leading-normal text-ink-2">
        Stand-in for university SSO. Any email works — unknown addresses are created as students.
      </p>

      {typeof error === "string" && (
        <Notice tone="err" alert className="mt-6">
          {error}
        </Notice>
      )}

      <Card as="section" className="mt-6 p-6">
        <form action={signInAction} className="flex flex-col gap-4">
          <Field label="Email">
            <input
              name="email"
              type="email"
              required
              autoFocus
              placeholder="student@nku.edu"
              className={fieldClass}
            />
          </Field>
          <Field label="Name" hint="optional">
            <input name="name" type="text" className={fieldClass} />
          </Field>
          <Button type="submit" size="lg" className="mt-1 w-full">
            Sign in
          </Button>
        </form>
      </Card>

      {seeded.length > 0 && (
        <Card as="section" aria-labelledby="seeded-h" className="mt-4 p-5">
          <h2 id="seeded-h" className="text-base font-bold">
            Seeded accounts
          </h2>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {seeded.map((user) => (
              <li key={user.email} className="flex justify-between gap-4">
                <span className="font-mono text-xs text-ink-2">{user.email}</span>
                <span className="text-xs font-bold tracking-[0.05em] text-ink-3 uppercase">
                  {user.role.toLowerCase()}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
