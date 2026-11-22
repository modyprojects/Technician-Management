"use client";

import { useRouter } from "next/navigation";

// "בחר טכנאי" on the phone view of "יומן טכנאים" (owner review 22.11): the native select of the
// calls list's technician filter (CallFilters), one technician at a time. It only navigates: every
// option is a calendar address built on the server (?tech=); nothing is edited (D94 (e)). On a phone
// the system picker opens.

export type TechSelectOption = { id: string; name: string; href: string };

export function TechSelect({ value, options }: { value: string; options: readonly TechSelectOption[] }) {
  const router = useRouter();
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, flex: "none" }}>
      <span className="sub" style={{ fontWeight: 700, whiteSpace: "nowrap" }}>
        בחר טכנאי
      </span>
      <select
        key={value}
        defaultValue={value}
        aria-label="בחר טכנאי"
        data-tech-select=""
        onChange={(e) => {
          const next = options.find((o) => o.id === e.target.value);
          if (next) router.push(next.href);
        }}
        style={{ flex: 1, minWidth: 0 }}
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}
