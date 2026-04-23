import { getSuratJalanDetail } from '@/lib/actions/pengiriman/surat-jalan.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { redirect } from 'next/navigation';
import PrintButton from './PrintButton';
import PrintSuratJalanLayout from './PrintSuratJalanLayout';
import Link from 'next/link';

export default async function DetailSuratJalanPage({ params }: { params: { id: string } }) {
  const detail = await getSuratJalanDetail(params.id);

  if (!detail) {
    redirect('/app/pengiriman/riwayat');
  }

  const totalBundle = detail.items.length;
  const totalQty = detail.items.reduce((sum, item) => sum + item.qty_kirim, 0);

  return (
    <>
      <PageWrapper
        title={`Detail Surat Jalan ${detail.nomor_sj}`}
        subtitle="Rincian informasi pengiriman dan bundle yang dikirim."
      >
        {/* Konten UI normal (Screen) */}
        <div className="space-y-6 print:hidden">
          <div className="flex justify-between items-center">
            <Link 
              href="/app/pengiriman/riwayat"
              className="text-[#9aa0a6] hover:text-[#e8eaed] text-sm font-medium transition-colors"
            >
              &larr; Kembali ke Riwayat
            </Link>
            <PrintButton />
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg p-5 space-y-4">
              <h3 className="text-[#e8eaed] font-semibold border-b border-[#2A2D31] pb-2">Informasi Umum</h3>
              <div className="grid grid-cols-2 gap-y-3 text-sm">
                <div className="text-[#9aa0a6]">Nomor SJ</div>
                <div className="text-[#e8eaed] font-mono font-medium">{detail.nomor_sj}</div>
                <div className="text-[#9aa0a6]">Tanggal</div>
                <div className="text-[#e8eaed]">{new Date(detail.tanggal).toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
                <div className="text-[#9aa0a6]">Catatan / Pengirim</div>
                <div className="text-[#e8eaed]">{detail.catatan || '-'}</div>
              </div>
            </div>

            <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg p-5 space-y-4">
              <h3 className="text-[#e8eaed] font-semibold border-b border-[#2A2D31] pb-2">Informasi Klien</h3>
              <div className="grid grid-cols-2 gap-y-3 text-sm">
                <div className="text-[#9aa0a6]">Nama Klien</div>
                <div className="text-[#e5c17b] font-semibold">{detail.klien_nama}</div>
                <div className="text-[#9aa0a6]">Alamat</div>
                <div className="text-[#e8eaed] leading-relaxed">{detail.klien_alamat || '-'}</div>
              </div>
            </div>
          </div>

          <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-lg overflow-hidden">
            <div className="p-4 border-b border-[#2A2D31] flex justify-between items-center bg-[#0D0E10]">
              <h3 className="font-semibold text-[#e8eaed]">Daftar Bundle ({totalBundle})</h3>
              <span className="text-sm text-[#e8eaed] font-medium bg-[#2A2D31] px-3 py-1 rounded">
                Total QTY: {totalQty}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-[#9aa0a6] uppercase bg-[#0D0E10] border-b border-[#2A2D31]">
                  <tr>
                    <th className="px-6 py-4">Barcode</th>
                    <th className="px-6 py-4">Item Info</th>
                    <th className="px-6 py-4">Warna / Size</th>
                    <th className="px-6 py-4 text-right">QTY Kirim</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.items.map((item, idx) => (
                    <tr key={idx} className="border-b border-[#2A2D31] hover:bg-[#0D0E10]/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-[#e8eaed]">{item.barcode}</td>
                      <td className="px-6 py-4">
                        <div className="font-medium text-[#e8eaed]">{item.model_nama || '-'}</div>
                        <div className="text-xs text-[#9aa0a6]">PO: {item.no_po}</div>
                      </td>
                      <td className="px-6 py-4 text-[#e8eaed]">
                        {item.warna} <span className="text-[#9aa0a6] mx-1">/</span> {item.size}
                      </td>
                      <td className="px-6 py-4 text-right font-medium text-[#e8eaed]">
                        {item.qty_kirim}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </PageWrapper>

      {/* Komponen Print khusus */}
      <PrintSuratJalanLayout detail={detail} />
    </>
  );
}
