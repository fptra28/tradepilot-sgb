import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "./auth-provider";
import { StaffAccessDenied } from "./staff-access-denied";
import { Loader2 } from "lucide-react";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: "admin" | "super_admin";
}

/**
 * Web TP kini khusus staff: semua halaman yang butuh login hanya untuk role
 * `admin` dan `super_admin`. User biasa melihat halaman "akses ditolak"
 * (nasabah memakai TradePilot lewat client area get-sgb / aplikasi mobile).
 * `requiredRole="super_admin"` tetap membatasi halaman tertentu ke super_admin.
 */
export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();
  const isStaff = user?.role === "admin" || user?.role === "super_admin";
  const lacksSuperAdmin = requiredRole === "super_admin" && user?.role !== "super_admin";

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) {
      setLocation("/login");
      return;
    }
    // Admin yang membuka halaman super_admin dikembalikan ke halaman staff biasa.
    if (isStaff && lacksSuperAdmin) {
      setLocation("/admin");
    }
  }, [isLoading, isAuthenticated, isStaff, lacksSuperAdmin, setLocation]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  if (!isStaff) return <StaffAccessDenied />;

  if (lacksSuperAdmin) return null;

  return <>{children}</>;
}
