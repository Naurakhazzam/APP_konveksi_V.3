/**
 * Server Next.js (mis. Vercel) berjalan dalam UTC. Paksa proses Node
 * memakai WIB supaya `new Date().getMonth()/getDate()/getDay()` dan
 * `toLocaleDateString()` di server sama dengan jam Indonesia.
 */
export function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    process.env.TZ = 'Asia/Jakarta';
  }
}
