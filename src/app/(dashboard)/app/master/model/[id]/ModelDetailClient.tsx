'use client';

import React, { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Info, Boxes, Clock, Tag, Layout } from 'lucide-react';
import AksesoriTab from './AksesoriTab';
import { ModelAksesori } from '@/lib/actions/produksi/model-aksesori.actions';

interface ModelDetailClientProps {
  model: any;
  initialAksesoris: ModelAksesori[];
}

export default function ModelDetailClient({ model, initialAksesoris }: ModelDetailClientProps) {
  const [activeTab, setActiveTab] = useState('info');

  return (
    <div className="space-y-6">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="bg-[#16181A] border border-[#2A2D31] p-1 h-12">
          <TabsTrigger 
            value="info" 
            className="data-[state=active]:bg-[#e5c17b] data-[state=active]:text-[#2b2318] text-[#9aa0a6] gap-2 px-6"
          >
            <Info size={16} />
            Info Model
          </TabsTrigger>
          <TabsTrigger 
            value="aksesori" 
            className="data-[state=active]:bg-[#e5c17b] data-[state=active]:text-[#2b2318] text-[#9aa0a6] gap-2 px-6"
          >
            <Boxes size={16} />
            Aksesori
          </TabsTrigger>
        </TabsList>

        <div className="mt-6">
          <TabsContent value="info">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="border-[#2A2D31] bg-[#16181A]">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2 text-[#e8eaed]">
                    <Tag size={18} className="text-[#e5c17b]" />
                    Informasi Dasar
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 py-3 border-b border-[#2A2D31]">
                    <span className="text-sm text-[#9aa0a6]">Nama Model</span>
                    <span className="text-sm font-medium text-[#e8eaed] text-right">{model.nama}</span>
                  </div>
                  <div className="grid grid-cols-2 py-3 border-b border-[#2A2D31]">
                    <span className="text-sm text-[#9aa0a6]">Kategori</span>
                    <span className="text-sm font-medium text-[#e8eaed] text-right">{model.kategori_produk?.nama || '-'}</span>
                  </div>
                </CardContent>
              </Card>

              <Card className="border-[#2A2D31] bg-[#16181A]">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2 text-[#e8eaed]">
                    <Layout size={18} className="text-[#e5c17b]" />
                    Produksi
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-2 py-3 border-b border-[#2A2D31]">
                    <span className="text-sm text-[#9aa0a6]">Estimasi Waktu</span>
                    <div className="flex items-center justify-end gap-1 text-[#e8eaed]">
                      <Clock size={14} className="text-[#777e85]" />
                      <span className="text-sm font-medium">{model.estimasi_waktu_menit || 0} menit / pcs</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 py-3 border-b border-[#2A2D31]">
                    <span className="text-sm text-[#9aa0a6]">Status</span>
                    <span className="text-sm font-medium text-green-400 text-right">Aktif</span>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="aksesori">
            <AksesoriTab modelId={model.id} initialData={initialAksesoris} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
