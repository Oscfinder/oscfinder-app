type StatCardProps = { title: string; value: number | string };

export function StatCard({ title, value }: StatCardProps) {
  return (
    <div className="rounded-xl border border-l-4 border-l-[#006285] bg-white p-5 shadow-sm">
      <p className="text-sm text-gray-500">{title}</p>
      <p className="text-2xl font-semibold text-gray-800 mt-1">{value}</p>
    </div>
  );
}
