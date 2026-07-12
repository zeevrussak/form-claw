'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut, useSession } from 'next-auth/react';
import { useState } from 'react';
import {
  LayoutDashboard,
  Activity,
  BarChart3,
  AlertCircle,
  Server,
  Menu,
  X,
  LogOut,
  Shield,
  ChevronRight,
  Users,
  Brain,
  Settings,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import Image from 'next/image';

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
  { href: '/activity', label: 'Activity Log', icon: Activity },
  { href: '/statistics', label: 'Statistics', icon: BarChart3 },
  { href: '/errors', label: 'Error Log', icon: AlertCircle },
  { href: '/knowledge', label: 'Knowledge Base', icon: Brain },
  { href: '/team', label: 'Team', icon: Users },
  { href: '/settings', label: 'Settings', icon: Settings },
  { href: '/system', label: 'System', icon: Server },
];

export function Sidebar() {
  const pathname = usePathname();
  const { data: session } = useSession() || {};
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Mobile hamburger */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed top-4 left-4 z-50 md:hidden p-2 rounded-lg bg-slate-800/90 backdrop-blur border border-white/10 text-white"
        aria-label="Open menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed top-0 left-0 z-50 h-full w-64 bg-gradient-to-b from-slate-900 to-slate-950 border-r border-white/5 flex flex-col transition-transform duration-300',
          mobileOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'
        )}
      >
        {/* Header */}
        <div className="p-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
              <Shield className="h-5 w-5 text-blue-400" />
            </div>
            <div>
              <h2 className="font-display font-bold text-white text-lg tracking-tight">Form Claw</h2>
              <p className="text-[10px] text-blue-300/50 uppercase tracking-widest">Dashboard</p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen(false)}
            className="md:hidden text-white/50 hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 mt-2 space-y-1">
          {navItems?.map((item: any) => {
            const isActive = pathname === item?.href || pathname?.startsWith?.(item?.href + '/');
            const Icon = item?.icon;
            return (
              <Link
                key={item?.href}
                href={item?.href}
                onClick={() => setMobileOpen(false)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-200 group',
                  isActive
                    ? 'bg-blue-600/20 text-blue-300 border border-blue-500/20'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                )}
              >
                <Icon className={cn('h-4 w-4', isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300')} />
                <span>{item?.label}</span>
                {isActive && <ChevronRight className="h-3 w-3 ml-auto text-blue-400/50" />}
              </Link>
            );
          })}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-white/5">
          <div className="flex items-center gap-3 px-2 mb-3">
            {session?.user?.image ? (
              <div className="relative w-8 h-8 rounded-full overflow-hidden">
                <Image src={session.user.image} alt={session?.user?.name ?? 'User'} fill className="object-cover" />
              </div>
            ) : (
              <div className="w-8 h-8 rounded-full bg-blue-600/20 flex items-center justify-center text-blue-300 text-xs font-bold">
                {session?.user?.name?.[0] ?? session?.user?.email?.[0] ?? '?'}
              </div>
            )}
            <div className="min-w-0">
              <p className="text-sm text-white font-medium truncate">{session?.user?.name ?? 'User'}</p>
              <p className="text-[10px] text-slate-500 truncate">{session?.user?.email ?? ''}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full border-white/10 text-slate-400 hover:text-white hover:bg-white/5"
            onClick={() => signOut({ callbackUrl: '/login' })}
          >
            <LogOut className="h-3.5 w-3.5 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>
    </>
  );
}
