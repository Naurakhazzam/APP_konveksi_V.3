import { getInvoiceList, getKlienListForInvoice } from '@/lib/actions/keuangan/invoice.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import InvoiceClient from './InvoiceClient';

export const metadata = {
  title: 'Invoice & Tagihan | Stitchlyx',
};

export default async function InvoicePage() {
  try {
    const [invoices, klienList] = await Promise.all([
      getInvoiceList(),
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
