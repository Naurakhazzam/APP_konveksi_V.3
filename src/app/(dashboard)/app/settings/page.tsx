import { PageWrapper } from '@/components/ui/PageWrapper';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { hasApprovalPin } from '@/lib/actions/settings/pin.actions';
import { redirect } from 'next/navigation';
import PinSetupSection from './PinSetupSection';
import { getSettings, getKaryawanAktif } from '@/lib/actions/settings/settings.actions';
import DefaultBoronganSection from './DefaultBoronganSection';
import ResetDataSection from './ResetDataSection';

export default async function SettingsPage() {
  const profile = await getCurrentUserProfile();

  // Hanya owner yang boleh akses settings PIN
  if (!profile || profile.role !== 'owner') {
    redirect('/app');
  }

  const hasPin = await hasApprovalPin();
  const [settings, karyawan] = await Promise.all([
    getSettings(),
    getKaryawanAktif(),
  ]);

  return (
    <PageWrapper
      title="Pengaturan"
      subtitle="Kelola preferensi akun dan keamanan sistem."
    >
      <div className="max-w-2xl space-y-6 mt-4">
        <PinSetupSection hasPinAlready={hasPin} />
        <DefaultBoronganSection
          currentId={settings.default_karyawan_borongan_id}
          karyawan={karyawan}
        />
        <ResetDataSection />
      </div>
    </PageWrapper>
  );
}
