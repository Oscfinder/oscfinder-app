import { InputHTMLAttributes, forwardRef } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({ label, className, id, ...props }, ref) => {
  const inputId = id ?? label.toLowerCase().replace(/\s+/g, '-');
  return (
    <div className="relative w-full">
      <input
        ref={ref}
        id={inputId}
        placeholder=" "
        className={cn(
          'peer block w-full h-[48px] rounded-md border border-neutral-400 bg-white py-2 px-3 text-sm text-neutral-900 focus:border-[#006285] focus:outline-none focus:ring-1 focus:ring-[#006285] disabled:opacity-50',
          className
        )}
        {...props}
      />
      <label
        htmlFor={inputId}
        className="absolute left-3 text-neutral-400 text-sm transition-all duration-200
          top-3.5
          peer-focus:-top-2.5 peer-focus:text-xs peer-focus:text-[#006285] peer-focus:bg-white peer-focus:px-1
          peer-[:not(:placeholder-shown)]:-top-2.5 peer-[:not(:placeholder-shown)]:text-xs peer-[:not(:placeholder-shown)]:text-[#006285] peer-[:not(:placeholder-shown)]:bg-white peer-[:not(:placeholder-shown)]:px-1"
      >
        {label}
      </label>
    </div>
  );
});
Input.displayName = 'Input';
export { Input };
