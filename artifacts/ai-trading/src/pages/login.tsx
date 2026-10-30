import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod/v3";
import { Eye, EyeOff, Loader2, LogIn, CheckCircle, ShieldCheck, LockKeyhole, BadgeCheck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form, FormControl, FormField, FormItem, FormLabel, FormMessage,
} from "@/components/ui/form";
import { useToast } from "@/hooks/use-toast";
import { useLogin, getGetMeQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "@/lib/i18n";
import { LanguageToggle } from "@/components/language-toggle";
import { BrandLogo } from "@/components/brand-logo";
import { useTrackEvent } from "@/hooks/use-track-event";

type LoginRequestError = {
  status?: number;
  data?: { error?: string } | null;
};

export function loginErrorDescription(
  err: unknown,
  messages: {
    credentials: string;
    connection: string;
    service: string;
  },
): string {
  const requestError = err as LoginRequestError;
  const status = requestError?.status;
  const serverMessage = requestError?.data?.error;

  if (status === 401) return serverMessage ?? messages.credentials;
  if (status === 429 && serverMessage) return serverMessage;
  if (typeof status === "number") {
    if (status >= 500) return messages.service;
    return serverMessage ?? messages.service;
  }
  return messages.connection;
}

export default function LoginPage() {
  const { t } = useTranslation();
  const trackEvent = useTrackEvent();
  // Not wrapped in <Layout> (which tracks page views for every other
  // route), so this pre-auth funnel page tracks itself directly.
  useEffect(() => {
    trackEvent("page_view");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [showPassword, setShowPassword] = useState(false);
  const [resetSuccess] = useState(() => {
    const val = sessionStorage.getItem("password_reset_success");
    if (val === "1") {
      sessionStorage.removeItem("password_reset_success");
      return true;
    }
    return false;
  });
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const login = useLogin();

  const schema = z.object({
    email: z.string().min(1, t.auth.email_required),
    password: z.string().min(1, t.auth.password_required),
    rememberMe: z.boolean().default(false),
  });
  type FormValues = z.infer<typeof schema>;

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "", rememberMe: false },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await login.mutateAsync({
        data: { email: values.email, password: values.password, rememberMe: values.rememberMe },
      });
      queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
      setLocation("/admin");
    } catch (err: unknown) {
      toast({
        title: t.auth.login_failed,
        description: loginErrorDescription(err, {
          credentials: t.auth.login_error,
          connection: t.auth.login_connection_error,
          service: t.auth.login_service_error,
        }),
        variant: "destructive",
      });
    }
  };

  return (
    <main className="tp-admin min-h-[100dvh] bg-background text-foreground lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(440px,0.92fr)]">
      <section className="relative hidden overflow-hidden border-r border-border bg-[#080a0d] p-10 text-white lg:flex lg:flex-col lg:justify-between xl:p-14">
        <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          <div className="absolute -left-24 top-20 h-72 w-72 rounded-full bg-amber-400/10 blur-[100px]" />
          <div className="absolute bottom-0 right-0 h-px w-3/4 bg-gradient-to-l from-amber-400/60 to-transparent" />
          <div className="absolute inset-0 opacity-[0.035] [background-image:linear-gradient(rgba(255,255,255,.8)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.8)_1px,transparent_1px)] [background-size:48px_48px]" />
        </div>

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-400/25 bg-amber-400/10">
            <BrandLogo className="h-7 w-7" />
          </div>
          <div>
            <p className="text-lg font-bold tracking-tight">{t.auth.admin_product_name}</p>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-400">{t.auth.admin_product_tagline}</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-amber-400/25 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-amber-300">
            <ShieldCheck className="h-4 w-4" />
            {t.auth.admin_access_badge}
          </div>
          <h1 className="max-w-lg text-4xl font-semibold leading-[1.08] tracking-[-0.035em] xl:text-5xl">
            {t.auth.admin_login_title}
          </h1>
          <p className="mt-5 max-w-lg text-base leading-7 text-slate-400">
            {t.auth.admin_login_subtitle}
          </p>
          <div className="mt-10 flex items-center gap-3 border-t border-white/10 pt-6 text-sm text-slate-400">
            <BadgeCheck className="h-5 w-5 text-amber-400" />
            {t.auth.authorized_accounts_only}
          </div>
        </div>

        <p className="relative text-xs text-slate-600">{t.auth.secure_access_footer}</p>
      </section>

      <section className="flex min-h-[100dvh] flex-col">
        <div className="flex items-center justify-between px-5 py-5 sm:px-8">
          <div className="flex items-center gap-2.5 lg:hidden">
            <BrandLogo className="h-8 w-8" />
            <span className="font-bold tracking-tight">{t.auth.admin_product_name}</span>
          </div>
          <div className="ml-auto"><LanguageToggle /></div>
        </div>

        <div className="flex flex-1 items-center justify-center px-5 pb-12 pt-4 sm:px-8 lg:py-12">
          <div className="w-full max-w-md">
            <div className="mb-8">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-foreground lg:hidden">
                <ShieldCheck className="h-4 w-4 text-primary" />
                {t.auth.admin_access_badge}
              </div>
              <h2 className="text-3xl font-semibold tracking-[-0.025em]">{t.auth.welcome_back}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{t.auth.welcome_subtitle}</p>
            </div>

        {resetSuccess && (
          <div
            className="flex items-start gap-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-2xl p-4 mb-4"
            data-testid="banner-reset-success"
            role="alert"
          >
            <CheckCircle className="w-5 h-5 text-green-600 dark:text-green-400 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">{t.auth.reset_success_title}</p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">{t.auth.reset_success_subtitle}</p>
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_18px_50px_-28px_rgba(0,0,0,0.45)] sm:p-7">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5" data-testid="form-login">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t.auth.username_email_label}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="email"
                        placeholder={t.auth.username_placeholder}
                        autoComplete="username"
                        data-testid="input-email"
                        className="h-12 rounded-lg bg-background"
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t.auth.password_label}
                    </FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          {...field}
                          type={showPassword ? "text" : "password"}
                          placeholder={t.auth.password_placeholder}
                          autoComplete="current-password"
                          data-testid="input-password"
                          className="h-12 rounded-lg bg-background pr-12"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPassword((v) => !v)}
                          aria-label={showPassword ? t.auth.hide_password : t.auth.show_password}
                          className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                          data-testid="button-toggle-password"
                        >
                          {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                        </button>
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="rememberMe"
                render={({ field }) => (
                  <FormItem className="flex items-center gap-2.5">
                    <FormControl>
                      <Checkbox
                        checked={field.value}
                        onCheckedChange={field.onChange}
                        data-testid="checkbox-remember-me"
                      />
                    </FormControl>
                    <FormLabel className="!mt-0 text-sm font-normal cursor-pointer text-muted-foreground">
                      {t.auth.remember_me}
                    </FormLabel>
                  </FormItem>
                )}
              />

              <button
                type="submit"
                className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-primary font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:opacity-60"
                disabled={login.isPending}
                data-testid="button-submit-login"
              >
                {login.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
                {login.isPending ? t.auth.logging_in : t.auth.login_btn}
              </button>
            </form>
          </Form>

          <div className="mt-5 text-center">
            <Link href="/forgot-password">
              <button className="text-sm text-primary hover:underline font-medium" data-testid="link-forgot-password">
                {t.auth.forgot_password}
              </button>
            </Link>
          </div>
        </div>

            <div className="mt-5 flex items-start gap-3 rounded-xl border border-border bg-muted/45 p-4 text-sm text-muted-foreground">
              <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <p className="leading-5">{t.auth.credential_notice}</p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
