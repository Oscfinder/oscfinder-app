import { Building2 } from 'lucide-react';

export function Logo({ collapsed }: { collapsed?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-[#006285] shrink-0">
        <Building2 size={16} color="white" />
      </div>
      {!collapsed && (
        <span className="text-[17px] font-bold tracking-tight leading-none">
          <span className="text-[#006285]">company</span>
          <span className="text-gray-800">Finder</span>
        </span>
      )}
    </div>
  );
}
