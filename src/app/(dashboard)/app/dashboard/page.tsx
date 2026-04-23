import { redirect } from 'next/navigation';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { PageWrapper } from '@/components/ui/PageWrapper';
import { KpiCard } from '@/components/ui/KpiCard';
import { ClipboardList, Layers, Truck, Wallet } from 'lucide-react';

export default async function DashboardPage() {
  const profile = await getCurrentUserProfile();

  if (!profile) {
    redirect('/login');
  }

  return (
    <PageWrapper
      title="Dashboard"
      subtitle={`Selamat datang, ${profile.nama}`}
    >
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          label="Total PO Aktif"
          value="12"
          subValue="2 PO baru minggu ini"
          trend="up"
          icon={<ClipboardList className="h-5 w-5" />}
        />
        <KpiCard
          label="Total Bundle Produksi"
          value="850"
          subValue="40 bundle selesai"
          trend="up"
          icon={<Layers className="h-5 w-5" />}
        />
        <KpiCard
          label="Total Pengiriman"
          value="24"
          subValue="Bulan ini"
          trend="neutral"
          icon={<Truck className="h-5 w-5" />}
        />
        <KpiCard
          label="Saldo Kas Periode Ini"
          value="Rp 45.500.000"
          subValue="Naik Rp 5jt"
          trend="up"
          icon={<Wallet className="h-5 w-5" />}
        />
      </div>
    </PageWrapper>
  );
}
