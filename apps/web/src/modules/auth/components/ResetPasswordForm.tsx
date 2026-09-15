'use client';

import Link from 'next/link';
import { ShieldQuestion } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';

/**
 * This screen never calls the API — there is no reset-link endpoint to call —
 * so it must never claim one was sent. It states who actually resets a
 * password (the company administrator) and sends the user back to sign in.
 * MFA stays out of this flow, as it always has.
 */
export function ResetPasswordForm() {
  const { t } = useLanguage();

  return (
    <div className="text-center">
      <div className="flex justify-center mb-6">
        <div className="w-16 h-16 rounded-full bg-(--accent-muted) flex items-center justify-center">
          <ShieldQuestion size={28} className="text-(--accent)" />
        </div>
      </div>
      <h1 className="text-3xl font-semibold text-(--text-primary) tracking-tight mb-2">
        {t('authResetPassword')}
      </h1>
      <p className="text-(--text-secondary) text-[15px] mb-8 leading-relaxed">
        {t('authResetHandledByAdmin')}
      </p>
      <p className="text-[14px]">
        <Link
          href="/login"
          className="font-medium text-(--text-primary) hover:text-(--accent) transition-colors"
        >
          {t('authBackToSignIn')}
        </Link>
      </p>
    </div>
  );
}
