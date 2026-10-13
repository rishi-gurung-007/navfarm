'use client';

import React from 'react';
import { ToastContainer, Slide } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import { AuthProvider } from '@/contexts/AuthContext';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { LanguageProvider } from '@/hooks/useLanguage';
import { ConfirmHost } from '@/components/ui/confirm-dialog';

function ThemedToastContainer() {
  const { theme } = useTheme();
  return (
    <ToastContainer
      position="top-right"
      transition={Slide}
      autoClose={1000}
      hideProgressBar={false}
      newestOnTop
      closeOnClick
      rtl={false}
      pauseOnFocusLoss
      draggable
      pauseOnHover
      theme={theme}
    />
  );
}

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      <LanguageProvider>
        <AuthProvider>
          {children}
          <ThemedToastContainer />
          <ConfirmHost />
        </AuthProvider>
      </LanguageProvider>
    </ThemeProvider>
  );
}
