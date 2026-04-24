'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[AppError]', error);
  }, [error]);

  const router = useRouter();

  return (
    <div className="flex items-center justify-center h-full min-h-[400px]">
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-xl p-8 max-w-md w-full text-center space-y-4">
        <div className="text-red-400 text-4xl">⚠</div>
        <h2 className="text-[#e8eaed] font-semibold text-lg">Terjadi Kesalahan</h2>
        <p className="text-[#9aa0a6] text-sm">
          Halaman ini mengalami error saat memuat data.
          {error?.digest && (
            <span className="block mt-1 text-xs font-mono text-[#9aa0a6]">
              Kode: {error.digest}
            </span>
          )}
        </p>
        <div className="flex gap-3 justify-center pt-2">
          <button
            onClick={reset}
            className="px-4 py-2 text-sm font-medium bg-[#e5c17b] text-[#0D0E10] rounded-lg hover:bg-[#d4b06a] transition-colors"
          >
            Coba Lagi
          </button>
          <button
            onClick={() => router.push('/app/dashboard')}
            className="px-4 py-2 text-sm font-medium bg-[#2A2D31] text-[#e8eaed] rounded-lg hover:bg-[#3A3D41] transition-colors"
          >
            Ke Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
