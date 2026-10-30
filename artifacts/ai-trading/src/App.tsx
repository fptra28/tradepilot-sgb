import { Switch, Route, Router as WouterRouter, useLocation, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme-provider";
import { LanguageProvider } from "@/lib/i18n";
import { AuthProvider, useAuth } from "@/components/auth-provider";
import { ProtectedRoute } from "@/components/protected-route";
import NotFound from "@/pages/not-found";
import LoginPage from "@/pages/login";
import ForgotPasswordPage from "@/pages/forgot-password";
import LegalPage from "@/pages/legal";
import TpAdminOverviewPage from "@/pages/tp-admin/overview";
import TpAdminAnalysesPage from "@/pages/tp-admin/analyses";
import TpAdminAnalysisDetailPage from "@/pages/tp-admin/analysis-detail";
import TpAdminUsersPage from "@/pages/tp-admin/users";
import TpAdminUserDetailPage from "@/pages/tp-admin/user-detail";
import TpAdminCreditsAlertsPage from "@/pages/tp-admin/credits-alerts";
import TpAdminAuditPage from "@/pages/tp-admin/audit";
import TpAdminStaffPage from "@/pages/tp-admin/staff";
import TpAdminQuotaSettingsPage from "@/pages/tp-admin/quota-settings";
import TpAdminHealthPage from "@/pages/tp-admin/health";
import { useEffect } from "react";

/*
 * Web TP = konsol admin TradePilot v1 (khusus admin & super_admin).
 * Nasabah memakai TradePilot lewat client area get-sgb / aplikasi mobile.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30 * 1000,
      retry: false,
    },
  },
});

const ADMIN_HOME = "/admin";

function AuthRedirect({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isLoading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && isAuthenticated && location === "/login") {
      setLocation(ADMIN_HOME);
    }
  }, [isAuthenticated, isLoading, location, setLocation]);

  return <>{children}</>;
}

function HomeRedirect() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  return <Redirect to={isAuthenticated ? ADMIN_HOME : "/login"} />;
}

function Router() {
  return (
    <AuthRedirect>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/login" component={LoginPage} />
        <Route path="/forgot-password" component={ForgotPasswordPage} />
        <Route path="/privacy">
          <LegalPage kind="privacy" />
        </Route>
        <Route path="/privacy-policy">
          <Redirect to="/privacy" />
        </Route>
        <Route path="/terms">
          <LegalPage kind="terms" />
        </Route>
        <Route path="/support">
          <LegalPage kind="support" />
        </Route>
        <Route path="/delete-account">
          <LegalPage kind="delete-account" />
        </Route>
        {/* Rute lama (dashboard nasabah) diarahkan ke konsol admin. */}
        <Route path="/dashboard">
          <Redirect to={ADMIN_HOME} />
        </Route>
        <Route path="/admin">
          <ProtectedRoute>
            <TpAdminOverviewPage />
          </ProtectedRoute>
        </Route>
        <Route path="/admin/analyses">
          <ProtectedRoute>
            <TpAdminAnalysesPage />
          </ProtectedRoute>
        </Route>
        <Route path="/admin/analyses/:id">
          {(params) => (
            <ProtectedRoute>
              <TpAdminAnalysisDetailPage params={params} />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/admin/users">
          <ProtectedRoute>
            <TpAdminUsersPage />
          </ProtectedRoute>
        </Route>
        <Route path="/admin/users/credits">
          <ProtectedRoute>
            <TpAdminCreditsAlertsPage />
          </ProtectedRoute>
        </Route>
        <Route path="/admin/users/:userId">
          {(params) => (
            <ProtectedRoute>
              <TpAdminUserDetailPage params={params} />
            </ProtectedRoute>
          )}
        </Route>
        <Route path="/admin/health">
          <ProtectedRoute>
            <TpAdminHealthPage />
          </ProtectedRoute>
        </Route>
        <Route path="/admin/settings">
          <ProtectedRoute requiredRole="super_admin">
            <TpAdminQuotaSettingsPage />
          </ProtectedRoute>
        </Route>
        <Route path="/admin/settings/staff">
          <ProtectedRoute requiredRole="super_admin">
            <TpAdminStaffPage />
          </ProtectedRoute>
        </Route>
        <Route path="/admin/settings/audit">
          <ProtectedRoute>
            <TpAdminAuditPage />
          </ProtectedRoute>
        </Route>
        {/* URL lama sebelum menu digabung. */}
        <Route path="/admin/credits">
          <Redirect to="/admin/users/credits" />
        </Route>
        <Route path="/admin/audit">
          <Redirect to="/admin/settings/audit" />
        </Route>
        <Route path="/admin/staff">
          <Redirect to="/admin/settings/staff" />
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AuthRedirect>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme="dark" storageKey="ai-trading-theme">
        <LanguageProvider>
          <TooltipProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
              <AuthProvider>
                <Router />
              </AuthProvider>
            </WouterRouter>
            <Toaster />
          </TooltipProvider>
        </LanguageProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
