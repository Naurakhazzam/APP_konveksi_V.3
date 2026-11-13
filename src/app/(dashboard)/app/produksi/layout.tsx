import { Eye } from 'lucide-react';
import { getCurrentUserProfile, isProduksiReadOnly } from '@/lib/auth/permissions';

/**
 * Layout module Produksi.
 * Role read-only (admin_keuangan) tetap boleh membuka halaman produksi yang
 * dicentang di Permission Matrix, tapi semua aksi yang mengubah data ditolak
 * di server (assertCanEditProduksi). Banner ini memberi tahu user soal itu.
 */
export default async function ProduksiLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await getCurrentUserProfile();
  const readOnly = isProduksiReadOnly(profile?.role);

  if (!readOnly) return <>{children}</>;

  return (
    <>
      <div className="mb-3 flex items-center gap-2 rounded-md border border-[#e5c17b]/40 bg-[#e5c17b]/10 px-3 py-2 text-sm text-[#e5c17b]">
        <Eye className="w-4 h-4 shrink-0" />
        <span>
          <strong>Mode Lihat</strong> — role Anda hanya dapat melihat data produksi.
          Input, scan, koreksi, dan hapus data tidak akan diproses.
        </span>
      </div>
      {children}
    </>
  );
}
