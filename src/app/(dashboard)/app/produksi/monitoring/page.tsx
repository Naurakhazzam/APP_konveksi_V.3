import { PageWrapper } from '@/components/ui/PageWrapper';
import { getKlienList } from '@/lib/actions/produksi/po.actions';
import { getMonitoringStats, getPoGrouped, getMonitoringPerArtikel } from '@/lib/actions/produksi/monitoring.actions';
import MonitoringClient from './MonitoringClient';
import { getCurrentUserProfile } from '@/lib/auth/permissions';

export default async function MonitoringPage() {
  const [profile, stats, klienList, poGrouped, artikelData] = await Promise.all([
    getCurrentUserProfile(),
    getMonitoringStats(),
    getKlienList(),
    getPoGrouped(),
    getMonitoringPerArtikel()
  ]);

  // Dropdown filter Monitor Artikel harus mencakup semua PO yang muncul di artikelData
  // (termasuk PO berstatus 'selesai'), bukan cuma PO aktif dari poGrouped.
  const poListSimplified = Array.from(
    new Map(artikelData.map(a => [a.no_po, { id: a.id, no_po: a.no_po }])).values()
  ).sort((a, b) => a.no_po.localeCompare(b.no_po));

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
        role={profile?.role ?? 'mandor'}
      />
    </PageWrapper>
  );
}
