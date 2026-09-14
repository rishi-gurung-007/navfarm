import React from 'react';
import { render, screen } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import Page from '../src/app/page';

jest.mock('next/navigation', () => ({
  useRouter: jest.fn(),
}));

describe('Page', () => {
  beforeEach(() => localStorage.clear());
  it('sends an unauthenticated user to login', () => {
    const replace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    localStorage.clear();

    render(<Page />);

    expect(screen.getByText('Farm')).toBeTruthy(); // the brand mark on the interstitial while the redirect resolves
    expect(replace).toHaveBeenCalledWith('/login');
  });

  it('sends an authenticated user to the dashboard', () => {
    localStorage.setItem('navfarm_access_token', 'stored-token');
    const replace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    localStorage.setItem('navfarm_auth_user', JSON.stringify({ email: 'demo@navfarm.com' }));

    render(<Page />);

    expect(replace).toHaveBeenCalledWith('/dashboard');
  });

  it('sends a system admin to the admin area', () => {
    localStorage.setItem('navfarm_access_token', 'stored-token');
    const replace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    localStorage.setItem(
      'navfarm_auth_user',
      JSON.stringify({ email: 'admin@navfarm.com', userType: 'SYSTEM_ADMIN' }),
    );

    render(<Page />);

    expect(replace).toHaveBeenCalledWith('/admin');
  });

  it('sends a user with unreadable stored auth back to login', () => {
    const replace = jest.fn();
    (useRouter as jest.Mock).mockReturnValue({ replace });
    localStorage.setItem('navfarm_auth_user', 'not-json');

    render(<Page />);

    expect(replace).toHaveBeenCalledWith('/login');
  });
});
