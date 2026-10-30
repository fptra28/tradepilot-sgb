import { useState, type FormEvent } from "react";
import { KeyRound, Loader2, Plus, Save, ShieldOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/components/auth-provider";
import { AdminShell } from "@/components/tp-admin/admin-shell";
import { SectionTabs } from "@/components/tp-admin/section-tabs";
import {
  AdminApiError,
  changeStaffRole,
  createStaff,
  formatDateTime,
  resetStaffPassword,
  useStaff,
  type StaffMember,
  type StaffRole,
} from "@/lib/tp-admin-api";
import { PageHeader, Panel, QueryState, TableShell, td, th } from "@/components/tp-admin/ui";

type Message = { tone: "ok" | "error"; text: string };

function errorMessage(error: unknown, t: ReturnType<typeof useTranslation>["t"]) {
  const code = error instanceof AdminApiError ? error.code : null;
  if (code === "already_staff") return t.tpAdmin.staff_error_already_staff;
  if (code === "password_required") return t.tpAdmin.staff_error_password_required;
  if (code === "cannot_change_self") return t.tpAdmin.staff_error_self_role;
  if (code === "last_super_admin") return t.tpAdmin.staff_error_last_super_admin;
  if (error instanceof AdminApiError && error.status === 403) return t.tpAdmin.staff_error_forbidden;
  return t.tpAdmin.staff_error_generic;
}

function CreateStaffForm({ onSaved }: { onSaved: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<StaffRole>("admin");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setPending(true);
    setMessage(null);
    try {
      await createStaff({
        email: email.trim().toLowerCase(),
        displayName: displayName.trim() || undefined,
        role,
        password: password || undefined,
      });
      setEmail("");
      setDisplayName("");
      setPassword("");
      setRole("admin");
      setMessage({ tone: "ok", text: t.tpAdmin.staff_created });
      await onSaved();
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setPending(false);
    }
  };

  return (
    <Panel title={t.tpAdmin.staff_create_title}>
      <p className="mb-4 text-xs text-muted-foreground">{t.tpAdmin.staff_create_desc}</p>
      <form onSubmit={(event) => void submit(event)} className="grid gap-4 md:grid-cols-2 xl:grid-cols-5" data-testid="form-staff-create">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t.tpAdmin.staff_email}
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder={t.tpAdmin.staff_email_placeholder}
            className="h-10 rounded-lg border border-input bg-[hsl(var(--control))] px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t.tpAdmin.staff_name}
          <input
            type="text"
            maxLength={80}
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder={t.tpAdmin.staff_name_placeholder}
            className="h-10 rounded-lg border border-input bg-[hsl(var(--control))] px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t.tpAdmin.staff_role}
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as StaffRole)}
            className="h-10 rounded-lg border border-input bg-[hsl(var(--control))] px-3 text-[13px] text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
          >
            <option value="admin">{t.tpAdmin.role_admin}</option>
            <option value="super_admin">{t.tpAdmin.role_super_admin}</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          {t.tpAdmin.staff_initial_password}
          <input
            type="password"
            minLength={8}
            maxLength={200}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={t.tpAdmin.staff_password_placeholder}
            autoComplete="new-password"
            className="h-10 rounded-lg border border-input bg-[hsl(var(--control))] px-3 text-[13px] text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-ring/20"
          />
        </label>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-primary px-4 text-xs font-semibold text-primary-foreground transition hover:brightness-105 disabled:opacity-50"
          >
            {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t.tpAdmin.staff_create}
          </button>
        </div>
      </form>
      {message ? (
        <p role="status" className="mt-3 text-xs" style={{ color: message.tone === "ok" ? "var(--viz-good)" : "var(--viz-critical)" }}>
          {message.text}
        </p>
      ) : null}
    </Panel>
  );
}

function StaffActions({ member, isSelf, onSaved }: { member: StaffMember; isSelf: boolean; onSaved: () => Promise<unknown> }) {
  const { t } = useTranslation();
  const [role, setRole] = useState<StaffRole | "user">(member.role);
  const [confirmRole, setConfirmRole] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState(false);
  const [pending, setPending] = useState<"role" | "password" | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const saveRole = async () => {
    if (!confirmRole) {
      setConfirmRole(true);
      return;
    }
    setPending("role");
    setMessage(null);
    try {
      await changeStaffRole(member.id, role);
      setMessage({ tone: "ok", text: role === "user" ? t.tpAdmin.staff_access_revoked : t.tpAdmin.staff_role_saved });
      await onSaved();
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setPending(null);
      setConfirmRole(false);
    }
  };

  const savePassword = async () => {
    if (password.length < 8) return;
    if (!confirmPassword) {
      setConfirmPassword(true);
      return;
    }
    setPending("password");
    setMessage(null);
    try {
      await resetStaffPassword(member.id, password);
      setPassword("");
      setMessage({ tone: "ok", text: t.tpAdmin.staff_password_saved });
      await onSaved();
    } catch (error) {
      setMessage({ tone: "error", text: errorMessage(error, t) });
    } finally {
      setPending(null);
      setConfirmPassword(false);
    }
  };

  return (
    <div className="min-w-[300px] max-w-[340px] space-y-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <select
          value={role}
          disabled={isSelf || pending !== null}
          onChange={(event) => {
            setRole(event.target.value as StaffRole | "user");
            setConfirmRole(false);
          }}
          aria-label={t.tpAdmin.staff_role}
          className="h-8 rounded-lg border border-input bg-[hsl(var(--control))] px-2.5 text-xs text-foreground outline-none transition focus:border-primary/60 focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
        >
          <option value="admin">{t.tpAdmin.role_admin}</option>
          <option value="super_admin">{t.tpAdmin.role_super_admin}</option>
          <option value="user">{t.tpAdmin.staff_revoke_access}</option>
        </select>
        <button
          type="button"
          disabled={isSelf || role === member.role || pending !== null}
          onClick={() => void saveRole()}
          className={confirmRole
            ? "inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--viz-critical)] px-2.5 text-xs font-medium text-white disabled:opacity-50"
            : "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-foreground transition hover:border-primary/30 hover:bg-accent disabled:opacity-50"}
          data-testid={`button-staff-role-${member.id}`}
        >
          {pending === "role" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : role === "user" ? <ShieldOff className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {confirmRole ? t.tpAdmin.staff_confirm_change : t.tpAdmin.staff_save_role}
        </button>
        {confirmRole ? (
          <button type="button" onClick={() => setConfirmRole(false)} className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            {t.tpAdmin.cancel}
          </button>
        ) : null}
        {isSelf ? <span className="text-[11px] text-muted-foreground">{t.tpAdmin.staff_current_account}</span> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="password"
          minLength={8}
          maxLength={200}
          value={password}
          disabled={pending !== null}
          onChange={(event) => {
            setPassword(event.target.value);
            setConfirmPassword(false);
          }}
          placeholder={t.tpAdmin.staff_new_password_placeholder}
          aria-label={t.tpAdmin.staff_new_password}
          autoComplete="new-password"
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-[hsl(var(--control))] px-2.5 text-xs text-foreground outline-none transition placeholder:text-muted-foreground/60 focus:border-primary/60 focus:ring-2 focus:ring-ring/20 disabled:opacity-50"
        />
        <button
          type="button"
          disabled={password.length < 8 || pending !== null}
          onClick={() => void savePassword()}
          className={confirmPassword
            ? "inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--viz-critical)] px-2.5 text-xs font-medium text-white disabled:opacity-50"
            : "inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs text-foreground transition hover:border-primary/30 hover:bg-accent disabled:opacity-50"}
          data-testid={`button-staff-password-${member.id}`}
        >
          {pending === "password" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <KeyRound className="h-3.5 w-3.5" />}
          {confirmPassword ? t.tpAdmin.staff_confirm_reset : t.tpAdmin.staff_reset_password}
        </button>
        {confirmPassword ? (
          <button type="button" onClick={() => setConfirmPassword(false)} className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground">
            {t.tpAdmin.cancel}
          </button>
        ) : null}
      </div>
      {message ? (
        <p role="status" className="text-xs" style={{ color: message.tone === "ok" ? "var(--viz-good)" : "var(--viz-critical)" }}>
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

export default function TpAdminStaffPage() {
  const { t, lang } = useTranslation();
  const { user } = useAuth();
  const query = useStaff();
  const members = query.data?.items ?? [];

  return (
    <AdminShell>
      <SectionTabs section="settings" />
      <PageHeader title={t.tpAdmin.staff_title} subtitle={t.tpAdmin.staff_subtitle} />
      <CreateStaffForm onSaved={() => query.refetch()} />
      <Panel bodyClassName="p-0">
        <QueryState
          isLoading={query.isLoading}
          error={query.error}
          onRetry={() => void query.refetch()}
          isEmpty={members.length === 0}
        >
          <TableShell>
            <table className="w-full">
              <thead>
                <tr>
                  <th className={th}>{t.tpAdmin.staff_account}</th>
                  <th className={th}>{t.tpAdmin.staff_role}</th>
                  <th className={th}>{t.tpAdmin.staff_created_at}</th>
                  <th className={th}>{t.tpAdmin.staff_last_session}</th>
                  <th className={th}>{t.tpAdmin.staff_password_status}</th>
                  <th className={th}>{t.tpAdmin.staff_actions}</th>
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-t border-border align-top transition hover:bg-accent/40">
                    <td className={`${td} whitespace-normal`}>
                      <p className="font-medium">{member.displayName}</p>
                      <p className="text-xs text-muted-foreground">{member.email} · #{member.id}</p>
                    </td>
                    <td className={td}>{member.role === "super_admin" ? t.tpAdmin.role_super_admin : t.tpAdmin.role_admin}</td>
                    <td className={`${td} text-muted-foreground`}>{formatDateTime(member.createdAt, lang)}</td>
                    <td className={`${td} text-muted-foreground`}>{formatDateTime(member.lastSessionAt, lang)}</td>
                    <td className={td}>{member.hasPassword ? t.tpAdmin.staff_password_set : t.tpAdmin.staff_password_not_set}</td>
                    <td className={td}>
                      <StaffActions member={member} isSelf={Number(user?.id) === member.id} onSaved={() => query.refetch()} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableShell>
        </QueryState>
      </Panel>
    </AdminShell>
  );
}
