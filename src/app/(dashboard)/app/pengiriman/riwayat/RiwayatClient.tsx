'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import type { SuratJalanRow } from '@/lib/actions/pengiriman/surat-jalan.actions';

export default function RiwayatClient({ initialData }: { initialData: SuratJalanRow[] }) {
  const [search, setSearch] = useState('');

  const filteredData = useMemo(() => {
    const q = search.toLowerCase();
    return initialData.filter(sj => 
      sj.nomor_sj.toLowerCase().includes(q) || 
      sj.klien_nama.toLowerCase().includes(q)
    );
  }, [initialData, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <input 
          type="text" 
          placeholder="Cari Nomor SJ atau Nama Klien..." 
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full sm:max-w-xs bg-[#1A1D1F] border border-[#2A2D31] text-[#e8eaed] px-4 py-2 rounded-md text-sm focus:outline-none focus:border-[#e5c17b]"
        />
        <Link 
          href="/app/pengiriman/buat-surat-jalan"
          className="bg-[#e5c17b] text-[#0D0E10] px-4 py-2 rounded-md font-bold text-sm hover:bg-[#d4b06a] transition-colors uppercase tracking-wider text-center"
        >
          + Buat Surat Jalan
        </Link>
      </div>

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-[#9aa0a6] uppercase bg-[#0D0E10] border-b border-[#2A2D31]">
            <tr>
              <th className="px-6 py-4">Nomor SJ</th>
              <th className="px-6 py-4">Klien</th>
              <th className="px-6 py-4">Tanggal</th>
              <th className="px-6 py-4">Bundle</th>
              <th className="px-6 py-4">Total QTY</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4 text-right">Aksi</th>
            </tr>
          </thead>
          <tbody>
            {filteredData.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-6 py-12 text-center text-[#9aa0a6]">
                  {search ? 'Tidak ada surat jalan yang cocok dengan pencarian.' : 'Belum ada riwayat surat jalan.'}
                </td>
              </tr>
            ) : (
              filteredData.map(sj => (
                <tr key={sj.id} className="border-b border-[#2A2D31] hover:bg-[#0D0E10]/50 transition-colors">
                  <td className="px-6 py-4 font-mono font-medium text-[#e8eaed]">{sj.nomor_sj}</td>
                  <td className="px-6 py-4 text-[#e8eaed]">{sj.klien_nama}</td>
                  <td className="px-6 py-4 text-[#9aa0a6]">
                    {new Date(sj.tanggal).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}
                  </td>
                  <td className="px-6 py-4 text-[#e8eaed]">{sj.total_bundle} <span className="text-[#9aa0a6] text-xs">Bundle</span></td>
                  <td className="px-6 py-4 text-[#e8eaed]">{sj.total_qty} <span className="text-[#9aa0a6] text-xs">Pcs</span></td>
                  <td className="px-6 py-4 text-center">
                    <span className="inline-block px-2 py-1 text-[10px] font-bold tracking-widest uppercase rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                      {sj.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <Link 
                      href={`/app/pengiriman/riwayat/${sj.id}`}
                      className="text-[#e5c17b] hover:text-[#d4b06a] text-xs font-medium uppercase tracking-wider"
                    >
                      Lihat Detail &rarr;
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
