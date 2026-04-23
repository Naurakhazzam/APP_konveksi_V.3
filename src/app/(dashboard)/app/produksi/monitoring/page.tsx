import { PageWrapper } from '@/components/ui/PageWrapper';
import { getKlienList } from '@/lib/actions/produksi/po.actions';
import { getMonitoringStats, getPoGrouped, getMonitoringPerArtikel } from '@/lib/actions/produksi/monitoring.actions';
import MonitoringClient from './MonitoringClient';

export default async function MonitoringPage() {
  const [stats, klienList, poGrouped, artikelData] = await Promise.all([
    getMonitoringStats(),
    getKlienList(),
    getPoGrouped(),
    getMonitoringPerArtikel()
  ]);

  const allPos = [...poGrouped.belum_mulai, ...poGrouped.sedang_diproses, ...poGrouped.selesai];
  const poListSimplified = allPos.map(po => ({ id: po.id, no_po: po.no_po }));

  return (
    <PageWrapper
      title="Live Monitoring Dashboard"
      subtitle="Status produksi real-time dari seluruh lini"
    >
      <MonitoringClient 
        stats={stats} 
        klienList={klienList} 
        poGrouped={poGrouped}
        artikelData={artikelData}
        poList={poListSimplified}
      />
    </PageWrapper>
  );
}
