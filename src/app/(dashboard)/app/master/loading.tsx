export default function MasterLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-[#2A2D31] rounded-lg" />
        <div className="h-9 w-32 bg-[#2A2D31] rounded-lg" />
      </div>

      {/* Table skeleton */}
      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl overflow-hidden">
        {/* Table header */}
        <div className="grid grid-cols-4 gap-4 px-6 py-3 border-b border-[#2A2D31]">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-4 bg-[#2A2D31] rounded" />
          ))}
        </div>
        {/* Table rows */}
        {[...Array(8)].map((_, i) => (
          <div key={i} className="grid grid-cols-4 gap-4 px-6 py-4 border-b border-[#2A2D31]/50">
            {[...Array(4)].map((_, j) => (
              <div key={j} className="h-4 bg-[#2A2D31]/60 rounded" style={{ width: `${60 + Math.random() * 40}%` }} />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
