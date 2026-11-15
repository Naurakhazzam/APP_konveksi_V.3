import { getInvoiceList, getKlienListForInvoice } from '@/lib/actions/keuangan/invoice.actions';
import { bulanBerjalan } from '@/lib/bulan-berjalan';
import { PageWrapper } from '@/components/ui/PageWrapper';
import InvoiceClient from './InvoiceClient';

export const metadata = {
  title: 'Invoice & Tagihan | Stitchlyx',
};

export default async function InvoicePage() {
  try {
    const { bulan, tahun } = bulanBerjalan();
    const [invoices, klienList] = await Promise.all([
      getInvoiceList({ bulan, tahun }),
      getKlienListForInvoice(),
    ]);

    return (
      <PageWrapper
        title="Invoice & Tagihan"
        subtitle="Invoice otomatis dibuat setiap kali Surat Jalan diterbitkan."
      >
        <InvoiceClient
          initialInvoices={invoices}
          klienList={klienList}
          defaultBulan={bulan}
          defaultTahun={tahun}
        />
      </PageWrapper>
    );
  } catch (e) {
    return (
      <div className="p-8 text-red-400">
        Error memuat data invoice: {String(e)}
      </div>
    );
  }
}
