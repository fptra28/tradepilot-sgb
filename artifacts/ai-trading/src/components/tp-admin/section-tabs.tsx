import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useTranslation, type Translations } from "@/lib/i18n";
import { useAuth } from "@/components/auth-provider";

type TabKey = keyof Translations["tpAdmin"];
type SectionTab = { href: string; key: TabKey; superAdminOnly?: boolean };

/**
 * Menu sidebar digabung per kelompok; halaman di dalam satu kelompok
 * dipisah sebagai tab yang masing-masing tetap punya URL sendiri.
 */
export const ADMIN_SECTIONS = {
  monitor: [
    { href: "/admin", key: "tab_overview" },
    { href: "/admin/health", key: "tab_health" },
  ],
  users: [
    { href: "/admin/users", key: "tab_user_list" },
    { href: "/admin/users/credits", key: "tab_credits" },
  ],
  settings: [
    { href: "/admin/settings", key: "tab_availability", superAdminOnly: true },
    { href: "/admin/settings/staff", key: "tab_staff", superAdminOnly: true },
    { href: "/admin/settings/audit", key: "tab_audit" },
  ],
} satisfies Record<string, SectionTab[]>;

export type AdminSection = keyof typeof ADMIN_SECTIONS;

export function visibleTabs(section: AdminSection, role: string | undefined): SectionTab[] {
  return (ADMIN_SECTIONS[section] as SectionTab[]).filter((tab) => !tab.superAdminOnly || role === "super_admin");
}

export function SectionTabs({ section }: { section: AdminSection }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [location] = useLocation();
  const tabs = visibleTabs(section, user?.role);
  if (tabs.length < 2) return null;

  return (
    <nav aria-label={t.tpAdmin.section_tabs_label} className="-mt-1 overflow-x-hidden border-b border-border">
      <div className="flex min-w-max gap-1">
        {tabs.map((tab) => {
          const active = location === tab.href;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative -mb-px inline-flex h-10 items-center whitespace-nowrap border-b-2 px-3 text-[13px] font-medium transition",
                active
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {String(t.tpAdmin[tab.key])}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
