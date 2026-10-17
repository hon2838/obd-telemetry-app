import React, { useEffect, useRef, useId } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidth?: string | number;
  triggerRef?: React.RefObject<HTMLElement | null>;
  className?: string;
  id?: string;
}

function getVisibleFocusableElements(container: HTMLElement): HTMLElement[] {
  const elements = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
  );

  return elements.filter(el => {
    if (el.tabIndex < 0) return false;
    if (el.getAttribute('aria-hidden') === 'true') return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    return !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  });
}

export default function Dialog({
  isOpen,
  onClose,
  title,
  description,
  children,
  maxWidth = '760px',
  triggerRef,
  className = '',
  id: customId
}: DialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const reactId = useId();
  const titleId = customId ? `${customId}-title` : `dialog-title-${reactId}`;
  const descId = customId ? `${customId}-desc` : `dialog-desc-${reactId}`;

  // Stable callback ref for onClose to isolate focus lifecycle from parent rerenders
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  const prevFocusedRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;

    // Capture triggering element before dialog receives focus
    prevFocusedRef.current = triggerRef?.current || (document.activeElement as HTMLElement) || null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the first visible focusable control or the dialog panel itself
    const timer = setTimeout(() => {
      if (dialogRef.current) {
        const focusables = getVisibleFocusableElements(dialogRef.current);
        if (focusables.length > 0) {
          focusables[0].focus();
        } else {
          dialogRef.current.focus();
        }
      }
    }, 20);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        e.preventDefault();
        onCloseRef.current();
        return;
      }

      if (e.key === 'Tab' && dialogRef.current) {
        const focusables = getVisibleFocusableElements(dialogRef.current);
        if (focusables.length === 0) {
          e.preventDefault();
          return;
        }

        const firstElement = focusables[0];
        const lastElement = focusables[focusables.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement || !dialogRef.current.contains(document.activeElement)) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener('keydown', handleKeyDown);

      const toFocus = prevFocusedRef.current;
      if (toFocus && typeof toFocus.focus === 'function' && toFocus.isConnected) {
        setTimeout(() => {
          if (toFocus.isConnected) {
            toFocus.focus();
          }
        }, 0);
      }
    };
  }, [isOpen, triggerRef]);

  if (!isOpen) return null;

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onCloseRef.current();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`glass-panel modal-content dialog-panel ${className}`}
        style={{ maxWidth, width: '100%', maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="dialog-header">
          <div>
            <h2 id={titleId} className="dialog-title">{title}</h2>
            {description && <p id={descId} className="dialog-description">{description}</p>}
          </div>
          <button
            type="button"
            className="dialog-close-btn"
            onClick={() => onCloseRef.current()}
            aria-label="Close dialog"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="dialog-body" style={{ overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
      </div>
    </div>
  );
}
