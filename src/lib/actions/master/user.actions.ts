'use server';

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentUserProfile, permissions, type UserRole } from '@/lib/auth/permissions';
import { revalidatePath } from 'next/cache';

const TENANT_ID = 'STX-001';

async function requireOwner() {
  const profile = await getCurrentUserProfile();
  if (!profile || !permissions.canEditMasterData(profile.role)) {
    throw new Error('Unauthorized: Hanya owner yang dapat mengelola user.');
  }
  return profile;
}

export async function getUsers() {
  const admin = createAdminClient();
  
  // 1. Ambil semua profile
  const { data: profiles, error: profileError } = await admin
    .from('user_profile')
    .select('*')
    .eq('tenant_id', TENANT_ID)
    .order('created_at', { ascending: false });

  if (profileError) throw new Error(profileError.message);

  // 2. Ambil data email dari auth (menggunakan admin client)
  const { data: authData, error: authError } = await admin.auth.admin.listUsers();

  if (authError) throw new Error(authError.message);
  const users = authData?.users ?? [];

  // 3. Gabungkan data
  const userMap = new Map(users.map(u => [u.id, u.email]));
  
  return profiles.map(p => ({
    ...p,
    email: userMap.get(p.id) || 'N/A'
  }));
}

export async function updateUserRole(userId: string, newRole: UserRole) {
  const currentUser = await requireOwner();
  
  if (currentUser.id === userId) {
    throw new Error('Tidak dapat mengubah role diri sendiri.');
  }

  const admin = createAdminClient();

  // Ambil data user lama untuk audit log
  const { data: oldProfile } = await admin
    .from('user_profile')
    .select('nama, role')
    .eq('id', userId)
    .single();

  const { error } = await admin
    .from('user_profile')
    .update({ role: newRole })
    .eq('id', userId)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);

  // Catat Audit Log
  await admin.from('audit_log').insert({
    user_id: currentUser.id,
    modul: 'user-management',
    aksi: 'Update Role',
    target: userId,
    metadata: {
      user_target: oldProfile?.nama || userId,
      old_role: oldProfile?.role,
      new_role: newRole
    },
    tenant_id: TENANT_ID
  });

  revalidatePath('/app/master/users');
  return { success: true };
}

export async function toggleUserAktif(userId: string) {
  const currentUser = await requireOwner();

  if (currentUser.id === userId) {
    throw new Error('Tidak dapat menonaktifkan diri sendiri.');
  }

  const admin = createAdminClient();

  // Ambil status saat ini
  const { data: profile, error: getError } = await admin
    .from('user_profile')
    .select('nama, aktif')
    .eq('id', userId)
    .single();

  if (getError || !profile) throw new Error('User tidak ditemukan.');

  const newStatus = !profile.aktif;

  const { error } = await admin
    .from('user_profile')
    .update({ aktif: newStatus })
    .eq('id', userId)
    .eq('tenant_id', TENANT_ID);

  if (error) throw new Error(error.message);

  // Catat Audit Log
  await admin.from('audit_log').insert({
    user_id: currentUser.id,
    modul: 'user-management',
    aksi: newStatus ? 'Aktifkan User' : 'Nonaktifkan User',
    target: userId,
    metadata: {
      user_target: profile.nama,
      status: newStatus ? 'aktif' : 'nonaktif'
    },
    tenant_id: TENANT_ID
  });

  revalidatePath('/app/master/users');
  return { success: true };
}

export async function createUser(input: {
  email: string;
  password: string;
  nama: string;
  role: UserRole;
}): Promise<{ success: boolean; error?: string }> {
  try {
    await requireOwner();
  } catch {
    return { success: false, error: 'Unauthorized: Hanya owner yang dapat mengelola user.' };
  }

  const admin = createAdminClient();

  // 1. Buat auth user via Supabase Admin
  const { data: newUser, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: {
      nama: input.nama,
      role: input.role,
    },
  });

  if (createError) return { success: false, error: createError.message };
  if (!newUser.user) return { success: false, error: 'Gagal membuat user.' };

  // 2. Upsert ke user_profile (jaga-jaga jika trigger belum jalan)
  const { error: profileError } = await admin
    .from('user_profile')
    .upsert({
      id: newUser.user.id,
      nama: input.nama,
      role:      input.role,
      tenant_id: TENANT_ID,
    });

  if (profileError) return { success: false, error: profileError.message };

  revalidatePath('/app/master/users');
  return { success: true };
}

export async function resetUserPassword(userId: string, newPassword: string): Promise<{ success: boolean; error?: string }> {
  let currentUser;
  try {
    currentUser = await requireOwner();
  } catch {
    return { success: false, error: 'Unauthorized: Hanya owner yang dapat mengelola user.' };
  }

  if (newPassword.length < 6) {
    return { success: false, error: 'Password minimal 6 karakter.' };
  }

  const admin = createAdminClient();

  const { data: profile } = await admin
    .from('user_profile')
    .select('nama')
    .eq('id', userId)
    .single();

  const { error } = await admin.auth.admin.updateUserById(userId, { password: newPassword });
  if (error) return { success: false, error: error.message };

  // Catat Audit Log — tidak menyimpan password baru itu sendiri
  await admin.from('audit_log').insert({
    user_id: currentUser.id,
    modul: 'user-management',
    aksi: 'Reset Password',
    target: userId,
    metadata: { user_target: profile?.nama || userId },
    tenant_id: TENANT_ID,
  });

  revalidatePath('/app/master/users');
  return { success: true };
}

export async function deleteUser(userId: string) {
  await requireOwner();

  const admin = createAdminClient();

  // 1. Hapus dari auth
  const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
  if (deleteError) return { success: false, error: deleteError.message };

  // 2. Hapus dari user_profile (cascade seharusnya sudah handle, tapi jaga-jaga)
  await admin.from('user_profile').delete().eq('id', userId);

  revalidatePath('/app/master/users');
  return { success: true };
}
