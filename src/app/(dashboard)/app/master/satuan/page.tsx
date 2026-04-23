import { getSatuan } from '@/lib/actions/master/satuan.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { EmptyState } from '@/components/ui/EmptyState';
import { Scale } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { SatuanFormModal, SatuanDeleteAction } from './SatuanClient';

export default async function MasterSatuanPage() {
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';
  const data = await getSatuan();

  return (
    <PageWrapper
      title="Master Satuan (UOM)"
      subtitle="Kelola kamus satuan dimensi ukuran bahan dan komponen."
      actions={isOwner && <SatuanFormModal mode="add" />}
    >
      <div className="rounded-xl border border-[#2A2D31] bg-[#1A1D1F] overflow-hidden shadow-lg mt-2 w-full lg:w-1/2">
        {data.length === 0 ? (
           <div className="h-48 flex items-center justify-center"><EmptyState icon={<Scale className="h-8 w-8"/>} title="Kosong" description="Belum ada master satuan yang ditambahkan"/></div>
         ) : (
          <Table>
            <TableHeader className="bg-[#2A2D31]/30">
              <TableRow className="border-[#2A2D31] hover:bg-transparent">
                <TableHead className="text-[#9aa0a6] w-[70%]">Unit of Measurement (UOM)</TableHead>
                {isOwner && <TableHead className="text-[#9aa0a6] text-right">Aksi</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((item) => (
                <TableRow key={item.id} className="border-[#2A2D31] transition-colors hover:bg-[#2A2D31]/20">
                  <TableCell className="font-medium text-[#e8eaed]">{item.nama}</TableCell>
                  {isOwner && (
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <SatuanFormModal mode="edit" id={item.id} initialData={{ nama: item.nama }} />
                        <SatuanDeleteAction id={item.id} />
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </PageWrapper>
  );
}
