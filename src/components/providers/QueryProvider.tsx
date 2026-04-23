'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';

export default function QueryProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  // Buat QueryClient di dalam useState agar setiap request
  // mendapat instance baru (penting untuk SSR/Next.js App Router)
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000, // 60 detik
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
