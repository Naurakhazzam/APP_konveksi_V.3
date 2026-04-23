import React from 'react';
import { ArchiveX } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div 
      className={cn(
        "flex flex-col items-center justify-center p-8 text-center animate-in fade-in-50 duration-500", 
        className
      )}
    >
      <div className="flex h-20 w-20 items-center justify-center rounded-full bg-muted/50 mb-4 text-muted-foreground/50">
        {icon ? icon : <ArchiveX size={32} strokeWidth={1.5} />}
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-1">
        {title}
      </h3>
      <div className="text-sm text-muted-foreground max-w-sm mb-6">
        {description}
      </div>
      {action && (
        <div className="mt-2">
          {action}
        </div>
      )}
    </div>
  );
}
