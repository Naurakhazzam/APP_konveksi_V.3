import React from 'react';
import { Card, CardContent } from './card';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface KpiCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'neutral';
  className?: string;
}

export function KpiCard({
  label,
  value,
  subValue,
  icon,
  trend,
  className,
}: KpiCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium text-muted-foreground">{label}</p>
          {icon && <div className="text-muted-foreground opacity-70">{icon}</div>}
        </div>
        <div className="flex flex-col gap-1">
          <div className="text-2xl font-bold tracking-tight text-foreground">
            {value}
          </div>
          {(subValue || trend) && (
            <div className="flex items-center gap-2 text-sm">
              {trend === 'up' && (
                <span className="flex items-center text-[color:var(--status-green)] font-medium">
                  <TrendingUp className="mr-1 h-3 w-3" />
                </span>
              )}
              {trend === 'down' && (
                <span className="flex items-center text-[color:var(--status-red)] font-medium">
                  <TrendingDown className="mr-1 h-3 w-3" />
                </span>
              )}
              {trend === 'neutral' && (
                <span className="flex items-center text-muted-foreground font-medium">
                  <Minus className="mr-1 h-3 w-3" />
                </span>
              )}
              {subValue && (
                <span className="text-muted-foreground">{subValue}</span>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
