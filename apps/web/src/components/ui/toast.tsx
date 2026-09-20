'use client';

import { useEffect, useRef } from 'react';
import { toast as rtToast, type ToastOptions } from 'react-toastify';

export type ToastVariant = 'success' | 'danger' | 'info' | 'warning';

export interface ToastProps {
  variant?: ToastVariant;
  title?: string;
  message: string;
  onClose?: () => void;
  duration?: number;
  className?: string;
}

/**
 * Compatibility JSX Component:
 * Allows rendering `<Toast variant="danger" message={error} onClose={() => setError("")} />`
 * while internally dispatching to react-toastify configured with NavFarm's theme.
 */
export function Toast({
  variant = 'info',
  message,
  onClose,
  duration = 4500,
}: ToastProps) {
  const lastFiredRef = useRef<string | null>(null);

  useEffect(() => {
    if (!message) {
      lastFiredRef.current = null;
      return;
    }
    if (lastFiredRef.current === message) return;
    lastFiredRef.current = message;

    const fn =
      variant === 'danger'
        ? rtToast.error
        : variant === 'success'
        ? rtToast.success
        : variant === 'warning'
        ? rtToast.warn
        : rtToast.info;

    fn(message, {
      toastId: message,
      autoClose: duration,
      onClose: () => {
        lastFiredRef.current = null;
        onClose?.();
      },
    });
  }, [message, variant, duration, onClose]);

  return null;
}

/** Programmatic notification API powered by react-toastify with NavFarm theme */
export const showToast = {
  success: (message: string, options?: ToastOptions) =>
    rtToast.success(message, { toastId: options?.toastId || message, ...options }),
  error: (message: string, options?: ToastOptions) =>
    rtToast.error(message, { toastId: options?.toastId || message, ...options }),
  info: (message: string, options?: ToastOptions) =>
    rtToast.info(message, { toastId: options?.toastId || message, ...options }),
  warn: (message: string, options?: ToastOptions) =>
    rtToast.warn(message, { toastId: options?.toastId || message, ...options }),
};

export { rtToast as toast };
