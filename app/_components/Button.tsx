'use client';
import { cn } from '@/lib/utils';
import { ButtonHTMLAttributes, forwardRef } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
  isLoading?: boolean;
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', isLoading, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium h-[48px] px-4 transition-colors disabled:opacity-50 disabled:pointer-events-none';
    const variants = {
      default: 'bg-[#006285] text-white hover:bg-[#004f6b]',
      outline: 'border border-[#006285] text-[#006285] bg-white hover:bg-[#006285]/10',
      ghost: 'text-[#006285] hover:bg-[#006285]/10',
    };
    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], className)}
        disabled={isLoading || disabled}
        {...props}
      >
        {isLoading ? <span className="spinner-mini" /> : children}
      </button>
    );
  }
);
Button.displayName = 'Button';
export { Button };
