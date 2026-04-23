import { getKomponenHpp } from '@/lib/actions/master/komponen-hpp.actions';
import { getSatuan } from '@/lib/actions/master/satuan.actions';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { KomponenHppClient } from './KomponenHppClient';
import { createClient } from '@/lib/supabase/server';

export default async function MasterKomponenHppPage() {
  const supabase = await createClient();
  const profile = await getCurrentUserProfile();
  const isOwner = profile?.role === 'owner';

  const [dataKomponen, dataSatuan, { data: dataInventory }] = await Promise.all([
    getKomponenHpp(),
    getSatuan(),
    supabase.from('inventory_item').select('id, nama, satuan').eq('tenant_id', 'STX-001').order('nama'),
  ]);

  // Serialisasi aman ke plain objects
  const plainKomponen = JSON.parse(JSON.stringify(dataKomponen ?? []));
  const plainSatuan = JSON.parse(JSON.stringify(dataSatuan ?? []));
  const plainInventory = JSON.parse(JSON.stringify(dataInventory ?? []));

  return (
    <PageWrapper
      title="Komponen Biaya (HPP)"
      subtitle="Kelola kamus jenis biaya produksi, raw materials, upah, dan overhead untuk diracik di dalam BOM Produk."
    >
      <KomponenHppClient 
        isOwner={isOwner} 
        listKomponen={plainKomponen}
        listSatuan={plainSatuan}
        listInventoryItem={plainInventory}
      />
    </PageWrapper>
  );
}
