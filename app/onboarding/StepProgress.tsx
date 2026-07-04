'use client';

export function StepProgress({ current }: { current: number }) {
  const steps = [
    { n: 1, label: 'Welcome'   },
    { n: 2, label: 'Industry'  },
    { n: 3, label: 'Location'  },
    { n: 4, label: 'First Run' },
  ];

  return (
    <div className="flex items-center gap-0 mb-2">
      {steps.map((s, i) => (
        <div key={s.n} className="flex items-center flex-1">
          <div className="flex flex-col items-center flex-1">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold transition-colors ${
              s.n < current    ? 'bg-[#00C48C] text-white'
              : s.n === current ? 'bg-[#0099CC] text-white'
              : 'bg-[#E5E7EB] text-[#888888]'
            }`}>
              {s.n < current ? '✓' : s.n}
            </div>
            <span className={`text-[10px] mt-1 font-medium ${s.n === current ? 'text-[#0099CC]' : 'text-[#888888]'}`}>
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className={`h-0.5 flex-1 mx-1 mb-4 transition-colors ${s.n < current ? 'bg-[#00C48C]' : 'bg-[#E5E7EB]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}
