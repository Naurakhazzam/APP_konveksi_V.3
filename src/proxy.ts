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
// Mapping route → role yang diizinkan (sesuai BR-10 §3.3)
// Kunci: prefix pathname (string matching dengan `startsWith`)
// ---------------------------------------------------------------------------
const ROLE_RESTRICTED_ROUTES: Record<string, UserRole[]> = {
  '/app/master-data':          ['owner'],
  '/app/keuangan/jurnal-umum': ['owner', 'admin_keuangan'],
  '/app/penggajian':           ['owner', 'supervisor'],
  '/app/settings':             ['owner'],
  '/app/audit-log':            ['owner'],
};

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

  // 3. Cek role restriction — hanya untuk protected route dengan user aktif
  if (isProtected && user) {
    // Cari route restriction yang cocok (urutan spesifik ke umum penting)
    const restrictedEntry = Object.entries(ROLE_RESTRICTED_ROUTES).find(
      ([routePrefix]) => pathname.startsWith(routePrefix),
    );

    if (restrictedEntry) {
      const [, allowedRoles] = restrictedEntry;

      // Query role dari user_profile
      const { data: profile } = await supabase
        .from('user_profile')
        .select('role')
        .eq('id', user.id)
        .single();

      const userRole = profile?.role as UserRole | undefined;

      // Jika tidak ada role atau role tidak diizinkan → redirect dashboard
      if (!userRole || !allowedRoles.includes(userRole)) {
        const dashboardUrl = new URL('/app/dashboard', request.url);
        return NextResponse.redirect(dashboardUrl);
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
