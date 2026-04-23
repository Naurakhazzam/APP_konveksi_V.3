import { getKlien } from '@/lib/actions/master/klien.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { EmptyState } from '@/components/ui/EmptyState';
import { UsersRound } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { KlienFormModal, KlienDeleteAction } from './KlienClient';

export default async function KlienPage() {
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';
  
  // Mengambil data server secara langsung (RSC)
  const data = await getKlien();

  return (
    <PageWrapper
      title="Master Klien"
      subtitle="Kelola daftar klien/pemberi PO (Purchase Order)."
      actions={isOwner && <KlienFormModal mode="add" />}
    >
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg">
        <Table>
          <TableHeader className="bg-[#2A2D31]/30">
            <TableRow className="border-[#2A2D31] hover:bg-transparent">
              <TableHead className="text-[#9aa0a6]">Nama Klien</TableHead>
              <TableHead className="text-[#9aa0a6] max-w-[300px]">Alamat</TableHead>
              <TableHead className="text-[#9aa0a6]">Kontak</TableHead>
              {isOwner && <TableHead className="text-[#9aa0a6] text-right">Aksi</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.length === 0 ? (
              <TableRow>
                <TableCell colSpan={isOwner ? 4 : 3} className="h-64">
                  <EmptyState 
                    icon={<UsersRound className="w-10 h-10" />}
                    title="Data Klien Kosong" 
                    description="Belum ada data master klien (brand/pelanggan) yang diinput ke dalam sistem." 
                  />
                </TableCell>
              </TableRow>
            ) : (
              data.map((klien) => (
                <TableRow key={klien.id} className="border-[#2A2D31] transition-colors hover:bg-[#2A2D31]/20">
                  <TableCell className="font-medium text-[#e8eaed]">{klien.nama}</TableCell>
                  <TableCell className="text-[#9aa0a6] max-w-[300px] truncate">
                    {klien.alamat || '-'}
                  </TableCell>
                  <TableCell className="text-[#9aa0a6] font-mono">
                    {klien.kontak || '-'}
                  </TableCell>
                  
                  {isOwner && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <KlienFormModal 
                          mode="edit" 
                          klienId={klien.id} 
                          initialData={{
                            nama: klien.nama,
                            alamat: klien.alamat || undefined,
                            kontak: klien.kontak || undefined,
                          }} 
                        />
                        <KlienDeleteAction id={klien.id} />
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
