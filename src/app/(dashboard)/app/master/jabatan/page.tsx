import { getJabatan } from '@/lib/actions/master/jabatan.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { EmptyState } from '@/components/ui/EmptyState';
import { Briefcase } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { JabatanFormModal, JabatanDeleteAction } from './JabatanClient';
import { TAHAP_LABELS } from '@/lib/constants/jabatan-mapping';

export default async function JabatanPage() {
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';
  const data = await getJabatan();

  return (
    <PageWrapper
      title="Master Jabatan"
      subtitle="Kelola jabatan karyawan dan mapping tahap produksi yang ditangani."
      actions={isOwner && <JabatanFormModal mode="add" />}
    >
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg">
        <Table>
          <TableHeader className="bg-[#2A2D31]/30">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Nama Jabatan</TableHead>
              <TableHead className="text-[#9aa0a6]">Tahap Produksi</TableHead>
              <TableHead className="text-[#9aa0a6]">Gaji Default</TableHead>
              <TableHead className="text-[#9aa0a6]">Status</TableHead>
              {isOwner && <TableHead className="text-[#9aa0a6] text-right">Aksi</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOwner ? 5 : 4} className="h-64">
                  <EmptyState
                    icon={<Briefcase className="w-10 h-10" />}
                    title="Data Jabatan Kosong"
                    description="Belum ada data master jabatan. Tambahkan jabatan untuk memetakan tanggung jawab karyawan."
                  />
                </TableCell>
              </TableRow>
            ) : (
              data.map((item) => (
                <TableRow
                  key={item.id}
                  className="border-[#2A2D31] transition-colors hover:bg-[#2A2D31]/20"
                >
                  <TableCell className="font-medium text-[#e8eaed]">
                    {item.nama}
                    {item.deskripsi && (
                      <p className="text-xs text-[#9aa0a6] mt-0.5">{item.deskripsi}</p>
                    )}
                  </TableCell>
                  <TableCell>
                    {(item.tahap_produksi as string[]).length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {(item.tahap_produksi as string[]).map((t) => (
                          <span
                            key={t}
                            className="inline-flex items-center rounded-md bg-[#e5c17b]/10 px-2 py-0.5 text-xs font-medium text-[#e5c17b] ring-1 ring-inset ring-[#e5c17b]/20"
                          >
                            {TAHAP_LABELS[t] ?? t}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-[#5f6368] text-xs">Tidak ada</span>
                    )}
                  </TableCell>
                  <TableCell className="text-[#e8eaed] font-medium tracking-wide">
                    {new Intl.NumberFormat('id-ID', {
                      style: 'currency',
                      currency: 'IDR',
                      maximumFractionDigits: 0,
                    }).format(Number(item.gaji_default))}
                  </TableCell>
                  <TableCell>
                    {item.aktif ? (
                      <span className="inline-flex items-center rounded-md bg-[color:var(--status-green)]/10 px-2 py-1 text-xs font-medium text-[color:var(--status-green)] ring-1 ring-inset ring-[color:var(--status-green)]/20">
                        Aktif
                      </span>
                    ) : (
                      <span className="inline-flex items-center rounded-md bg-[#5f6368]/10 px-2 py-1 text-xs font-medium text-[#9aa0a6] ring-1 ring-inset ring-[#5f6368]/30">
                        Nonaktif
                      </span>
                    )}
                  </TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <JabatanFormModal
                          mode="edit"
                          jabatanId={item.id}
                          initialData={{
                            nama: item.nama,
                            deskripsi: item.deskripsi ?? '',
                            tahap_produksi: item.tahap_produksi as string[],
                            gaji_default: Number(item.gaji_default),
                            aktif: item.aktif,
                          }}
                        />
                        <JabatanDeleteAction id={item.id} />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </PageWrapper>
  );
}
