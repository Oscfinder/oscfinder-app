'use client';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Mail, Search, BarChart2, Receipt, Settings } from 'lucide-react';
import { AppNotification, NotificationType } from '@/types';
import { cn } from '@/lib/utils';

const TYPE_ICON: Record<NotificationType, React.ElementType> = {
  campaign: Mail,
  scrape:   Search,
  usage:    BarChart2,
  billing:  Receipt,
  sender:   Settings,
};

function relativeTime(iso: string): string {
  const date = new Date(iso);
  const now  = new Date();
  const diffMs  = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 1)  return 'Just now';
  if (diffMin < 60) return `${diffMin} min ago`;

  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `${diffHrs} hour${diffHrs !== 1 ? 's' : ''} ago`;

  // "Yesterday" — calendar-day comparison, not a strict 24-48h window
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000);

  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7)   return date.toLocaleDateString('en-GB', { weekday: 'long' });

  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

interface NotificationsResponse {
  notifications: AppNotification[];
  unread_count:  number;
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery<NotificationsResponse>({
    queryKey:        ['notifications'],
    queryFn:         () => fetch('/api/notifications').then(r => r.json()),
    refetchInterval: 60_000,
  });

  const notifications = (data?.notifications ?? []).slice(0, 20);
  const unreadCount    = data?.unread_count ?? 0;

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const markRead = async (id: string) => {
    const notif = notifications.find(n => n.id === id);
    if (!notif || notif.read) return;

    // Optimistic update — flips visual state immediately, before the request resolves.
    queryClient.setQueryData<NotificationsResponse>(['notifications'], prev => {
      if (!prev) return prev;
      return {
        notifications: prev.notifications.map(n => n.id === id ? { ...n, read: true } : n),
        unread_count:  Math.max(0, prev.unread_count - 1),
      };
    });

    try {
      const res = await fetch(`/api/notifications/${id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ read: true }),
      });
      if (!res.ok) throw new Error();
    } catch {
      // Roll back on failure rather than leaving the UI lying about server state.
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  };

  const markAllRead = async () => {
    if (unreadCount === 0) return;

    queryClient.setQueryData<NotificationsResponse>(['notifications'], prev => {
      if (!prev) return prev;
      return {
        notifications: prev.notifications.map(n => ({ ...n, read: true })),
        unread_count:  0,
      };
    });

    try {
      const res = await fetch('/api/notifications/mark-all-read', { method: 'POST' });
      if (!res.ok) throw new Error();
    } catch {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative w-9 h-9 rounded-lg border border-[#E5E7EB] bg-white flex items-center justify-center text-gray-500 hover:bg-gray-50 transition-colors"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-[#e74c3c] text-white text-[10px] font-bold flex items-center justify-center border-2 border-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-[calc(100%+8px)] w-[360px] max-w-[90vw] bg-white rounded-xl border border-[#E5E7EB] shadow-xl z-50 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E5E7EB]">
            <h3 className="text-[13px] font-bold text-[#0A1628]">Notifications</h3>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-[12px] font-medium text-[#0099CC] hover:text-[#006285] transition-colors"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[400px] overflow-y-auto">
            {notifications.length === 0 ? (
              <p className="text-center text-[13px] text-[#888888] py-10">No notifications yet</p>
            ) : (
              notifications.map(n => {
                const Icon = TYPE_ICON[n.type];
                return (
                  <button
                    key={n.id}
                    onClick={() => markRead(n.id)}
                    className={cn(
                      'w-full text-left px-4 py-3 border-b border-[#f3f4f6] last:border-0 flex gap-2.5 transition-colors',
                      n.read ? 'bg-white hover:bg-gray-50' : 'bg-[#f0f9ff] hover:bg-[#e0f2fe] border-l-[3px] border-l-[#0099CC]'
                    )}
                  >
                    <div className={cn(
                      'w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5',
                      n.read ? 'bg-gray-100 text-gray-400' : 'bg-[#dff2f9] text-[#006285]'
                    )}>
                      <Icon size={13} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={cn(
                        'text-[13px] leading-snug',
                        n.read ? 'text-gray-500 font-medium' : 'text-[#0A1628] font-bold'
                      )}>
                        {n.title}
                      </p>
                      <p className={cn('text-[12px] leading-snug mt-0.5', n.read ? 'text-gray-400' : 'text-[#1A3A5C]')}>
                        {n.message}
                      </p>
                      <p className="text-[11px] text-[#888888] mt-1">{relativeTime(n.created_at)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
