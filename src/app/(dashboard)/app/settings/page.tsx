import { PageWrapper } from '@/components/ui/PageWrapper';
import { getCurrentUserProfile } from '@/lib/auth/permissions';
import { hasApprovalPin } from '@/lib/actions/settings/pin.actions';
import { redirect } from 'next/navigation';
import PinSetupSection from './PinSetupSection';

export default async function SettingsPage() {
  const profile = await getCurrentUserProfile();
  
  // Hanya owner yang boleh akses settings PIN
  if (!profile || profile.role !== 'owner') {
    redirect('/app');
  }

  const hasPin = await hasApprovalPin();

  return (
    <PageWrapper
      title="Pengaturan"
      subtitle="Kelola preferensi akun dan keamanan sistem."
    >
      <div className="max-w-2xl space-y-6 mt-4">
        <PinSetupSection hasPinAlready={hasPin} />
      </div>
    </PageWrapper>
  );
}
