import React from 'react';

interface Props {
  status: 'menunggu' | 'sedang_proses' | 'selesai';
}

export default function StageStatusBadge({ status }: Props) {
  const configs = {
    menunggu: {
      text: 'Menunggu Scan',
      className: 'bg-gray-400/15 text-gray-400 border-gray-400/30',
    },
    sedang_proses: {
      text: 'Sedang Proses',
      className: 'bg-[#e5c17b]/15 text-[#e5c17b] border-[#e5c17b]/30',
    },
    selesai: {
      text: 'Selesai',
      className: 'bg-green-500/15 text-green-500 border-green-500/30',
    },
  };

  const config = configs[status];

  return (
    <span className={`px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider border rounded-full ${config.className}`}>
      {config.text}
    </span>
  );
}
