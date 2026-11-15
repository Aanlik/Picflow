import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Archive, Edit, MoreVertical, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { Event as PicflowEvent } from '../../types';
import { PermissionGate } from './PermissionGate';

interface ProjectActionsMenuProps {
  event: PicflowEvent;
  onViewDetails: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

interface MenuPosition {
  top: number;
  left: number;
}

const VIEWPORT_GUTTER = 8;
const MENU_GAP = 4;

export const ProjectActionsMenu: React.FC<ProjectActionsMenuProps> = ({
  event,
  onViewDetails,
  onArchive,
  onDelete,
}) => {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    const trigger = triggerRef.current;
    const menu = menuRef.current;
    if (!trigger || !menu) return undefined;

    const anchor = trigger.getBoundingClientRect();
    const menuBounds = menu.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(VIEWPORT_GUTTER, viewportWidth - menuBounds.width - VIEWPORT_GUTTER);
    const left = Math.min(maxLeft, Math.max(VIEWPORT_GUTTER, anchor.right - menuBounds.width));
    const below = anchor.bottom + MENU_GAP + menuBounds.height <= viewportHeight - VIEWPORT_GUTTER;
    const above = anchor.top - MENU_GAP - menuBounds.height >= VIEWPORT_GUTTER;
    const top = below
      ? anchor.bottom + MENU_GAP
      : above
        ? anchor.top - menuBounds.height - MENU_GAP
        : Math.max(VIEWPORT_GUTTER, viewportHeight - menuBounds.height - VIEWPORT_GUTTER);

    setPosition({ top, left });

    const closeOnOutsidePointer = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const closeOnScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setIsOpen(false);
    };

    const closeOnResize = () => setIsOpen(false);
    document.addEventListener('mousedown', closeOnOutsidePointer);
    window.addEventListener('scroll', closeOnScroll, true);
    window.addEventListener('resize', closeOnResize);

    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePointer);
      window.removeEventListener('scroll', closeOnScroll, true);
      window.removeEventListener('resize', closeOnResize);
    };
  }, [isOpen]);

  useLayoutEffect(() => {
    if (!isOpen || !position) return;
    menuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [isOpen, position]);

  const handleMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
    if (!items.length) return;

    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex: number | null = null;
    if (event.key === 'ArrowDown') nextIndex = (currentIndex + 1 + items.length) % items.length;
    if (event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + items.length) % items.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = items.length - 1;

    if (nextIndex !== null) {
      event.preventDefault();
      items[nextIndex]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setIsOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'Tab') {
      event.preventDefault();
      const focusableSelector = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
      const focusable = Array.from(document.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !menuRef.current?.contains(element) && element.getClientRects().length > 0);
      const triggerIndex = focusable.indexOf(triggerRef.current as HTMLElement);
      const nextFocusable = focusable[triggerIndex + (event.shiftKey ? -1 : 1)];
      setIsOpen(false);
      (nextFocusable ?? triggerRef.current)?.focus();
    }
  };

  const closeAndRun = (action: () => void) => {
    setIsOpen(false);
    action();
  };

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-label={t('events.moreActions', '更多操作')}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => {
          setPosition(null);
          setIsOpen((current) => !current);
        }}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {isOpen && typeof document !== 'undefined' && createPortal(
        // A portal keeps fixed coordinates tied to the viewport, outside the hovered card's transform.
        <div
          ref={menuRef}
          role="menu"
          aria-label={t('events.moreActionsForProject', '项目 {{name}} 的更多操作', { name: event.event_name })}
          onKeyDown={handleMenuKeyDown}
          className="fixed z-[100] max-h-[calc(100vh-1rem)] w-56 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl bg-white py-1 shadow-xl ring-1 ring-black/10 dark:bg-neutral-800 dark:ring-white/10"
          style={{
            top: position?.top ?? 0,
            left: position?.left ?? 0,
            visibility: position ? 'visible' : 'hidden',
          }}
        >
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            onClick={() => closeAndRun(onViewDetails)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none dark:text-neutral-200 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700"
          >
            <Edit className="h-4 w-4" />{t('events.viewDetails')}
          </button>
          <PermissionGate permission="events.archive">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => closeAndRun(onArchive)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none dark:text-neutral-200 dark:hover:bg-neutral-700 dark:focus:bg-neutral-700"
            >
              <Archive className="h-4 w-4" />{t('events.archiveEventAction')}
            </button>
          </PermissionGate>
          <PermissionGate permission="events.delete">
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              onClick={() => closeAndRun(onDelete)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 focus:bg-red-50 focus:outline-none dark:text-red-400 dark:hover:bg-red-900/30 dark:focus:bg-red-900/30"
            >
              <Trash2 className="h-4 w-4" />{t('events.deleteEvent')}
            </button>
          </PermissionGate>
        </div>,
        document.body,
      )}
    </>
  );
};
