import { 
  getKategoriProduk, 
  getModelProduk, 
  getSize, 
  getWarna 
} from '@/lib/actions/master/detail.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { EmptyState } from '@/components/ui/EmptyState';
import { Tag, Shirt, Maximize, Palette } from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  KategoriFormModal, KategoriDeleteAction,
  ModelFormModal, ModelDeleteAction,
  SizeFormModal, SizeDeleteAction,
  WarnaFormModal, WarnaDeleteAction
} from './DetailClient';

export default async function MasterDetailPage() {
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';

  // Fetch all parallel
  const [dataKategori, dataModel, dataSize, dataWarna] = await Promise.all([
    getKategoriProduk(),
    getModelProduk(),
    getSize(),
    getWarna()
  ]);

  return (
    <PageWrapper
      title="Master Detail: Produk"
      subtitle="Kelola kamus referensi untuk kategori, model produk, sizing, dan warna."
    >
      <div className="mt-2">
        <Tabs defaultValue="kategori" className="w-full">
          <TabsList className="bg-[#1A1D1F] border border-[#2A2D31] p-1 w-full justify-start rounded-t-xl rounded-b-none h-auto flex flex-wrap gap-1">
            <TabsTrigger value="kategori" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6] gap-2">
              <Tag size={16} /> Kategori ({dataKategori.length})
            </TabsTrigger>
            <TabsTrigger value="model" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6] gap-2">
              <Shirt size={16} /> Model SKU ({dataModel.length})
            </TabsTrigger>
            <TabsTrigger value="size" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6] gap-2">
              <Maximize size={16} /> Size ({dataSize.length})
            </TabsTrigger>
            <TabsTrigger value="warna" className="data-[state=active]:bg-[#2A2D31] data-[state=active]:text-[#e5c17b] text-[#9aa0a6] gap-2">
              <Palette size={16} /> Warna ({dataWarna.length})
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: KATEGORI */}
          <TabsContent value="kategori" className="mt-0">
            <div className="rounded-b-xl border border-[#2A2D31] border-t-0 bg-[#1A1D1F] overflow-hidden shadow-lg p-0">
              <div className="flex justify-end p-4 border-b border-[#2A2D31]">
                {isOwner && <KategoriFormModal mode="add" />}
              </div>
              {dataKategori.length === 0 ? (
                <div className="h-48 flex items-center justify-center"><EmptyState icon={<Tag className="h-8 w-8"/>} title="Kosong" description="Belum ada kategori"/></div>
              ) : (
                <Table>
                  <TableHeader className="bg-[#2A2D31]/30">
                    <TableRow className="border-[#2A2D31] hover:bg-transparent">
                      <TableHead className="text-[#9aa0a6]">Nama Kategori</TableHead>
                      {isOwner && <TableHead className="text-right text-[#9aa0a6]">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataKategori.map(val => (
                      <TableRow key={val.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/20">
                        <TableCell className="font-medium text-[#e8eaed]">{val.nama}</TableCell>
                        {isOwner && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <KategoriFormModal mode="edit" id={val.id} initialData={{ nama: val.nama }} />
                              <KategoriDeleteAction id={val.id} />
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

          {/* TAB 2: MODEL */}
          <TabsContent value="model" className="mt-0">
            <div className="rounded-b-xl border border-[#2A2D31] border-t-0 bg-[#1A1D1F] overflow-hidden shadow-lg p-0">
              <div className="flex justify-end p-4 border-b border-[#2A2D31]">
                {isOwner && <ModelFormModal mode="add" masterKategori={dataKategori} />}
              </div>
              {dataModel.length === 0 ? (
                <div className="h-48 flex items-center justify-center"><EmptyState icon={<Shirt className="h-8 w-8"/>} title="Kosong" description="Belum ada model produk"/></div>
              ) : (
                <Table>
                  <TableHeader className="bg-[#2A2D31]/30">
                    <TableRow className="border-[#2A2D31] hover:bg-transparent">
                      <TableHead className="text-[#9aa0a6]">Nama Model</TableHead>
                      <TableHead className="text-[#9aa0a6]">Kategori Induk</TableHead>
                      {isOwner && <TableHead className="text-right text-[#9aa0a6]">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataModel.map(val => (
                      <TableRow key={val.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/20">
                        <TableCell className="font-medium text-[#e8eaed]">{val.nama}</TableCell>
                        <TableCell className="text-[#9aa0a6]"><span className="bg-[#2A2D31] px-2 py-1 rounded text-xs">{val.kategori_produk?.nama || 'Unknown'}</span></TableCell>
                        {isOwner && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <ModelFormModal mode="edit" id={val.id} masterKategori={dataKategori} initialData={{ nama: val.nama, kategori_id: val.kategori_id }} />
                              <ModelDeleteAction id={val.id} />
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

          {/* TAB 3: SIZE */}
          <TabsContent value="size" className="mt-0">
            <div className="rounded-b-xl border border-[#2A2D31] border-t-0 bg-[#1A1D1F] overflow-hidden shadow-lg p-0">
              <div className="flex justify-end p-4 border-b border-[#2A2D31]">
                {isOwner && <SizeFormModal mode="add" />}
              </div>
              {dataSize.length === 0 ? (
                <div className="h-48 flex items-center justify-center"><EmptyState icon={<Maximize className="h-8 w-8"/>} title="Kosong" description="Belum ada sizing produk"/></div>
              ) : (
                <Table>
                  <TableHeader className="bg-[#2A2D31]/30">
                    <TableRow className="border-[#2A2D31] hover:bg-transparent">
                      <TableHead className="text-[#9aa0a6]">Urutan Logika</TableHead>
                      <TableHead className="text-[#9aa0a6]">Nama Size</TableHead>
                      {isOwner && <TableHead className="text-right text-[#9aa0a6]">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataSize.map(val => (
                      <TableRow key={val.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/20">
                        <TableCell className="text-[#e5c17b] font-mono text-xs">INDEX-{val.urutan}</TableCell>
                        <TableCell className="font-medium text-[#e8eaed]">{val.nama}</TableCell>
                        {isOwner && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <SizeFormModal mode="edit" id={val.id} initialData={{ nama: val.nama, urutan: val.urutan }} />
                              <SizeDeleteAction id={val.id} />
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

          {/* TAB 4: WARNA */}
          <TabsContent value="warna" className="mt-0">
            <div className="rounded-b-xl border border-[#2A2D31] border-t-0 bg-[#1A1D1F] overflow-hidden shadow-lg p-0">
              <div className="flex justify-end p-4 border-b border-[#2A2D31]">
                {isOwner && <WarnaFormModal mode="add" />}
              </div>
              {dataWarna.length === 0 ? (
                <div className="h-48 flex items-center justify-center"><EmptyState icon={<Palette className="h-8 w-8"/>} title="Kosong" description="Belum ada palette warna"/></div>
              ) : (
                <Table>
                  <TableHeader className="bg-[#2A2D31]/30">
                    <TableRow className="border-[#2A2D31] hover:bg-transparent">
                      <TableHead className="text-[#9aa0a6]">Nama Warna</TableHead>
                      <TableHead className="text-[#9aa0a6]">Kode Hex</TableHead>
                      {isOwner && <TableHead className="text-right text-[#9aa0a6]">Aksi</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dataWarna.map(val => (
                      <TableRow key={val.id} className="border-[#2A2D31] hover:bg-[#2A2D31]/20">
                        <TableCell className="font-medium text-[#e8eaed]">
                          <div className="flex items-center gap-2">
                            {val.kode_hex && <div className="w-4 h-4 rounded-full border border-[#2A2D31]" style={{ backgroundColor: val.kode_hex }}></div>}
                            {val.nama}
                          </div>
                        </TableCell>
                        <TableCell className="text-[#9aa0a6] font-mono">{val.kode_hex || '-'}</TableCell>
                        {isOwner && (
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-1">
                              <WarnaFormModal mode="edit" id={val.id} initialData={{ nama: val.nama, kode_hex: val.kode_hex || undefined }} />
                              <WarnaDeleteAction id={val.id} />
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

        </Tabs>
      </div>
    </PageWrapper>
  );
}
