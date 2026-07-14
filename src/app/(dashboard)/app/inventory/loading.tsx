export default function InventoryLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="flex items-center justify-between">
        <div className="h-8 w-40 bg-[#2A2D31] rounded-lg" />
        <div className="h-9 w-32 bg-[#2A2D31] rounded-lg" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <div key={i} className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 h-24" />
        ))}
      </div>

      <div className="bg-[#1A1D1F] border border-[#2A2D31] rounded-2xl p-6 space-y-4">
        <div className="h-5 w-32 bg-[#2A2D31] rounded" />
        {[...Array(7)].map((_, i) => (
          <div key={i} className="h-10 bg-[#2A2D31] rounded-lg" />
        ))}
      </div>
    </div>
  );
}
