// The real AccountsQueries (D60 (7) unified user management; Step 2 plan §3.7) over a Supabase
// client under the CALLER'S OWN SESSION: RLS decides what each row read returns (the Creator every
// profile, the Manager Customer Service and Technician profiles, technician rows, his own requests
// and his scope's audit rows; docs/database-schema.md §8.3). The viewer (from the server-validated
// session, lib/auth/session.ts) only narrows what is asked and what is returned, never widens it.
// No secret key and no environment here: lib/data/supabase/accounts.ts wires it per request, and
// the local-stack tests (tests/accounts) run this same code with real local clients.
// Every list is bounded (features/data-access/common.ts: default 40, at most 100). A failed read
// throws AccountsQueryError (a code only, never the database's text); the caller fails closed.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountsQueries } from "@/features/accounts/data/ports";
import {
  ACCOUNT_ROLE_VALUES,
  isAccountRole,
  isNewAccountRole,
  MANAGER_CREATABLE_ROLES,
  technicianProfileMissing,
  type AccountListEntry,
  type AccountRole,
  type AccountTechnician,
  type CreationIntent,
  type CreatorNotice,
} from "@/features/accounts/data/types";
import type { SessionUser } from "@/features/auth/data/types";
import { dbRoleOf, uiRoleOf } from "@/features/auth/roles";
import { clampLimit, clampPage, filterListValues, isUuid, type Page } from "@/features/data-access/common";
import { isTechnicianColorToken, technicianColorCss } from "@/features/reference/data/types";

/** A failed read: `code` is the PostgREST or SQLSTATE code (or "invalid-row"), never a message. */
export class AccountsQueryError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    const safe = typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
    super(`accounts query failed (${safe})`);
    this.name = "AccountsQueryError";
    this.code = safe;
  }
}

/** Profile columns the account screens read (Migration 1 `profiles`, Migration 5 `deleted_at`). */
export const PROFILE_COLUMNS = "id, role, full_name, work_phone, invitation_rep_name, is_active, is_test, version, deleted_at";
export type ProfileRow = {
  id: string;
  role: string;
  full_name: string;
  work_phone: string | null;
  invitation_rep_name: string | null;
  is_active: boolean;
  is_test: boolean;
  version: number;
  deleted_at: string | null;
};

/** Technician columns (Migration 1 `technicians`). */
export const TECHNICIAN_COLUMNS = "id, profile_id, display_name, color, outlook_email, device_label, accepts_invitations, version, is_test";
export type TechnicianRow = {
  id: string;
  profile_id: string;
  display_name: string;
  color: string;
  outlook_email: string;
  device_label: string | null;
  accepts_invitations: boolean;
  version: number;
  is_test: boolean;
};

/** Creation-intent columns (Migration 1 `account_requests`). */
export const INTENT_COLUMNS = "id, request_type, requested_by, status, target_profile_id, requested_role, email, full_name, version, decided_at, is_test";
export type IntentRow = {
  id: string;
  request_type: string;
  requested_by: string;
  status: string;
  target_profile_id: string | null;
  requested_role: string | null;
  email: string | null;
  full_name: string | null;
  version: number;
  decided_at: string | null;
  is_test: boolean;
};

/** Only the Creator and the Manager administer accounts (a fixed capability, D33; D60 (7)). */
export const administersAccounts = (viewer: SessionUser | null | undefined): viewer is SessionUser =>
  viewer?.role === "creator" || viewer?.role === "mgr";

const emptyPage = <T>(limit: number): Page<T> => ({ items: [], total: 0, page: 1, limit, pageCount: 1 });

/**
 * The roles a viewer administers (D60 (7)): the Creator every role; the Manager Customer Service and
 * Technician accounts. RLS also lets the Manager read his own row: it is not in his list.
 */
export const administeredRoles = (viewer: Pick<SessionUser, "role">): readonly AccountRole[] =>
  viewer.role === "creator" ? ACCOUNT_ROLE_VALUES : viewer.role === "mgr" ? MANAGER_CREATABLE_ROLES : [];

/** Rows read for the email and deactivation look-ups: one per account at most, bounded anyway. */
const AUDIT_LOOKUP_MAX = 1000;

/**
 * A Technician's field profile as the list carries it. The colour is mapped through the allowlist
 * (never stored CSS passed through); the Outlook email and "פעיל" only for the Creator (Q14).
 */
export function accountTechnicianOf(row: TechnicianRow, viewer: Pick<SessionUser, "role">): AccountTechnician {
  const colorToken = isTechnicianColorToken(row.color) ? row.color : null;
  const creator = viewer.role === "creator";
  return {
    id: row.id,
    name: row.display_name,
    colorToken,
    color: colorToken ? technicianColorCss(colorToken) : "",
    device: row.device_label ?? "",
    outlookEmail: creator ? row.outlook_email : null,
    active: creator ? row.accepts_invitations : null,
    version: row.version,
    isTest: row.is_test,
  };
}

/** What the list knows about one profile besides its row (look-ups under the same session). */
export type AccountFacts = {
  technician: TechnicianRow | null;
  /** The creation's email when readable and not superseded (Q5 option c); "" otherwise. */
  email: string;
  /** The latest readable `profile.deactivated` time; null when none. */
  deactivatedAt: string | null;
};

/** One list entry, or null for a row the app does not show (an unknown role, or a deleted account). */
export function accountEntryOf(row: ProfileRow, facts: AccountFacts, viewer: Pick<SessionUser, "role">): AccountListEntry | null {
  const role = uiRoleOf(row.role);
  if (role === null || row.deleted_at !== null) return null;
  const technicianId = facts.technician?.id ?? null;
  return {
    id: row.id,
    name: row.full_name,
    role,
    email: facts.email,
    phone: row.work_phone ?? "",
    invitationAlias: row.invitation_rep_name,
    active: row.is_active,
    deactivatedAt: row.is_active ? null : facts.deactivatedAt,
    technicianId,
    technicianMissing: technicianProfileMissing({ role, active: row.is_active, technicianId }),
    version: row.version,
    isTest: row.is_test,
    technician: facts.technician ? accountTechnicianOf(facts.technician, viewer) : null,
  };
}

/** A creation intent row as the viewer's "יצירה שלא הושלמה", or null when it is not one. */
export function creationIntentOf(row: IntentRow, viewer: Pick<SessionUser, "id" | "name">): CreationIntent | null {
  const role = uiRoleOf(row.requested_role);
  if (
    row.request_type !== "direct_create" ||
    row.status !== "approved" ||
    row.target_profile_id !== null ||
    row.requested_by !== viewer.id ||
    !isNewAccountRole(role) ||
    row.email === null ||
    row.full_name === null ||
    row.decided_at === null
  ) {
    return null;
  }
  return {
    id: row.id,
    role,
    name: row.full_name,
    email: row.email,
    requestedBy: { id: viewer.id, name: viewer.name },
    authorizedAt: row.decided_at,
    version: row.version,
    isTest: row.is_test,
  };
}

type AuditRow = {
  id: number | string;
  occurred_at: string;
  action: string;
  actor_profile_id: string | null;
  target_table: string;
  target_id: string | null;
  target_is_test: boolean;
};

/** The Supabase-backed AccountsQueries for `viewer`, read through `db` under the viewer's own session. */
export function accountsQueriesOf(db: SupabaseClient, viewer: SessionUser | null): AccountsQueries {
  async function rows<T>(query: PromiseLike<{ data: unknown; error: { code?: string } | null }>): Promise<T[]> {
    const { data, error } = await query;
    if (error) throw new AccountsQueryError(error.code);
    if (!Array.isArray(data)) throw new AccountsQueryError("invalid-row");
    return data as T[];
  }

  async function count(query: PromiseLike<{ count: number | null; error: { code?: string } | null }>): Promise<number> {
    const { count: n, error } = await query;
    if (error) throw new AccountsQueryError(error.code);
    return typeof n === "number" && n >= 0 ? n : 0;
  }

  /** The look-ups of a page of profiles: field profiles, creation emails and deactivation times. */
  async function factsOf(profiles: readonly ProfileRow[]): Promise<Map<string, AccountFacts>> {
    const ids = profiles.map((p) => p.id);
    const inactive = profiles.filter((p) => !p.is_active).map((p) => p.id);
    if (ids.length === 0) return new Map();
    const [technicians, intents, emailChanges, deactivations] = await Promise.all([
      rows<TechnicianRow>(db.from("technicians").select(TECHNICIAN_COLUMNS).in("profile_id", ids)),
      rows<Pick<IntentRow, "target_profile_id" | "email">>(
        db
          .from("account_requests")
          .select("target_profile_id, email")
          .in("target_profile_id", ids)
          .in("request_type", ["direct_create", "create"])
          .eq("status", "approved"),
      ),
      rows<{ target_id: string | null }>(
        db
          .from("audit_logs")
          .select("target_id")
          .eq("action", "credentials.change_authorized")
          .eq("target_table", "profiles")
          .eq("details->>kind", "email")
          .in("target_id", ids)
          .limit(AUDIT_LOOKUP_MAX),
      ),
      inactive.length === 0
        ? Promise.resolve([] as { target_id: string | null; occurred_at: string }[])
        : rows<{ target_id: string | null; occurred_at: string }>(
            db
              .from("audit_logs")
              .select("target_id, occurred_at")
              .eq("action", "profile.deactivated")
              .eq("target_table", "profiles")
              .in("target_id", inactive)
              .order("occurred_at", { ascending: false })
              .limit(AUDIT_LOOKUP_MAX),
          ),
    ]);
    const techByProfile = new Map(technicians.map((t) => [t.profile_id, t]));
    const emailByProfile = new Map<string, string>();
    for (const i of intents) if (i.target_profile_id && i.email) emailByProfile.set(i.target_profile_id, i.email);
    // Q5 (c): an email change was authorized since the creation: the creation's address may be stale.
    for (const c of emailChanges) if (c.target_id) emailByProfile.delete(c.target_id);
    const deactivatedAt = new Map<string, string>();
    for (const d of deactivations) if (d.target_id && !deactivatedAt.has(d.target_id)) deactivatedAt.set(d.target_id, d.occurred_at);
    return new Map(
      ids.map((id) => [
        id,
        { technician: techByProfile.get(id) ?? null, email: emailByProfile.get(id) ?? "", deactivatedAt: deactivatedAt.get(id) ?? null },
      ]),
    );
  }

  async function entriesOf(profiles: readonly ProfileRow[], who: SessionUser): Promise<AccountListEntry[]> {
    const facts = await factsOf(profiles);
    return profiles.flatMap((p) => {
      const f = facts.get(p.id);
      const entry = f ? accountEntryOf(p, f, who) : null;
      return entry ? [entry] : [];
    });
  }

  /** A count-then-range page of `build()` (two reads; a page past the end is clamped to the last). */
  async function paged<R>(
    build: () => { count: PromiseLike<{ count: number | null; error: { code?: string } | null }>; range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { code?: string } | null }> },
    page: number,
    limit: number,
  ): Promise<{ data: R[]; total: number; page: number; pageCount: number }> {
    const q = build();
    const total = await count(q.count);
    const pageCount = Math.max(1, Math.ceil(total / limit));
    const current = Math.min(page, pageCount);
    if (total === 0) return { data: [], total, page: current, pageCount };
    const from = (current - 1) * limit;
    return { data: await rows<R>(q.range(from, from + limit - 1)), total, page: current, pageCount };
  }

  return {
    async list(query) {
      const limit = clampLimit(query?.limit);
      const page = clampPage(query?.page);
      if (!administersAccounts(viewer)) return emptyPage(limit);
      // An unknown role never widens the list: a filter with no known role matches nothing.
      const filter = filterListValues(query?.roles, isAccountRole, ACCOUNT_ROLE_VALUES);
      const roles = administeredRoles(viewer).filter((r) => filter === null || filter.includes(r));
      if (roles.length === 0) return emptyPage(limit);
      // The port's order (creator, mgr, cs, tech; then name) across pages: count each role, then read
      // only the slices this page needs. RLS decides the rows; the viewer's scope narrows the roles.
      const profilesOfRole = (role: AccountRole) =>
        db.from("profiles").select(PROFILE_COLUMNS).eq("role", dbRoleOf(role) ?? "").is("deleted_at", null);
      const counts = await Promise.all(
        roles.map((role) => count(db.from("profiles").select("id", { count: "exact", head: true }).eq("role", dbRoleOf(role) ?? "").is("deleted_at", null))),
      );
      const total = counts.reduce((a, b) => a + b, 0);
      const pageCount = Math.max(1, Math.ceil(total / limit));
      const current = Math.min(page, pageCount);
      let skip = (current - 1) * limit;
      let remaining = limit;
      const found: ProfileRow[] = [];
      for (let i = 0; i < roles.length && remaining > 0; i++) {
        const n = counts[i] ?? 0;
        if (skip >= n) {
          skip -= n;
          continue;
        }
        const take = Math.min(remaining, n - skip);
        const role = roles[i] as AccountRole;
        found.push(...(await rows<ProfileRow>(profilesOfRole(role).order("full_name").order("id").range(skip, skip + take - 1))));
        remaining -= take;
        skip = 0;
      }
      return { items: await entriesOf(found, viewer), total, page: current, limit, pageCount };
    },

    async get(accountId) {
      if (!administersAccounts(viewer) || !isUuid(accountId)) return null;
      const found = await rows<ProfileRow>(db.from("profiles").select(PROFILE_COLUMNS).eq("id", accountId).is("deleted_at", null).limit(1));
      const [entry] = await entriesOf(found, viewer);
      return entry && administeredRoles(viewer).includes(entry.role) ? entry : null;
    },

    async openCreations(query) {
      const limit = clampLimit(query?.limit);
      if (!administersAccounts(viewer)) return emptyPage(limit);
      const base = (head: boolean) =>
        db
          .from("account_requests")
          .select(head ? "id" : INTENT_COLUMNS, { count: head ? "exact" : undefined, head })
          .eq("request_type", "direct_create")
          .eq("status", "approved")
          .is("target_profile_id", null)
          .eq("requested_by", viewer.id);
      const result = await paged<IntentRow>(
        () => ({
          count: base(true),
          range: (from, to) => base(false).order("created_at", { ascending: false }).order("id").range(from, to),
        }),
        clampPage(query?.page),
        limit,
      );
      const items = result.data.flatMap((r) => {
        const intent = creationIntentOf(r, viewer);
        return intent ? [intent] : [];
      });
      return { items, total: result.total, page: result.page, limit, pageCount: result.pageCount };
    },

    async creatorNotices(query) {
      const limit = clampLimit(query?.limit);
      // Creator only (D34 b, f): RLS also lets a Manager read his own audit rows.
      if (viewer?.role !== "creator" || !isUuid(viewer.id)) return emptyPage(limit);
      const filter =
        "and(action.eq.profile.deactivated,details->>actor_role.eq.manager)," +
        `and(action.eq.technician.outlook_email_changed,actor_profile_id.neq.${viewer.id})`;
      const base = (head: boolean) =>
        db
          .from("audit_logs")
          .select(head ? "id" : "id, occurred_at, action, actor_profile_id, target_table, target_id, target_is_test", {
            count: head ? "exact" : undefined,
            head,
          })
          .or(filter);
      const result = await paged<AuditRow>(
        () => ({
          count: base(true),
          range: (from, to) => base(false).order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(from, to),
        }),
        clampPage(query?.page),
        limit,
      );
      const techIds = [...new Set(result.data.filter((r) => r.target_table === "technicians" && r.target_id).map((r) => r.target_id as string))];
      const techs =
        techIds.length === 0
          ? []
          : await rows<Pick<TechnicianRow, "id" | "profile_id">>(db.from("technicians").select("id, profile_id").in("id", techIds));
      const profileOfTech = new Map(techs.map((t) => [t.id, t.profile_id]));
      const targetProfile = (r: AuditRow): string | null =>
        r.target_id === null ? null : r.target_table === "technicians" ? (profileOfTech.get(r.target_id) ?? null) : r.target_id;
      const profileIds = [
        ...new Set(
          result.data.flatMap((r) => [r.actor_profile_id, targetProfile(r)]).filter((id): id is string => typeof id === "string"),
        ),
      ];
      const people =
        profileIds.length === 0
          ? []
          : await rows<Pick<ProfileRow, "id" | "full_name" | "role">>(db.from("profiles").select("id, full_name, role").in("id", profileIds));
      const byId = new Map(people.map((p) => [p.id, p]));
      const items = result.data.flatMap((r): CreatorNotice[] => {
        const kind = r.action === "profile.deactivated" ? "manager-deactivation" : r.action === "technician.outlook_email_changed" ? "outlook-email-change" : null;
        const targetId = targetProfile(r);
        const target = targetId ? byId.get(targetId) : undefined;
        const targetRole = uiRoleOf(target?.role) ?? (kind === "outlook-email-change" ? "tech" : null);
        const actor = r.actor_profile_id ? byId.get(r.actor_profile_id) : undefined;
        if (kind === null || targetRole === null || !r.actor_profile_id) return [];
        return [
          {
            id: `audit-${r.id}`,
            kind,
            at: r.occurred_at,
            actor: { id: r.actor_profile_id, name: actor?.full_name ?? "" },
            actorRole: uiRoleOf(actor?.role),
            target: { accountId: targetId, name: target?.full_name ?? "", role: targetRole },
            requestKind: null,
            isTest: r.target_is_test,
          },
        ];
      });
      return { items, total: result.total, page: result.page, limit, pageCount: result.pageCount };
    },
  };
}
