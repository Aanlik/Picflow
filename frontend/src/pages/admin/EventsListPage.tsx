import React, { useState, useEffect } from 'react';
import { useExpiryRefresh } from '../../hooks/useExpiryRefresh';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Plus,
  Search,
  Archive,
  AlertTriangle,
  MoreVertical,
  ExternalLink,
  Edit,
  Trash2,
  Copy,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  CalendarDays,
  Image as ImageIcon,
  UserRound,
  ArrowDownWideNarrow,
  ArrowUpRight,
} from 'lucide-react';
import { parseISO } from 'date-fns';
import { toast } from 'react-toastify';
import { useModal, useMutationWithToast } from '../../hooks';
import { useLocalizedDate } from '../../hooks/useLocalizedDate';

import { Button, Input, Card, ErrorBoundary } from '../../components/common';
import { BulkArchiveModal } from '../../components/admin/BulkArchiveModal';
import { BulkDeleteModal } from '../../components/admin/BulkDeleteModal';
import { PermissionGate } from '../../components/admin/PermissionGate';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { eventsService, type EventStatusFilter } from '../../services/events.service';
import { api } from '../../config/api';
import { isGalleryPublic } from '../../utils/accessControl';
import { buildAdminPreviewUrl, buildShareLinkUrl } from '../../utils/url';
import type { Event } from '../../types';
import { useTranslation } from 'react-i18next';
import { STORAGE_INFO_QUERY_KEY } from '../../features/settings/hooks/useStorageInfo';

const PAGE_SIZE = 20;
const EVENT_SORTS = {
  recent: { sortBy: 'updated_at', sortOrder: 'desc' as const },
  created: { sortBy: 'created_at', sortOrder: 'desc' as const },
  name: { sortBy: 'event_name', sortOrder: 'asc' as const },
};
type EventSort = keyof typeof EVENT_SORTS;

export const EventsListPage: React.FC = () => {
  const { t } = useTranslation();
  const { format } = useLocalizedDate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const sortParam = searchParams.get('sort') as EventSort | null;
  const sortKey: EventSort = sortParam && Object.prototype.hasOwnProperty.call(EVENT_SORTS, sortParam) ? sortParam : 'recent';
  const sort = EVENT_SORTS[sortKey];
  const updateFilter = (filter?: string) => {
    const next = new URLSearchParams(searchParams);
    if (filter) next.set('filter', filter);
    else next.delete('filter');
    setSearchParams(next);
  };
  const updateSort = (value: EventSort) => {
    const next = new URLSearchParams(searchParams);
    next.set('sort', value);
    setSearchParams(next);
  };

  const [searchTerm, setSearchTerm] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<number[]>([]);
  const [cloudArchivePromptIds, setCloudArchivePromptIds] = useState<number[]>([]);
  const [pendingDeleteEvent, setPendingDeleteEvent] = useState<Event | null>(null);
  const [deleteCloudCopies, setDeleteCloudCopies] = useState(false);
  // const [showFilters, setShowFilters] = useState(false);
  const [activeDropdown, setActiveDropdown] = useState<number | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{ top: number; left: number } | null>(null);
  const bulkArchiveModal = useModal();
  const bulkDeleteModal = useModal();
  const [copiedEventId, setCopiedEventId] = useState<number | null>(null);

  const copyShareLink = async (event: Event) => {
    if (event.is_draft) {
      toast.info(t('events.draftNotShareable', '草稿尚未发布，不能分享给客户。'));
      return;
    }
    const url = buildShareLinkUrl(event.share_link);
    if (!url || url === '#') {
      toast.error(t('errors.noShareLink', 'No share link available'));
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        document.body.appendChild(textArea);
        textArea.select();
        const ok = document.execCommand('copy');
        document.body.removeChild(textArea);
        if (!ok) throw new Error('Copy failed');
      }
      setCopiedEventId(event.id);
      toast.success(t('events.linkCopied', 'Gallery link copied'));
      setTimeout(() => setCopiedEventId((current) => (current === event.id ? null : current)), 2000);
    } catch {
      toast.error(t('errors.copyFailed', 'Failed to copy link'));
    }
  };

  // Get filter from URL — backend supports all of these as `status` values
  const filterParam = searchParams.get('filter');
  const statusFilter: EventStatusFilter | undefined =
    filterParam === 'active' ||
    filterParam === 'draft' || filterParam === 'expiring' ||
    filterParam === 'inactive'
      ? filterParam
      : undefined;
  const isExpiringFilter = filterParam === 'expiring';
  const isDraftFilter = filterParam === 'draft';

  // Server-side pagination + debounced search
  const [page, setPage] = useState(1);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearchTerm(searchTerm.trim()), 300);
    return () => clearTimeout(t);
  }, [searchTerm]);

  // Reset to page 1 whenever the filter or search changes so users don't
  // get stuck on a page index that no longer exists in the new result set.
  useEffect(() => {
    setPage(1);
  }, [statusFilter, debouncedSearchTerm, sortKey]);

  // Bulk actions name and confirm only the visible result set. Clear prior
  // selections when its page or query changes so no off-screen project can be
  // archived or deleted without appearing in the confirmation dialog.
  useEffect(() => {
    setSelectedEvents([]);
  }, [statusFilter, debouncedSearchTerm, sortKey, page]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.closest('.dropdown-container')) {
        setActiveDropdown(null);
        setDropdownPosition(null);
      }
    };

    if (activeDropdown !== null) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [activeDropdown]);

  // Update dropdown position on scroll/resize
  useEffect(() => {
    const handleScrollOrResize = () => {
      if (activeDropdown !== null) {
        setActiveDropdown(null);
        setDropdownPosition(null);
      }
    };

    window.addEventListener('scroll', handleScrollOrResize, true);
    window.addEventListener('resize', handleScrollOrResize);

    return () => {
      window.removeEventListener('scroll', handleScrollOrResize, true);
      window.removeEventListener('resize', handleScrollOrResize);
    };
  }, [activeDropdown]);

  // Fetch events — fully server-side: pagination, status filter, and search
  // (#346 — counters and search were previously bounded to the first 100 rows).
  const { data, isLoading, isPlaceholderData, error, refetch } = useQuery({
    queryKey: ['admin-events', statusFilter ?? 'all', debouncedSearchTerm, sortKey, page],
    queryFn: () => eventsService.getEvents(page, PAGE_SIZE, statusFilter, debouncedSearchTerm || undefined, sort.sortBy, sort.sortOrder),
    placeholderData: (prev) => prev,
  });

  // Clamp the active page when the result count shrinks (#442 — bulk
  // delete of an entire page would leave the user on a now-empty
  // page=N where N > totalPages, with no auto-correction). Triggers
  // after each successful refetch when totalPages drops below the
  // current page (bulk delete, individual delete, archive, anything).
  // Must live AFTER the useQuery above so `data` is in scope — the
  // original placement at the top of the component caused a TDZ
  // ReferenceError on /admin/events that crashed the page (#454).
  useEffect(() => {
    if (data?.pagination && page > data.pagination.totalPages) {
      setPage(Math.max(1, data.pagination.totalPages));
    }
  }, [data?.pagination, page]);

  // Archive mutation
  const archiveMutation = useMutationWithToast({
    mutationFn: eventsService.archiveEvent,
    invalidateKeys: [['admin-events'], STORAGE_INFO_QUERY_KEY],
    successMessage: t('toast.eventArchived'),
    onSuccess: (result, eventId) => {
      if (result?.cloudCopiesAvailable) setCloudArchivePromptIds([eventId]);
    },
  });

  // Delete mutation
  const deleteMutation = useMutationWithToast({
    mutationFn: ({ id, deleteCloudCopies: deleteRemote }: { id: number; deleteCloudCopies: boolean }) =>
      eventsService.deleteEvent(id, { deleteCloudCopies: deleteRemote }),
    invalidateKeys: [['admin-events'], ['storage-info']],
    successMessage: t('toast.deleteSuccess'),
    errorMessage: (error: unknown) =>
      (error as { response?: { data?: { error?: string } } })?.response?.data?.error || t('toast.deleteError'),
    onSuccess: () => {
      setPendingDeleteEvent(null);
      setDeleteCloudCopies(false);
    },
  });

  // Bulk archive mutation
  const bulkArchiveMutation = useMutation({
    mutationFn: eventsService.bulkArchiveEvents,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      queryClient.invalidateQueries({ queryKey: STORAGE_INFO_QUERY_KEY });
      setSelectedEvents([]);
      bulkArchiveModal.close();

      const cloudIds = data.results.successful.filter((item) => item.cloudCopiesAvailable).map((item) => item.id);
      if (cloudIds.length) setCloudArchivePromptIds(cloudIds);

      if (data.results.failed.length === 0) {
        toast.success(t('events.bulkArchiveSuccess', { count: data.results.successful.length }));
      } else {
        toast.warning(t('events.bulkArchivePartial', { success: data.results.successful.length, failed: data.results.failed.length }));
      }
    },
    onError: () => {
      toast.error(t('toast.saveError'));
    },
  });

  const deleteBulkCloudCopiesMutation = useMutation({
    mutationFn: async (eventIds: number[]) => Promise.allSettled(eventIds.map((eventId) => api.delete(`/admin/events/${eventId}/object-delivery/cloud-copies`))),
    onSuccess: (results) => {
      const failed = results.filter((result) => result.status === 'rejected').length;
      setCloudArchivePromptIds([]);
      if (failed) {
        const firstFailure = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
        const reason = firstFailure?.reason as { response?: { data?: { error?: unknown } } } | undefined;
        const detail = reason?.response?.data?.error;
        const summary = t('objectDelivery.archiveDeleteSummary', '云端副本删除：{{success}} 个项目成功，{{failed}} 个项目失败。', {
          success: results.length - failed, failed,
        });
        const retry = t('objectDelivery.archiveRetryInList', '可在归档列表中重试。');
        toast.warning(typeof detail === 'string' && detail ? `${summary} ${detail} ${retry}` : `${summary} ${retry}`);
      } else toast.success(t('objectDelivery.archiveDeleted', '已删除项目的云端照片副本'));
    },
    onError: () => toast.error(t('objectDelivery.archiveDeleteFailed', '删除云端照片失败；云端副本仍保留，可稍后重试。')),
  });

  // Bulk delete mutation. Confirmation is handled client-side by the modal's
  // typed-DELETE gate (#417); server still enforces auth + permission.
  const bulkDeleteMutation = useMutation({
    mutationFn: ({ eventIds, deleteCloudCopies: deleteRemote }: { eventIds: number[]; deleteCloudCopies: boolean }) =>
      eventsService.bulkDeleteEvents(eventIds, { deleteCloudCopies: deleteRemote }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['admin-events'] });
      queryClient.invalidateQueries({ queryKey: STORAGE_INFO_QUERY_KEY });
      setSelectedEvents([]);
      bulkDeleteModal.close();

      if (data.results.failed.length === 0) {
        toast.success(t('events.bulkDelete.successAll', { count: data.results.successful.length }));
      } else {
        const summary = t('events.bulkDelete.successPartial', { success: data.results.successful.length, failed: data.results.failed.length });
        toast.warning(`${summary} ${data.results.failed[0]?.error || ''}`.trim());
      }
    },
    onError: () => {
      toast.error(t('events.bulkDelete.errorGeneric'));
      bulkDeleteModal.close();
    },
  });

  // Filtering and searching now happen server-side. Use the response directly,
  // ordered as the backend returned them (created_at desc by default).
  const events: Event[] = data?.events ?? [];

  // Refetch when the soonest event expiry passes (#909 review): the status
  // badge is computed inline from Date.now(), and under the "expiring" filter
  // the backend drops the row once expires_at <= now — so a plain re-render
  // would leave a stale "Expired" row (and total) in that filtered view.
  // refetch() re-runs with the current page/filter/search: rows and totals
  // both correct under every filter.
  useExpiryRefresh(events.map((e) => e.expires_at), refetch);
  const pagination = data?.pagination;
  const totalPages = pagination?.totalPages ?? 1;
  const filteredCount = pagination?.total ?? 0;
  const isFilteringOrSearching = !!statusFilter || !!debouncedSearchTerm;

  const handleSelectAll = () => {
    const visibleIds = events.map((event) => event.id);
    const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedEvents.includes(id));
    if (allVisibleSelected) {
      setSelectedEvents([]);
    } else {
      setSelectedEvents(visibleIds);
    }
  };

  const handleSelectEvent = (id: number) => {
    setSelectedEvents(prev =>
      prev.includes(id)
        ? prev.filter(i => i !== id)
        : [...prev, id]
    );
  };

  const getEventStatus = (event: Event) => {
    if (event.is_draft) return { label: t('events.draft'), color: 'text-yellow-600 dark:text-yellow-400 bg-yellow-100 dark:bg-yellow-900/40' };
    if (!event.is_active) return { label: t('events.inactive'), color: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40' };

    if (!event.expires_at) return { label: t('events.active'), color: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40' };

    // Expired means the timestamp has actually passed (#909):
    // differenceInDays truncates to whole days, so an event expiring in a
    // few hours returned 0 and showed "Expired" while the public gallery
    // (which compares real timestamps) correctly showed it active.
    const expiresAt = parseISO(event.expires_at);
    if (expiresAt.getTime() <= Date.now()) return { label: t('events.expired'), color: 'text-red-600 dark:text-red-400 bg-red-100 dark:bg-red-900/40' };
    // Ceiling so the last day reads "1 day left", never "0 days".
    const days = Math.ceil((expiresAt.getTime() - Date.now()) / 86400000);
    if (days <= 7) return { label: t('events.daysLeft', { count: days }), color: 'text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900/40' };

    return { label: t('events.active'), color: 'text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900/40' };
  };

  if (isLoading || (isPlaceholderData && !error)) {
    return (
      <div>
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('events.title')}</h1>
            <p className="text-neutral-600 dark:text-neutral-400 mt-1">{t('events.subtitle')}</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, index) => (
            <div key={index} className="h-56 animate-pulse rounded-2xl border border-neutral-200 bg-white p-5 dark:border-neutral-800 dark:bg-neutral-900">
              <div className="h-5 w-24 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="mt-6 h-6 w-3/4 rounded bg-neutral-200 dark:bg-neutral-700" />
              <div className="mt-3 h-4 w-1/2 rounded bg-neutral-100 dark:bg-neutral-800" />
              <div className="mt-7 grid grid-cols-2 gap-3">
                <div className="h-16 rounded-xl bg-neutral-100 dark:bg-neutral-800" />
                <div className="h-16 rounded-xl bg-neutral-100 dark:bg-neutral-800" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12">
        <p className="text-red-600">{t('events.failedToLoadEvents')}</p>
        <Button onClick={() => window.location.reload()} className="mt-4">
          {t('events.tryAgain')}
        </Button>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <div>
        {/* Page Header */}
        <div className="flex justify-between items-center mb-6">
          <div>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">{t('events.title')}</h1>
            <p className="text-neutral-600 dark:text-neutral-400 mt-1">{t('events.subtitle')}</p>
          </div>
          <PermissionGate permission="events.create">
            <Button
              variant="primary"
              leftIcon={<Plus className="w-5 h-5" />}
              onClick={() => navigate('/admin/events/new')}
            >
              {t('events.createEvent')}
            </Button>
          </PermissionGate>
        </div>

      {/* Filters and Search */}
      <Card padding="sm" className="mb-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <Input
              type="text"
              placeholder={t('events.searchEventsPlaceholder')}
              leftIcon={<Search className="w-5 h-5 text-neutral-400" />}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          {/* Filter Buttons */}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={!statusFilter ? 'primary' : 'outline'}
              size="md"
              onClick={() => updateFilter()}
            >
              {t('events.all')} ({pagination?.total ?? 0})
            </Button>
            <Button
              variant={statusFilter === 'active' ? 'primary' : 'outline'}
              size="md"
              onClick={() => updateFilter('active')}
            >
              {t('events.active')}
            </Button>
            <Button
              variant={isExpiringFilter ? 'primary' : 'outline'}
              size="md"
              onClick={() => updateFilter('expiring')}
              leftIcon={<AlertTriangle className="w-4 h-4" />}
            >
              {t('events.expiring')}
            </Button>
            <Button
              variant={isDraftFilter ? 'primary' : 'outline'}
              size="md"
              onClick={() => updateFilter('draft')}
            >
              {t('events.draft')}
            </Button>
            <label className="ml-1 flex h-10 items-center gap-2 rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-600 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-300">
              <ArrowDownWideNarrow className="h-4 w-4 shrink-0" />
              <span className="sr-only">{t('events.sortBy', '排序')}</span>
              <select
                value={sortKey}
                onChange={(event) => updateSort(event.target.value as EventSort)}
                aria-label={t('events.sortBy', '排序')}
                className="max-w-[9rem] border-0 bg-transparent p-0 text-sm focus:ring-0 dark:bg-neutral-900"
              >
                <option value="recent">{t('events.sortRecent', '最近更新')}</option>
                <option value="created">{t('events.sortCreated', '创建时间')}</option>
                <option value="name">{t('events.sortName', '项目名称')}</option>
              </select>
            </label>
          </div>
        </div>

        {/* Bulk Actions */}
        {selectedEvents.length > 0 && (
          <div className="mt-4 p-3 bg-accent-dark/15 rounded-lg flex items-center justify-between">
            <span className="text-sm text-accent-dark">
              {t('events.eventsSelected', { count: selectedEvents.length })}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedEvents([])}>
                {t('events.clear')}
              </Button>
              <PermissionGate permission="events.archive">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkArchiveModal.open()}
                >
                  {t('events.archiveSelected')}
                </Button>
              </PermissionGate>
              <PermissionGate permission="events.delete">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => bulkDeleteModal.open()}
                  className="border-red-300 text-red-700 hover:bg-red-50 dark:border-red-700 dark:text-red-400 dark:hover:bg-red-900/30"
                >
                  {t('events.deleteSelected', 'Delete Selected')}
                </Button>
              </PermissionGate>
            </div>
          </div>
        )}
      </Card>

      {/* Project cards: scanning the work state takes priority over dense rows. */}
      {events.length === 0 ? (
        <Card className="py-16 text-center text-sm text-neutral-500 dark:text-neutral-400">
          {t('events.noEventsFound')}
        </Card>
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between px-1 text-sm text-neutral-500 dark:text-neutral-400">
            <span>{t('events.projectsOnPage', '本页项目 {{count}} 个', { count: events.length })}</span>
            <label className="inline-flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={events.length > 0 && events.every((event) => selectedEvents.includes(event.id))}
                onChange={handleSelectAll}
                aria-label={t('events.selectAllOnPage', '选择本页全部项目')}
                className="h-4 w-4 rounded border-neutral-300 text-accent focus:ring-primary-500 dark:border-neutral-600 dark:bg-neutral-700"
              />
              {t('events.selectAllOnPage', '选择本页')}
            </label>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {events.map((event) => {
              const status = getEventStatus(event);
              const accent = event.is_draft
                ? 'bg-amber-400'
                : event.is_active
                  ? 'bg-emerald-500'
                  : 'bg-neutral-400';

              return (
                <Card key={event.id} padding="none" variant="hover" className="group relative flex h-full flex-col overflow-visible rounded-2xl">
                  <div className={`h-1.5 rounded-t-2xl ${accent}`} />
                  <div className="flex flex-1 flex-col p-5">
                    <div className="flex items-center justify-between gap-3">
                      <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${status.color}`}>
                        {status.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800">
                          <input
                            type="checkbox"
                            checked={selectedEvents.includes(event.id)}
                            onChange={() => handleSelectEvent(event.id)}
                            aria-label={t('events.selectProject', '选择项目 {{name}}', { name: event.event_name })}
                            className="h-4 w-4 rounded border-neutral-300 text-accent focus:ring-primary-500 dark:border-neutral-600 dark:bg-neutral-700"
                          />
                        </label>
                        <div className="relative inline-block text-left dropdown-container">
                          <button
                            type="button"
                            aria-label={t('events.moreActions', '更多操作')}
                            onClick={(clickEvent) => {
                              if (activeDropdown === event.id) {
                                setActiveDropdown(null);
                                setDropdownPosition(null);
                                return;
                              }
                              const rect = clickEvent.currentTarget.getBoundingClientRect();
                              setActiveDropdown(event.id);
                              setDropdownPosition({
                                top: rect.bottom + 4,
                                left: Math.max(8, Math.min(rect.right - 224, window.innerWidth - 232)),
                              });
                            }}
                            className="flex h-8 w-8 items-center justify-center rounded-lg text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                          >
                            <MoreVertical className="h-4 w-4" />
                          </button>
                          {activeDropdown === event.id && dropdownPosition && (
                            <div className="fixed z-50 w-56 rounded-xl bg-white py-1 shadow-xl ring-1 ring-black/10 dark:bg-neutral-800 dark:ring-white/10" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                              <button type="button" onClick={() => { navigate(`/admin/events/${event.id}`); setActiveDropdown(null); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700">
                                <Edit className="h-4 w-4" />{t('events.viewDetails')}
                              </button>
                              <PermissionGate permission="events.archive">
                                <button type="button" onClick={() => { if (window.confirm(t('events.archiveConfirm'))) archiveMutation.mutate(event.id); setActiveDropdown(null); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 dark:text-neutral-200 dark:hover:bg-neutral-700">
                                  <Archive className="h-4 w-4" />{t('events.archiveEventAction')}
                                </button>
                              </PermissionGate>
                              <PermissionGate permission="events.delete">
                                <button type="button" onClick={() => { setPendingDeleteEvent(event); setDeleteCloudCopies(false); setActiveDropdown(null); }} className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30">
                                  <Trash2 className="h-4 w-4" />{t('events.deleteEvent')}
                                </button>
                              </PermissionGate>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 min-w-0">
                      <button type="button" onClick={() => navigate(`/admin/events/${event.id}`)} className="block max-w-full text-left">
                        <h2 className="line-clamp-2 text-lg font-semibold leading-6 text-neutral-950 transition group-hover:text-emerald-800 dark:text-neutral-100 dark:group-hover:text-emerald-300" title={event.event_name}>{event.event_name}</h2>
                      </button>
                      <div className="mt-1.5 flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
                        <UserRound className="h-3.5 w-3.5 shrink-0" />
                        <span className="truncate">{event.customer_name || t('events.customerNotSet', '未填写客户名称')}</span>
                      </div>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div className="rounded-xl bg-neutral-50 p-3.5 dark:bg-neutral-800/80">
                        <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                          <ImageIcon className="h-3.5 w-3.5" />{t('events.photos', '照片')}
                        </div>
                        <div className="mt-1 text-xl font-semibold tabular-nums text-neutral-900 dark:text-neutral-100">{event.photo_count ?? 0}</div>
                      </div>
                      <div className="rounded-xl bg-neutral-50 p-3.5 dark:bg-neutral-800/80">
                        <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                          <CalendarDays className="h-3.5 w-3.5" />{t('events.date')}
                        </div>
                        <div className="mt-1 truncate text-sm font-medium text-neutral-900 dark:text-neutral-100" title={event.event_date ? format(parseISO(event.event_date)) : undefined}>
                          {event.event_date ? format(parseISO(event.event_date)) : t('events.dateNotSet', '未设置')}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-neutral-100 pt-3 text-xs dark:border-neutral-800">
                      <span className={`inline-flex items-center rounded-full px-2 py-1 ${isGalleryPublic(event.require_password) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'}`}>
                        {isGalleryPublic(event.require_password) ? t('events.publicAccess', '公开访问') : t('events.passwordProtected', '密码保护')}
                      </span>
                      <span className="text-neutral-500 dark:text-neutral-400">
                        {event.expires_at ? t('events.expiresAtShort', '到期 {{date}}', { date: format(parseISO(event.expires_at)) }) : t('events.noExpiry', '不设到期')}
                      </span>
                    </div>

                    <div className="mt-auto flex items-center gap-2 pt-5">
                      <Button className="min-w-0 flex-1" size="sm" onClick={() => navigate(`/admin/events/${event.id}`)} rightIcon={<ArrowUpRight className="h-4 w-4" />}>
                        {t('events.openProject', '打开项目')}
                      </Button>
                      {event.share_link && (
                        <Button variant="outline" size="sm" aria-label={t('events.viewGallery')} title={t('events.viewGallery')} onClick={() => {
                          const url = event.is_draft ? buildAdminPreviewUrl(event.share_link) : buildShareLinkUrl(event.share_link);
                          window.open(url, '_blank', 'noopener,noreferrer');
                        }}>
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      )}
                      {event.share_link && !event.is_draft && (
                        <Button variant="outline" size="sm" aria-label={t('events.copyLink', '复制链接')} title={t('events.copyLink', '复制链接')} onClick={() => void copyShareLink(event)}>
                          {copiedEventId === event.id ? <CheckCircle className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </>
      )}

      {/* Pagination — only when the current filter has more than one page */}
      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-neutral-600 dark:text-neutral-400">
          <div>
            {t('events.paginationLabel', {
              from: events.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1,
              to: (page - 1) * PAGE_SIZE + events.length,
              total: filteredCount,
              defaultValue: '{{from}}–{{to}} of {{total}}',
            })}
            {isFilteringOrSearching && (
              <span className="ml-2 text-neutral-400">({t('events.filtered', 'filtered')})</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              leftIcon={<ChevronLeft className="w-4 h-4" />}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              {t('common.previous', 'Previous')}
            </Button>
            <span>
              {t('events.pageOf', {
                page,
                totalPages,
                defaultValue: 'Page {{page}} of {{totalPages}}',
              })}
            </span>
            <Button
              variant="outline"
              size="sm"
              rightIcon={<ChevronRight className="w-4 h-4" />}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              {t('common.next', 'Next')}
            </Button>
          </div>
        </div>
      )}

      {/* Bulk Archive Modal */}
      <BulkArchiveModal
        isOpen={bulkArchiveModal.isOpen}
        onClose={bulkArchiveModal.close}
        onConfirm={() => bulkArchiveMutation.mutate(selectedEvents)}
        selectedEvents={events.filter(e => selectedEvents.includes(e.id))}
        isLoading={bulkArchiveMutation.isPending}
      />

      {/* Bulk Delete Modal */}
      <BulkDeleteModal
        isOpen={bulkDeleteModal.isOpen}
        onClose={bulkDeleteModal.close}
        onConfirm={async ({ deleteCloudCopies: deleteRemote }) => {
          await bulkDeleteMutation.mutateAsync({ eventIds: selectedEvents, deleteCloudCopies: deleteRemote });
        }}
        selectedEvents={events.filter(e => selectedEvents.includes(e.id))}
        isLoading={bulkDeleteMutation.isPending}
      />

      {pendingDeleteEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
          <Card className="w-full max-w-lg p-6" role="dialog" aria-modal="true" aria-labelledby="delete-project-title">
            <h2 id="delete-project-title" className="text-lg font-semibold text-red-700 dark:text-red-400">
              {t('events.deleteProjectTitle', { name: pendingDeleteEvent.event_name, defaultValue: '删除项目“{{name}}”？' })}
            </h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">
              {t('events.deleteProjectHelp', '项目记录和本地图库索引会被永久删除。云端选项影响对象存储中的精修成片、缩略图、预览图和临时下载副本；NAS 外部素材与 Bridge 精修交付工作区不受影响。')}
            </p>
            <fieldset className="mt-5 space-y-3">
              <legend className="mb-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">
                {t('events.deleteCloudChoiceTitle', '项目删除后的云端数据处理')}
              </legend>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-neutral-200 p-3 dark:border-neutral-700">
                <input
                  type="radio"
                  name="delete-project-cloud-copies"
                  checked={!deleteCloudCopies}
                  onChange={() => setDeleteCloudCopies(false)}
                  disabled={deleteMutation.isPending}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium text-neutral-900 dark:text-neutral-100">
                    {t('events.keepCloudAfterDelete', '保留云端副本（推荐）')}
                  </span>
                  <span className="mt-1 block text-sm text-neutral-600 dark:text-neutral-300">
                    {t('events.keepCloudAfterDeleteHelp', '云端文件会继续占用存储，但项目删除后无法再从本界面管理。')}
                  </span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-red-200 p-3 dark:border-red-900">
                <input
                  type="radio"
                  name="delete-project-cloud-copies"
                  checked={deleteCloudCopies}
                  onChange={() => setDeleteCloudCopies(true)}
                  disabled={deleteMutation.isPending}
                  className="mt-1"
                />
                <span>
                  <span className="block text-sm font-medium text-red-700 dark:text-red-400">
                    {t('events.deleteCloudAfterDelete', '同时删除云端副本')}
                  </span>
                  <span className="mt-1 block text-sm text-neutral-600 dark:text-neutral-300">
                    {t('events.deleteCloudAfterDeleteHelp', '先停止云端上传，再删除精修成片、缩略图、预览图和临时下载副本。若云端删除失败，项目会保留，供你重试。')}
                  </span>
                </span>
              </label>
            </fieldset>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" disabled={deleteMutation.isPending} onClick={() => setPendingDeleteEvent(null)}>
                {t('common.cancel', '取消')}
              </Button>
              <Button
                variant="primary"
                isLoading={deleteMutation.isPending}
                className="bg-red-600 text-white hover:bg-red-700 focus:ring-red-500"
                onClick={() => deleteMutation.mutate({ id: pendingDeleteEvent.id, deleteCloudCopies })}
              >
                {t('events.deleteEvent', '删除项目')}
              </Button>
            </div>
          </Card>
        </div>
      )}

      {cloudArchivePromptIds.length > 0 && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="presentation">
          <Card className="w-full max-w-lg p-6" role="dialog" aria-modal="true" aria-labelledby="bulk-cloud-archive-title">
            <h2 id="bulk-cloud-archive-title" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{cloudArchivePromptIds.length === 1 ? t('objectDelivery.archivePromptTitle', '项目已归档') : t('objectDelivery.bulkArchivePromptTitle', '项目已归档')}</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600 dark:text-neutral-300">{cloudArchivePromptIds.length === 1
              ? t('objectDelivery.archivePromptHelp', '此项目有已同步照片或待处理的云端同步任务。默认保留云端副本；如需释放空间，可以删除云端副本和待处理任务。NAS/归档包不受影响。')
              : t('objectDelivery.bulkArchivePromptHelp', '有 {{count}} 个归档项目仍保留云端照片。默认保留云端副本；如需释放空间，可一次删除这些项目的云端照片。NAS/归档包不受影响。', { count: cloudArchivePromptIds.length })}</p>
            <div className="mt-6 flex flex-wrap justify-end gap-3">
              <Button variant="outline" disabled={deleteBulkCloudCopiesMutation.isPending} onClick={() => setCloudArchivePromptIds([])}>{t('objectDelivery.keepCloudCopies', '保留云端照片')}</Button>
              <Button isLoading={deleteBulkCloudCopiesMutation.isPending} onClick={() => deleteBulkCloudCopiesMutation.mutate(cloudArchivePromptIds)}>{t('objectDelivery.deleteCloudCopies', '删除云端照片')}</Button>
            </div>
          </Card>
        </div>
      )}
      </div>
    </ErrorBoundary>
  );
};

EventsListPage.displayName = 'EventsListPage';
