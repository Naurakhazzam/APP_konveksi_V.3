import { getInvoiceList, getKlienListForInvoice, getSuratJalanForInvoice } from '@/lib/actions/keuangan/invoice.actions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import InvoiceClient from './InvoiceClient';

export const metadata = {
  title: 'Invoice & Tagihan | Stitchlyx',
};

export default async function InvoicePage() {
  try {
    const [invoices, klienList, sjList] = await Promise.all([
      getInvoiceList(),
      getKlienListForInvoice(),
      getSuratJalanForInvoice(),
    ]);

    return (
      <PageWrapper
        title="Invoice & Tagihan"
        subtitle="Kelola invoice dan track pembayaran klien."
      >
        <InvoiceClient
          initialInvoices={invoices}
          klienList={klienList}
          sjList={sjList}
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
