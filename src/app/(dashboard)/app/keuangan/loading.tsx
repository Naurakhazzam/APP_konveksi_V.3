export default function KeuanganLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-[#2A2D31] rounded-lg" />
        <div className="flex gap-2">
          <div className="h-9 w-28 bg-[#2A2D31] rounded-lg" />
          <div className="h-9 w-28 bg-[#2A2D31] rounded-lg" />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 h-28" />
        ))}
      </div>

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 space-y-4">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-10 bg-[#2A2D31] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
