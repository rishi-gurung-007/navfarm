'use client';

import { restoreSessionCookie } from '@/lib/api-client';
import { useEffect } from 'react';
import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { ThemeSelector } from '@/components/ui/theme-selector';
import { LanguageSelector } from '@/components/ui/language-selector';
import { getStoredToken, getStoredUser } from '@/hooks/useAuth';

const NAVFARM_LOGO_SRC = "https://nav-cdn.pages.dev/images/favicon.png";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();

  // A signed-in user landing on /login or /signup (e.g. the back button,
  // a stale bookmark) should go straight back into the app, not see a
  // form asking them to sign in to an account they're already in. Scoped
  // to just these two — /reset-password stays reachable while signed in.
  useEffect(() => {
    if (pathname !== '/login' && pathname !== '/signup') return;
    const user = getStoredUser();
    if (getStoredToken() && user && restoreSessionCookie()) {
      router.replace(user.userType === 'SYSTEM_ADMIN' ? '/admin/dashboard' : '/dashboard');
    }
  }, [pathname, router]);

  return (
    <div className="min-h-screen flex relative">
      <div className="absolute right-4 top-4 z-20 flex items-center gap-2 md:right-6 md:top-6">
        <LanguageSelector />
        <ThemeSelector />
      </div>

      {/* Left branding panel — a deliberately deeper surface than the form
          panel, in both themes: --sidebar-bg is already the token the rest
          of the app uses for exactly this (navy in light mode, near-black
          in dark mode), so this panel tracks the active theme instead of
          being frozen at one fixed color regardless of it. */}
      <div data-testid="auth-branding-panel" className="hidden md:flex md:w-[55%] bg-(--sidebar-bg) relative overflow-hidden">
        <div className="relative z-10 flex flex-col justify-between p-12 w-full">
          <Link href="/" className="flex items-center gap-2">
            <img src={NAVFARM_LOGO_SRC} alt="Navfarm" className="h-8 w-8 rounded-[var(--radius-xs)]" />
            {/* This panel is always a dark surface (navy in light mode,
                near-black in dark mode — see --sidebar-bg), so the accent
                must be the on-dark variant in both. --color-primary has no
                dark override and sits at 2.55:1 here; --sidebar-active-accent
                is the token that already exists for brand accent on dark
                chrome (3.74:1 light, 4.31:1 dark) and tracks the theme. */}
            <span className="text-xl font-semibold text-white tracking-tight">
              NAV<span className="text-(--sidebar-active-accent)">Farm</span>
            </span>
          </Link>

          <div className="animate-fade-in">
            {/* Global `h1{color:var(--text-primary)}` is unlayered CSS and beats
                the layered Tailwind `text-white` utility regardless of theme —
                in light mode --text-primary is near-navy, same family as this
                panel's --sidebar-bg, making the heading unreadable. An inline
                style is the one thing guaranteed to win that cascade. */}
            <h1 className="nf-text-display mb-4" style={{ color: 'var(--text-inverse)' }}>
              {t('authTagline')}
              <br />
              {t('authTaglineLine2')}
            </h1>
            <p className="text-white/60 text-lg max-w-md leading-relaxed">
              {t('authSubheading')}
            </p>
          </div>

          <p className="text-white/30 text-sm">
            © {new Date().getFullYear()} Navfarm. {t('authAllRightsReserved')}
          </p>
        </div>
      </div>

      {/* Right form panel */}
      <div data-testid="auth-form-panel" className="flex-1 flex flex-col bg-(--bg)">
        {/* Mobile logo */}
        <div className="md:hidden px-6 pt-8 pb-4">
          <Link href="/" className="inline-flex items-center gap-2">
            <img src={NAVFARM_LOGO_SRC} alt="Navfarm" className="h-7 w-7 rounded-[var(--radius-xs)]" />
            <span className="text-lg font-semibold text-(--text-primary) tracking-tight">
              NAV<span className="text-(--accent)">Farm</span>
            </span>
          </Link>
        </div>

        <main className="flex-1 flex items-center justify-center px-6 py-12">
          <div className="w-full max-w-sm animate-slide-up">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
