import { useQueryClient } from "@tanstack/react-query";
import { useLogout } from "@workspace/api-client-react";
import { Loader2, LogOut, ShieldAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslation } from "@/lib/i18n";

/**
 * Ditampilkan saat user non-staff (bukan admin/super_admin) membuka web TP.
 * Nasabah memakai TradePilot lewat client area get-sgb / aplikasi mobile.
 */
export function StaffAccessDenied() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const logout = useLogout();

  const handleLogout = async () => {
    try {
      await logout.mutateAsync();
    } catch {
      // Lanjut reset state klien walau sesi server sudah tidak ada.
    }
    queryClient.cancelQueries();
    queryClient.clear();
    window.location.assign("/");
  };

  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-background px-4">
      <div
        className="w-full max-w-md rounded-2xl border border-border bg-card p-6 text-center shadow-sm"
        data-testid="staff-access-denied"
      >
        <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
        <h1 className="mt-4 text-xl font-bold text-foreground">{t.staffOnly.title}</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.staffOnly.description}</p>
        <Button
          className="mt-6 w-full"
          variant="outline"
          onClick={handleLogout}
          disabled={logout.isPending}
          data-testid="button-staff-only-logout"
        >
          {logout.isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <LogOut className="mr-2 h-4 w-4" />
          )}
          {t.staffOnly.logout}
        </Button>
      </div>
    </div>
  );
}
