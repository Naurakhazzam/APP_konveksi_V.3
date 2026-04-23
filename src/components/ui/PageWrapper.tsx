import React from 'react';
import { Separator } from './separator';

export interface PageWrapperProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function PageWrapper({
  title,
  subtitle,
  actions,
  children,
}: PageWrapperProps) {
  return (
    <div className="flex flex-col space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1.5">
          <h2 className="text-2xl font-bold tracking-tight text-foreground">{title}</h2>
          {subtitle && (
            <p className="text-muted-foreground text-sm">
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div className="flex items-center space-x-3">
            {actions}
          </div>
        )}
      </div>
      
      <Separator className="bg-border/60" />
      
      <div className="flex-1">
        {children}
      </div>
    </div>
  );
}
