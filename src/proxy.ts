import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

// ---------------------------------------------------------------------------
// Tipe Role (sesuai BR-10)
// ---------------------------------------------------------------------------
type UserRole =
  | 'owner'
  | 'admin_produksi'
  | 'admin_keuangan'
  | 'supervisor'
  | 'mandor';

// ---------------------------------------------------------------------------
// Middleware utama
// ---------------------------------------------------------------------------
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Refresh session & dapatkan user
  const { supabase, supabaseResponse, user } = await updateSession(request);

  // 2. Route proteksi: semua yang diawali /app wajib punya session
  const isProtected = pathname.startsWith('/app');

  if (isProtected && !user) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('next', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 3. Cek role restriction — DB-based check
  if (isProtected && user) {
    const { data: profile } = await supabase
      .from('user_profile')
      .select('role')
      .eq('id', user.id)
      .single();

    const userRole = profile?.role as string | undefined;

    if (userRole && userRole !== 'owner') {
      // Fetch semua allowed paths untuk role ini
      const { data: allowedData } = await supabase
        .from('role_permissions')
        .select('path')
        .eq('role', userRole)
        .eq('can_view', true)
        .eq('tenant_id', 'STX-001');

      const allowedPaths = (allowedData ?? []).map((r: any) => r.path as string);

      // Cek apakah pathname cocok dengan salah satu allowed path (atau sub-path)
      const hasAccess = allowedPaths.some(p =>
        pathname === p || pathname.startsWith(p + '/')
      );

      if (!hasAccess) {
        const fallback = allowedPaths[0] || '/app/dashboard';
        return NextResponse.redirect(new URL(fallback, request.url));
      }
    }
  }

  // 4. Redirect user yang sudah login dari /login ke /app/dashboard
  if (pathname === '/login' && user) {
    return NextResponse.redirect(new URL('/app/dashboard', request.url));
  }

  return supabaseResponse;
}

// ---------------------------------------------------------------------------
// Konfigurasi matcher — jalankan middleware di semua route kecuali
// static assets dan internal Next.js routes
// ---------------------------------------------------------------------------
export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
