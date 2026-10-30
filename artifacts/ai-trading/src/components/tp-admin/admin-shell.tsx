import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import {
  ChevronRight,
  FileSearch,
  LayoutDashboard,
  Loader2,
  LogOut,
  Menu,
  Moon,
  Settings2,
  Sun,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/components/auth-provider";
import { useTheme } from "@/components/theme-provider";
import { LanguageToggle } from "@/components/language-toggle";

type NavItem = {
  href: string | ((role: string | undefined) => string);
  key: "nav_overview" | "nav_analyses" | "nav_users" | "nav_settings";
  icon: typeof LayoutDashboard;
  isActive: (location: string) => boolean;
};

/** Sidebar ringkas: sub-halaman tiap menu ditampilkan sebagai tab (lihat section-tabs.tsx). */
const NAV: NavItem[] = [
  { href: "/admin", key: "nav_overview", icon: LayoutDashboard, isActive: (l) => l === "/admin" || l === "/admin/health" },
  { href: "/admin/analyses", key: "nav_analyses", icon: FileSearch, isActive: (l) => l.startsWith("/admin/analyses") },
  { href: "/admin/users", key: "nav_users", icon: Users, isActive: (l) => l.startsWith("/admin/users") },
  {
    // Admin biasa hanya punya akses ke tab log aktivitas.
    href: (role) => (role === "super_admin" ? "/admin/settings" : "/admin/settings/audit"),
    key: "nav_settings",
    icon: Settings2,
    isActive: (l) => l.startsWith("/admin/settings"),
  },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [location] = useLocation();

  return (
    <nav className="space-y-1" aria-label={t.tpAdmin.console_name}>
      {NAV.map((item) => {
        const href = typeof item.href === "function" ? item.href(user?.role) : item.href;
        const active = item.isActive(location);
        const Icon = item.icon;
        return (
          <Link
            key={item.key}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex min-h-11 items-center gap-3 rounded-[10px] px-3 text-[13px] font-medium transition-all duration-200",
              active
                ? "bg-primary/12 text-primary shadow-[inset_0_0_0_1px_hsl(var(--primary)/0.12)]"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {active ? <span className="absolute -left-3 h-6 w-0.5 rounded-r-full bg-primary" /> : null}
            <Icon className={cn("h-[17px] w-[17px] shrink-0 stroke-[1.75]", active && "text-primary")} />
            <span className="truncate">{t.tpAdmin[item.key]}</span>
            <ChevronRight className={cn("ml-auto h-3.5 w-3.5 opacity-0 transition", active && "opacity-60", !active && "group-hover:opacity-40")} />
          </Link>
        );
      })}
    </nav>
  );
}

function ThemeButton({ expanded = false }: { expanded?: boolean }) {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark" || (theme === "system" && typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className={cn("inline-flex h-9 items-center justify-center rounded-lg border border-border text-muted-foreground transition hover:border-primary/40 hover:bg-accent hover:text-foreground", expanded ? "gap-2 px-3 text-xs" : "w-9")}
      aria-label={t.tpAdmin.theme_toggle}
      title={t.tpAdmin.theme_toggle}
    >
      {isDark ? <Sun className="h-4 w-4 stroke-[1.75]" /> : <Moon className="h-4 w-4 stroke-[1.75]" />}
      {expanded ? t.tpAdmin.theme_toggle : null}
    </button>
  );
}

function AccountFooter({ mobile = false }: { mobile?: boolean }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const logout = useLogout();
  const initial = (user?.displayName || user?.email || "A").trim().slice(0, 1).toUpperCase();

  const handleLogout = async () => {
    try { await logout.mutateAsync(); } catch { /* Bersihkan state klien walau sesi server sudah habis. */ }
    queryClient.cancelQueries();
    queryClient.clear();
    window.location.assign("/login");
  };

  return (
    <div className="border-t border-border pt-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-sm font-semibold text-primary">{initial}</div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold text-foreground">{user?.displayName || user?.email}</p>
          <p className="truncate text-[11px] text-muted-foreground">{user?.role === "super_admin" ? t.tpAdmin.role_super_admin : t.tpAdmin.role_admin}</p>
        </div>
      </div>
      <div className={cn("mt-4 flex items-center gap-2", mobile && "grid grid-cols-3")}>
        <LanguageToggle className={cn("h-9 w-9 rounded-lg bg-transparent", mobile && "w-full")} />
        <ThemeButton expanded={mobile} />
        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={logout.isPending}
          className={cn("ml-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-border px-3 text-xs text-muted-foreground transition hover:border-primary/40 hover:bg-accent hover:text-foreground disabled:opacity-50", mobile && "ml-0")}
          data-testid="button-admin-logout"
        >
          {logout.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5 stroke-[1.75]" />}
          {t.tpAdmin.logout}
        </button>
      </div>
    </div>
  );
}

function Brand() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-primary/25 bg-primary/10"><img src="/logo-compact.png" alt="" className="h-6 w-6 object-contain" /></div>
      <div className="min-w-0 leading-tight">
        <p className="truncate text-[15px] font-semibold tracking-[-0.01em] text-foreground">{t.tpAdmin.console_name}</p>
        <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{t.tpAdmin.console_tagline}</p>
      </div>
    </div>
  );
}

/** Layout command-center: sidebar desktop dan drawer overlay pada mobile. */
export function AdminShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => setMenuOpen(false), [location]);
  useEffect(() => {
    if (!menuOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, [menuOpen]);

  return (
    <div className="tp-admin min-h-[100dvh] bg-background text-foreground">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[232px] flex-col border-r border-border bg-[hsl(var(--sidebar))] px-3 py-5 lg:flex">
        <div className="px-1"><Brand /></div>
        <div className="mt-8 flex-1 overflow-y-auto"><NavLinks /></div>
        <AccountFooter />
      </aside>

      <header className="sticky top-0 z-30 flex h-[64px] items-center justify-between border-b border-border bg-[hsl(var(--sidebar)/0.96)] px-4 backdrop-blur lg:hidden">
        <Brand />
        <button type="button" onClick={() => setMenuOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border text-foreground transition hover:border-primary/40 hover:bg-accent" aria-expanded={menuOpen} aria-label={t.tpAdmin.menu_open}>
          <Menu className="h-5 w-5 stroke-[1.75]" />
        </button>
      </header>

      {menuOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button type="button" aria-label={t.tpAdmin.menu_close} className="absolute inset-0 bg-black/70" onClick={() => setMenuOpen(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[min(86vw,330px)] flex-col border-r border-border bg-[hsl(var(--sidebar))] px-4 py-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <Brand />
              <button type="button" onClick={() => setMenuOpen(false)} className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={t.tpAdmin.menu_close}><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-8 flex-1 overflow-y-auto"><NavLinks onNavigate={() => setMenuOpen(false)} /></div>
            <AccountFooter mobile />
          </aside>
        </div>
      ) : null}

      <main className="lg:pl-[232px]">
        <div className="mx-auto w-full max-w-[1680px] space-y-5 px-4 py-5 sm:px-6 sm:py-6 xl:px-8 xl:py-8">{children}</div>
      </main>
    </div>
  );
}
