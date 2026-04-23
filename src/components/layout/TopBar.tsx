'use client';

import React from 'react';
import { usePathname } from 'next/navigation';
import { type UserProfile } from '@/lib/auth/permissions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { User, LogOut } from 'lucide-react';
import { signOutAction } from '@/lib/auth/actions';

interface TopBarProps {
  profile: UserProfile;
}

export function TopBar({ profile }: TopBarProps) {
  const pathname = usePathname();

  // Parse path for rough breadcrumb
  const segments = pathname.split('/').filter(Boolean);
  const breadcrumb = segments.length > 0 
    ? segments.map(s => s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ')).join(' / ')
    : 'Dashboard';

  return (
    <header className="flex h-14 items-center justify-between px-4 lg:px-6 border-b border-border bg-background sticky top-0 z-30">
      <div className="flex items-center gap-4">
        {/* Mobile menu space is mostly empty, sidebar trigger is floating */}
        <h1 className="text-sm font-semibold tracking-tight text-foreground/80 hidden sm:block">
          {breadcrumb}
        </h1>
        {/* On mobile show just the last segment if available */}
        <h1 className="text-sm font-semibold tracking-tight text-foreground sm:hidden">
          {segments.length > 0
            ? segments[segments.length - 1].charAt(0).toUpperCase() + segments[segments.length - 1].slice(1).replace(/-/g, ' ')
            : 'Dashboard'}
        </h1>
      </div>

      <div className="flex items-center gap-4">
        <DropdownMenu>
          <DropdownMenuTrigger className="focus:outline-none">
            <Avatar className="h-8 w-8 cursor-pointer ring-1 ring-border hover:ring-ring transition-all">
              <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">
                {profile.nama.substring(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel>
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{profile.nama}</p>
                <p className="text-xs leading-none text-muted-foreground capitalize">
                  {profile.role.replace('_', ' ')}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer">
              <User className="mr-2 h-4 w-4" />
              <span>Profil Saya</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <form action={signOutAction} className="w-full">
              <button type="submit" className="w-full text-left">
                <DropdownMenuItem className="cursor-pointer text-destructive focus:bg-destructive/10 focus:text-destructive">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Keluar</span>
                </DropdownMenuItem>
              </button>
            </form>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
