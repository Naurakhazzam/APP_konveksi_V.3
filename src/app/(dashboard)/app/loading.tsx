export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="h-8 w-48 bg-[#2A2D31] rounded-lg" />

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 h-32" />
        ))}
      </div>

      {/* Content skeleton */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 space-y-4">
        <div className="h-5 w-32 bg-[#2A2D31] rounded" />
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-10 bg-[#2A2D31] rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
