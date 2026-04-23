import { getKategoriTrx } from '@/lib/actions/master/kategori-trx.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { EmptyState } from '@/components/ui/EmptyState';
import { StatusBadge, type StatusType } from '@/components/ui/StatusBadge';
import { Tag } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { KategoriTrxFormModal, KategoriTrxDeleteAction } from './KategoriTrxClient';

function KategoriTableView({ data, isOwner }: { data: any[], isOwner: boolean }) {
  if (data.length === 0) {
    return (
      <div className="h-64 flex bg-[#1A1D1F] border border-[#2A2D31] rounded-b-xl border-t-0 items-center justify-center">
        <EmptyState 
          icon={<Tag className="w-10 h-10" />}
          title="Data Kategori Kosong" 
          description="Belum ada master kategori transaksi di tab ini." 
        />
      </div>
    );
  }

  return (
    <div className="rounded-b-xl border border-[#2A2D31] border-t-0 bg-[#1A1D1F] overflow-hidden shadow-lg">
      <Table>
        <TableHeader className="bg-[#2A2D31]/30">
          <TableRow className="border-[#2A2D31] hover:bg-transparent">
            <TableHead className="text-[#9aa0a6] w-[40%]">Nama Kategori</TableHead>
            <TableHead className="text-[#9aa0a6] w-[20%]">Jenis Alokasi</TableHead>
            <TableHead className="text-[#9aa0a6] w-[20%] text-center">Status</TableHead>
            {isOwner && <TableHead className="text-[#9aa0a6] text-right w-[20%]">Aksi</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map((item) => (
             <TableRow key={item.id} className="border-[#2A2D31] transition-colors hover:bg-[#2A2D31]/20">
               <TableCell className="font-medium text-[#e8eaed]">{item.nama}</TableCell>
               <TableCell>
                 <StatusBadge status={item.jenis as StatusType} />
               </TableCell>
               <TableCell className="text-center">
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
                      <KategoriTrxFormModal 
                        mode="edit" 
                        kategoriId={item.id} 
                        initialData={{
                          nama: item.nama,
                          jenis: item.jenis,
                          aktif: item.aktif,
                        }} 
                      />
                      <KategoriTrxDeleteAction id={item.id} />
                    </div>
                  </TableCell>
                )}
             </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default async function KategoriTrxPage() {
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';
  
  // RSC Fetch everything upfront for fast client tab switching
  const allData = await getKategoriTrx('semua');

  // Server-side partition mapping
  const bahanList = allData.filter(d => d.jenis === 'direct_bahan');
  const upahList = allData.filter(d => d.jenis === 'direct_upah');
  const overheadList = allData.filter(d => d.jenis === 'overhead');
  const masukList = allData.filter(d => d.jenis === 'masuk');

  return (
    <PageWrapper
      title="Master Kategori Transaksi"
      subtitle="Kelola struktur alokasi kategori jurnal keuangan dan inventory."
      actions={isOwner && <KategoriTrxFormModal mode="add" />}
    >
      <div className="mt-2">
        <Tabs defaultValue="semua" className="w-full">
          <TabsList className="bg-[#1A1D1F] border border-[#2A2D31] p-1 w-full justify-start rounded-t-xl rounded-b-none h-auto flex flex-wrap gap-1">
            <TabsTrigger 
              value="semua" 
              className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6]"
            >
              Semua ({allData.length})
            </TabsTrigger>
            <TabsTrigger 
              value="bahan" 
              className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6]"
            >
              Bahan Baku ({bahanList.length})
            </TabsTrigger>
            <TabsTrigger 
              value="upah" 
              className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6]"
            >
              Upah Langsung ({upahList.length})
            </TabsTrigger>
            <TabsTrigger 
              value="overhead" 
              className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6]"
            >
              Overhead ({overheadList.length})
            </TabsTrigger>
            <TabsTrigger 
              value="masuk" 
              className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6]"
            >
              Pemasukan ({masukList.length})
            </TabsTrigger>
          </TabsList>

          <TabsContent value="semua" className="mt-0">
            <KategoriTableView data={allData} isOwner={isOwner} />
          </TabsContent>
          
          <TabsContent value="bahan" className="mt-0">
            <KategoriTableView data={bahanList} isOwner={isOwner} />
          </TabsContent>
          
          <TabsContent value="upah" className="mt-0">
            <KategoriTableView data={upahList} isOwner={isOwner} />
          </TabsContent>
          
          <TabsContent value="overhead" className="mt-0">
            <KategoriTableView data={overheadList} isOwner={isOwner} />
          </TabsContent>
          
          <TabsContent value="masuk" className="mt-0">
            <KategoriTableView data={masukList} isOwner={isOwner} />
          </TabsContent>
        </Tabs>
      </div>
    </PageWrapper>
  );
}
