'use client';

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useHydrated } from '@/hooks/useMotion';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Accessible dialog: focus moves in, Tab stays inside, Escape closes when `dismissible`,
 * and focus returns to whatever opened it.
 */
export function Modal({
  open,
  onClose,
  dismissible = true,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  dismissible?: boolean;
  title: string;
  children: ReactNode;
}) {
  const hydrated = useHydrated();
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const dismissRef = useRef(dismissible);
  dismissRef.current = dismissible;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = box.current;
    const first = el?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? el)?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dismissRef.current) {
          e.stopPropagation();
          closeRef.current();
        }
        return;
      }
      if (e.key !== 'Tab' || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (items.length === 0) {
        e.preventDefault();
        el.focus();
        return;
      }
      const firstItem = items[0] as HTMLElement;
      const lastItem = items[items.length - 1] as HTMLElement;
      const active = document.activeElement;
      if (e.shiftKey && (active === firstItem || !el.contains(active))) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && (active === lastItem || !el.contains(active))) {
        e.preventDefault();
        firstItem.focus();
      }
    };
    document.addEventListener('keydown', onKey, true);
    const overflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.documentElement.style.overflow = overflow;
      previous?.focus();
    };
  }, [open]);

  if (!open || !hydrated) return null;
  return createPortal(
    <div
      className="va-modal"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && dismissible) onClose();
      }}
    >
      <div className="mbox" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={box} tabIndex={-1}>
        {dismissible ? (
          <button className="close" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        ) : null}
        <h3 id={titleId}>{title}</h3>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export interface ToastState {
  id: number;
  text: string;
  bad: boolean;
}

export function useToast() {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: string, bad = false) => {
    setToast({ id: Date.now(), text, bad });
    setVisible(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(false), bad ? 6500 : 4200);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  return { toast, visible, show };
}

export function Toast({ toast, visible }: { toast: ToastState | null; visible: boolean }) {
  const hydrated = useHydrated();
  if (!hydrated) return null;
  return createPortal(
    <div className={`va-toast${visible ? ' on' : ''}${toast?.bad ? ' bad' : ''}`} role="status" aria-live="polite">
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <circle cx="10" cy="10" r="8.5" />
        {toast?.bad ? <path d="M10 5.6v5.4M10 13.8v.4" /> : <path d="M6 10.2l2.6 2.6L14 7.5" />}
      </svg>
      <span>{toast?.text ?? ''}</span>
    </div>,
    document.body,
  );
}

export const StarIcon = () => (
  <svg viewBox="0 0 10 10" aria-hidden="true">
    <path d="M5 0l1.2 3.8H10L7 6.2 8.1 10 5 7.6 1.9 10 3 6.2 0 3.8h3.8z" fill="currentColor" />
  </svg>
);

export const OrbitIcon = () => (
  <svg viewBox="0 0 40 40" fill="none" stroke="currentColor" aria-hidden="true">
    <circle cx="20" cy="20" r="17" />
    <ellipse cx="20" cy="20" rx="17" ry="6.5" transform="rotate(-28 20 20)" />
    <circle cx="20" cy="20" r="3" />
  </svg>
);

/** "Unknown" is a visible state of its own: never rendered as 0 or as a dash that looks like one. */
export function Unknown({ label = 'Unknown' }: { label?: string }) {
  return <span className="unknown">{label}</span>;
}

/** Ticks once a second on the client; 0 during server rendering and the first paint. */
export function useNow(intervalMs = 15_000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
