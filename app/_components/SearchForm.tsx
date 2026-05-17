'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Input } from './Input';
import { Button } from './Button';
import { SearchFormValues } from '@/types';

const schema = z.object({
  category: z.string().min(2, 'Enter a company category'),
  location: z.string().min(2, 'Enter a location'),
});

interface SearchFormProps {
  onSubmit: (values: SearchFormValues) => void;
  isLoading: boolean;
}

export function SearchForm({ onSubmit, isLoading }: SearchFormProps) {
  const { register, handleSubmit, formState: { errors } } = useForm<SearchFormValues>({
    resolver: zodResolver(schema),
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div>
        <Input label="Company Category" {...register('category')} placeholder=" " />
        {errors.category && <p className="text-xs text-red-500 mt-1">{errors.category.message}</p>}
      </div>
      <div>
        <Input label="Location" {...register('location')} placeholder=" " />
        {errors.location && <p className="text-xs text-red-500 mt-1">{errors.location.message}</p>}
      </div>
      <Button type="submit" isLoading={isLoading} className="w-full">
        {isLoading ? 'Searching...' : 'Start Scrape'}
      </Button>
    </form>
  );
}
