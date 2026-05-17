import { Lead } from '@/types';
import { cn } from '@/lib/utils';

export function LeadsTable({ leads }: { leads: Lead[] }) {
  if (!leads.length) {
    return (
      <div className="rounded-xl border bg-white p-10 text-center text-sm text-gray-400">
        No leads found yet. Run a search to get started.
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm text-left">
          <thead className="bg-[#006285] text-white text-xs uppercase">
            <tr>
              {['Company', 'Address', 'Website', 'Emails', 'Phones', 'Status'].map((h) => (
                <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {leads.map((lead) => (
              <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3 font-medium text-gray-800 whitespace-nowrap">{lead.name}</td>
                <td className="px-4 py-3 text-gray-500 max-w-[200px] truncate">{lead.address}</td>
                <td className="px-4 py-3">
                  {lead.website ? (
                    <a href={lead.website} target="_blank" rel="noreferrer" className="text-[#006285] underline truncate block max-w-[150px]">
                      {lead.website.replace(/^https?:\/\//, '')}
                    </a>
                  ) : '—'}
                </td>
                <td className="px-4 py-3 text-gray-600 max-w-[180px]">
                  {lead.emails?.length ? lead.emails.join(', ') : '—'}
                </td>
                <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                  {lead.phones?.length ? lead.phones.join(', ') : '—'}
                </td>
                <td className="px-4 py-3">
                  <span className={cn(
                    'px-2 py-0.5 rounded-full text-xs font-semibold',
                    lead.status === 'new'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-gray-100 text-gray-500'
                  )}>
                    {lead.status === 'new' ? 'New' : 'Existing'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
