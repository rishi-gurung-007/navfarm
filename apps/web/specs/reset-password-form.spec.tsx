import React from 'react';
import { render, screen } from '@testing-library/react';
import { ResetPasswordForm } from '../src/modules/auth/components/ResetPasswordForm';

/**
 * ResetPasswordForm never called an API — there is no reset-link endpoint —
 * so the old "submitted" state claiming an email was sent was a lie. These
 * guard that the screen states the truth (an administrator handles resets)
 * without making any network call, and still offers a way back to sign in.
 */
jest.mock('../src/hooks/useLanguage', () => ({ useLanguage: () => ({ t: (key: string) => key }) }));

describe('ResetPasswordForm', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it('shows the administrator message and a link back to sign in, with no network call', () => {
    render(<ResetPasswordForm />);

    expect(screen.getByText('authResetHandledByAdmin')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'authBackToSignIn' }).getAttribute('href')).toBe('/login');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
