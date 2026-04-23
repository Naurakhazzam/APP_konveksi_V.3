import { getKaryawan } from '@/lib/actions/master/karyawan.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { EmptyState } from '@/components/ui/EmptyState';
import { Users } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KaryawanFormModal, KaryawanDeleteAction } from './KaryawanClient';

export default async function KaryawanPage() {
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';
  
  // Mengambil data server secara langsung (RSC)
  const data = await getKaryawan();

  return (
    <PageWrapper
      title="Master Karyawan"
      subtitle="Kelola data karyawan produksi dan administrasi."
      actions={isOwner && <KaryawanFormModal mode="add" />}
    >
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg">
        <Table>
          <TableHeader className="bg-[#2A2D31]/30">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Nama Karyawan</TableHead>
              <TableHead className="text-[#9aa0a6]">Jabatan</TableHead>
              <TableHead className="text-[#9aa0a6]">Tahap</TableHead>
              <TableHead className="text-[#9aa0a6]">Gaji Pokok</TableHead>
              <TableHead className="text-[#9aa0a6]">Status</TableHead>
              {isOwner && <TableHead className="text-[#9aa0a6] text-right">Aksi</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOwner ? 5 : 4} className="h-64">
                  <EmptyState 
                    icon={<Users className="w-10 h-10" />}
                    title="Data Karyawan Kosong" 
                    description="Belum ada data master karyawan yang diinput ke dalam sistem." 
                  />
                </TableCell>
              </TableRow>
            ) : (
              data.map((karyawan) => (
                <TableRow key={karyawan.id} className="border-[#2A2D31] transition-colors hover:bg-[#2A2D31]/20">
                  <TableCell className="font-medium text-[#e8eaed]">{karyawan.nama}</TableCell>
                  <TableCell className="text-[#9aa0a6]">{karyawan.jabatan}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(karyawan.tahap_produksi ?? []).length === 0 ? (
                        <span className="text-xs text-[#5f6368]">—</span>
                      ) : (
                        (karyawan.tahap_produksi ?? []).map((t: string) => (
                          <span key={t}
                            className="rounded px-1.5 py-0.5 text-xs bg-[#2A2D31] text-[#9aa0a6]">
                            {t.replace('_', ' ')}
                          </span>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-[#e8eaed] font-medium tracking-wide">
                    {new Intl.NumberFormat('id-ID', {
                      style: 'currency',
                      currency: 'IDR',
                      maximumFractionDigits: 0,
                    }).format(Number(karyawan.gaji_pokok))}
                  </TableCell>
                  <TableCell>
                    {karyawan.aktif ? (
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
                        <KaryawanFormModal 
                          mode="edit" 
                          karyawanId={karyawan.id} 
                          initialData={{
                            nama: karyawan.nama,
                            jabatan: karyawan.jabatan,
                            gaji_pokok: Number(karyawan.gaji_pokok),
                            tahap_produksi: (karyawan.tahap_produksi as string[]) || [],
                            aktif: karyawan.aktif,
                          }} 
                        />
                        <KaryawanDeleteAction id={karyawan.id} />
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
