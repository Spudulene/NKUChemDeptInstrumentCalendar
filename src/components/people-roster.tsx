"use client";

import { useActionState, useState } from "react";
import {
  addPersonAction,
  removePersonAction,
  type PeopleState,
} from "@/app/(site)/admin/actions";
import type { PeopleKind } from "@/lib/admin/people";
import { Button, Card, Field, Notice, fieldClass } from "@/components/ui";

export type RosterRow = {
  id: string;
  name: string;
  email: string;
  /** "3 upcoming class meetings", "No students in this group" … */
  detail: string;
  /** What removing them does, beyond taking them off the list. */
  removeNote: string;
};

const initialState: PeopleState = { error: null };

/**
 * A department list (instructors or research advisors): add by name and email, and
 * remove with an inline confirm, like Archive on instrument settings.
 */
export function PeopleRoster({
  kind,
  noun,
  title,
  intro,
  rows,
}: {
  kind: PeopleKind;
  /** Singular, lower case: "instructor", "research advisor". */
  noun: string;
  title: string;
  intro: string;
  rows: RosterRow[];
}) {
  const [state, formAction, pending] = useActionState(addPersonAction, initialState);

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-3">Department</p>
        <h1 className="mt-0.5 text-[32px] leading-tight font-extrabold tracking-[-0.02em]">{title}</h1>
        <p className="mt-1.5 max-w-[620px] text-[15px] leading-normal text-ink-2">{intro}</p>
      </div>

      <section aria-labelledby="add-h" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <h2 id="add-h" className="text-lg font-bold">
          Add {/^[aeiou]/.test(noun) ? "an" : "a"} {noun}
        </h2>
        <p className="mt-1.5 max-w-[620px] text-[15px] leading-normal text-ink-2">
          They don&apos;t need to have signed in yet. Their account is ready the first time they do.
        </p>

        {/* React resets the form after every submit; an error hands the values back as defaults. */}
        <form action={formAction} className="mt-4 flex flex-col gap-4">
          <input type="hidden" name="kind" value={kind} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name" required help="An existing account keeps the name it has.">
              <input
                name="name"
                type="text"
                required
                maxLength={80}
                autoComplete="off"
                defaultValue={state.values?.name}
                className={fieldClass}
              />
            </Field>
            <Field label="Email" required>
              <input
                name="email"
                type="email"
                required
                autoComplete="off"
                placeholder="name@nku.edu"
                defaultValue={state.values?.email}
                className={fieldClass}
              />
            </Field>
          </div>
          <div aria-live="polite" className="empty:hidden">
            {state.error ? (
              <Notice tone="err">{state.error}</Notice>
            ) : state.added ? (
              <Notice tone="ok" title={`Added ${state.added}`} />
            ) : null}
          </div>
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Adding…" : `Add ${noun}`}
            </Button>
          </div>
        </form>
      </section>

      <section aria-labelledby="list-h">
        <h2 id="list-h" className="text-lg font-bold">
          {rows.length === 0 ? `No ${noun}s yet` : `${rows.length} ${noun}${rows.length === 1 ? "" : "s"}`}
        </h2>
        {rows.length > 0 && (
          <Card as="ul" className="mt-3 divide-y divide-line">
            {rows.map((row) => (
              <PersonRow key={row.id} kind={kind} row={row} />
            ))}
          </Card>
        )}
      </section>
    </div>
  );
}

function PersonRow({ kind, row }: { kind: PeopleKind; row: RosterRow }) {
  const [asking, setAsking] = useState(false);

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-[1_1_260px]">
        <p className="text-[15px] font-bold text-ink">{row.name}</p>
        <p className="mt-0.5 text-sm break-all text-ink-2">
          {row.email} · <span className="break-normal">{row.detail}</span>
        </p>
        {asking && <p className="mt-1.5 text-sm text-ink-2">{row.removeNote}</p>}
      </div>
      <form action={removePersonAction} className="ml-auto flex flex-wrap items-center gap-2.5">
        <input type="hidden" name="kind" value={kind} />
        <input type="hidden" name="userId" value={row.id} />
        {asking ? (
          <>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Keep
            </Button>
            <button
              type="submit"
              aria-label={`Remove ${row.name}`}
              className="min-h-11 rounded-[10px] bg-err px-4 text-sm font-bold text-bg"
            >
              Remove
            </button>
          </>
        ) : (
          <Button variant="ghost" onClick={() => setAsking(true)} aria-label={`Remove ${row.name}…`}>
            Remove
          </Button>
        )}
      </form>
    </li>
  );
}
