import { getJenisReject, getAlasanReject } from '@/lib/actions/master/reject.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { Info, FolderTree, AlertOctagon } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  JenisRejectFormModal, JenisRejectDeleteAction,
  AlasanRejectFormModal, AlasanRejectDeleteAction
} from './RejectClient';
import { TAHAP_LABELS } from '@/lib/constants/jabatan-mapping';

export default async function MasterRejectPage() {
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';

  const [dataJenis, dataAlasan] = await Promise.all([
    getJenisReject(),
    getAlasanReject(),
  ]);

  return (
    <PageWrapper
      title="Master Jenis & Alasan Reject"
      subtitle="Kamus kriteria cacat produksi beserta konsekuensi perbaikan maupun denda upah/BOM."
    >
      <div className="mt-2">
        <Tabs defaultValue="alasan" className="w-full">
          <TabsList className="bg-[#1A1D1F] border border-[#2A2D31] p-1 w-full justify-start rounded-t-xl rounded-b-none h-auto flex flex-wrap gap-1">
            <TabsTrigger value="alasan" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6] gap-2">
              <Info size={16} /> Alasan Reject / Cacat ({dataAlasan.length})
            </TabsTrigger>
            <TabsTrigger value="jenis" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6] gap-2">
              <FolderTree size={16} /> Kelompok Jenis ({dataJenis.length})
            </TabsTrigger>
          </TabsList>

          {/* TAB ALASAN REJECT (Utama) */}
          <TabsContent value="alasan" className="mt-0">
            <div className="rounded-b-xl border border-[#2A2D31] border-t-0 bg-[#1A1D1F] overflow-hidden shadow-lg p-0">
              <div className="flex justify-end p-4 border-b border-[#2A2D31]">
                {isOwner && <AlasanRejectFormModal mode="add" masterJenis={dataJenis} />}
              </div>
              {dataAlasan.length === 0 ? (
                <div className="h-48 flex items-center justify-center"><EmptyState icon={<AlertOctagon className="h-8 w-8"/>} title="Data Kosong" description="Belum ada alasan definisi reject produk."/></div>
              ) : (
                <Table>
                  <TableHeader className="bg-[#2A2D31]/30">
                    <TableRow className="border-[#2A2D31] hover:bg-transparent">
                      <TableHead className="text-[#9aa0a6]">Deskripsi Reject / Indikator Cacat</TableHead>
                      <TableHead className="text-[#9aa0a6]">Tahap Tanggung Jawab</TableHead>
                      <TableHead className="text-[#9aa0a6]">Dapat Diperbaiki</TableHead>
                      <TableHead className="text-[#9aa0a6]">Dampak Potongan Klaim</TableHead>
                      {isOwner && <TableHead className="text-right text-[#9aa0a6]">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataAlasan.map(val => (
                      <TableRow key={val.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/20">
                        <TableCell className="font-medium text-[#e8eaed]">
                           <span className="block">{val.nama}</span>
                           <span className="text-xs text-[#9aa0a6] mt-1 hidden lg:block">Kat: {val.jenis_reject?.nama || 'Tanpa Kategori'}</span>
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex rounded-full bg-[#e5c17b]/10 px-2 py-1 text-xs font-semibold text-[#e5c17b] border border-[#e5c17b]/20">
                            {TAHAP_LABELS[val.tahap_bertanggung_jawab] || val.tahap_bertanggung_jawab}
                          </span>
                        </TableCell>
                        <TableCell>
                           {val.bisa_diperbaiki ? (
                             <span className="inline-flex rounded-md bg-[color:var(--status-green)]/10 px-2 py-1 text-xs font-medium text-[color:var(--status-green)]">Bisa Direparasi</span>
                           ) : (
                             <span className="inline-flex rounded-md bg-[color:var(--status-red)]/10 px-2 py-1 text-xs font-medium text-[color:var(--status-red)]">Rusak / Afkir (Dibuang)</span>
                           )}
                        </TableCell>
                        <TableCell>
                           {val.dampak_potongan === 'upah_tahap' && <span className="inline-flex rounded-md bg-[color:var(--status-yellow)]/10 px-2 py-1 text-xs font-medium text-[color:var(--status-yellow)]">Denda Upah Tukang Tahapan</span>}
                           {val.dampak_potongan === 'hpp_po' && <span className="inline-flex rounded-md bg-purple-500/10 px-2 py-1 text-xs font-medium text-purple-400">Potong Tagihan HPP PO</span>}
                           {!val.dampak_potongan && <span className="text-xs text-[#5f6368]">- Relaksasi / Bebas Potongan -</span>}
                        </TableCell>
                        {isOwner && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <AlasanRejectFormModal mode="edit" id={val.id} masterJenis={dataJenis} initialData={{ nama: val.nama, jenis_reject_id: val.jenis_reject_id, tahap_bertanggung_jawab: val.tahap_bertanggung_jawab, bisa_diperbaiki: val.bisa_diperbaiki, dampak_potongan: val.dampak_potongan }} />
                              <AlasanRejectDeleteAction id={val.id} />
                            </div>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </div>
          </TabsContent>

          {/* TAB KELOMPOK JENIS */}
          <TabsContent value="jenis" className="mt-0">
            <div className="rounded-b-xl border border-[#2A2D31] border-t-0 bg-[#1A1D1F] overflow-hidden shadow-lg p-0">
              <div className="flex justify-end p-4 border-b border-[#2A2D31]">
                {isOwner && <JenisRejectFormModal mode="add" />}
              </div>
              <Table>
                <TableHeader className="bg-[#2A2D31]/30">
                  <TableRow className="border-[#2A2D31] hover:bg-transparent">
                    <TableHead className="text-[#9aa0a6] w-[70%]">Nama Kategori Jenis Cacat</TableHead>
                    {isOwner && <TableHead className="text-right text-[#9aa0a6]">Aksi</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataJenis.map(val => (
                    <TableRow key={val.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/20">
                      <TableCell className="font-medium text-[#e8eaed]">{val.nama}</TableCell>
                      {isOwner && (
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1">
                            <JenisRejectFormModal mode="edit" id={val.id} initialData={{ nama: val.nama }} />
                            <JenisRejectDeleteAction id={val.id} />
                          </div>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

        </Tabs>
      </div>
    </PageWrapper>
  );
}
