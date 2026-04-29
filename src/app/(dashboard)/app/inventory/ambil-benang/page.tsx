import React from 'react';
import { getBenangItems, getRiwayatAmbilBenang, getOverheadBenang } from '@/lib/actions/inventory/benang.actions';
import { AmbilBenangClient } from './AmbilBenangClient';

export default async function AmbilBenangPage() {
  const [items, riwayat, overhead] = await Promise.all([
    getBenangItems(),
    getRiwayatAmbilBenang(50, 0),
    getOverheadBenang(),
  ]);

  return (
    <AmbilBenangClient
      items={items}
      initialRiwayat={riwayat}
      initialOverhead={overhead}
    />
  );
}
