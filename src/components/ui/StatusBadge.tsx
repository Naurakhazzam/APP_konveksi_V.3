import React from 'react';
import { Badge } from './badge';
import { cn } from '@/lib/utils';

export type StatusType =
  | 'belum'
  | 'parsial'
  | 'selesai'
  | 'pending'
  | 'approved'
  | 'cancelled'
  | 'direct_bahan'
  | 'direct_upah'
  | 'overhead'
  | 'masuk';

interface StatusBadgeProps extends React.ComponentProps<typeof Badge> {
  status: StatusType;
}

const statusConfig: Record<StatusType, { label: string; className: string }> = {
  belum: {
    label: 'Belum',
    className:
      'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200 dark:border-purple-500/30',
  },
  parsial: {
    label: 'Parsial',
    className:
      'bg-[color:var(--status-green)]/10 text-[color:var(--status-green)] border-[color:var(--status-green)]/30',
  },
  selesai: {
    label: 'Selesai',
    className:
      'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/30',
  },
  pending: {
    label: 'Pending',
    className:
      'bg-[color:var(--status-yellow)]/10 text-[color:var(--status-yellow)] border-[color:var(--status-yellow)]/30',
  },
  approved: {
    label: 'Approved',
    className:
      'bg-[color:var(--status-green)]/10 text-[color:var(--status-green)] border-[color:var(--status-green)]/30',
  },
  cancelled: {
    label: 'Cancelled',
    className:
      'bg-[color:var(--status-red)]/10 text-[color:var(--status-red)] border-[color:var(--status-red)]/30',
  },
  direct_bahan: {
    label: 'Bahan Baku',
    className: 'bg-purple-100 text-purple-700 dark:bg-purple-500/20 dark:text-purple-400 border-purple-200 dark:border-purple-500/30',
  },
  direct_upah: {
    label: 'Upah Langsung',
    className: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-500/20 dark:text-cyan-400 border-cyan-200 dark:border-cyan-500/30',
  },
  overhead: {
    label: 'Overhead',
    className: 'bg-[color:var(--status-yellow)]/10 text-[color:var(--status-yellow)] border-[color:var(--status-yellow)]/30',
  },
  masuk: {
    label: 'Pemasukan',
    className: 'bg-[color:var(--status-green)]/10 text-[color:var(--status-green)] border-[color:var(--status-green)]/30',
  },
};

export function StatusBadge({ status, className, ...props }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <Badge
      variant="outline"
      className={cn('font-medium', config.className, className)}
      {...props}
    >
      {config.label}
    </Badge>
  );
}
