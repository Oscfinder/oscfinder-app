'use client';
import { X, CheckCircle, Globe, Mail, Phone } from 'lucide-react';
import { Lead } from '@/types';
import { Button } from './Button';
import { cn } from '@/lib/utils';

interface ScrapedResultsModalProps {
  results: Lead[];
  isAdding: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function ScrapedResultsModal({ results, isAdding, onConfirm, onClose }: ScrapedResultsModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-gray-800">Scraped Companies</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              {results.length} new {results.length === 1 ? 'company' : 'companies'} found — review before adding to database
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <X size={18} className="text-gray-500" />
          </button>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm text-left">
            <thead className="bg-[#006285] text-white text-xs uppercase sticky top-0">
              <tr>
                {['#', 'Company', 'Address', 'Website', 'Emails', 'Phones'].map((h) => (
                  <th key={h} className="px-4 py-3 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {results.map((lead, i) => (
                <tr key={lead.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 text-gray-400 text-xs">{i + 1}</td>
                  <td className="px-4 py-3 font-semibold text-gray-800 whitespace-nowrap">{lead.name}</td>
                  <td className="px-4 py-3 text-gray-500 max-w-[180px] truncate">{lead.address}</td>
                  <td className="px-4 py-3">
                    {lead.website ? (
                      <a
                        href={lead.website}
                        target="_blank"
                        rel="noreferrer"
                        className="flex items-center gap-1 text-[#006285] hover:underline truncate max-w-[140px]"
                      >
                        <Globe size={12} />
                        {lead.website.replace(/^https?:\/\//, '')}
                      </a>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {lead.emails?.length ? (
                      <div className="flex items-center gap-1">
                        <Mail size={12} className="text-emerald-500 shrink-0" />
                        <span className="truncate max-w-[160px]">{lead.emails[0]}</span>
                        {lead.emails.length > 1 && (
                          <span className="text-xs text-gray-400">+{lead.emails.length - 1}</span>
                        )}
                      </div>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-gray-600 whitespace-nowrap">
                    {lead.phones?.length ? (
                      <div className="flex items-center gap-1">
                        <Phone size={12} className="text-amber-500 shrink-0" />
                        {lead.phones[0]}
                      </div>
                    ) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
          <p className="text-sm text-gray-500">
            Adding <span className="font-semibold text-gray-800">{results.length}</span> companies to your database
          </p>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} disabled={isAdding}>
              Cancel
            </Button>
            <Button
              onClick={onConfirm}
              isLoading={isAdding}
              className={cn('gap-2', !isAdding && 'bg-emerald-600 hover:bg-emerald-700')}
            >
              {!isAdding && <CheckCircle size={16} />}
              {isAdding ? 'Adding...' : `Add ${results.length} Companies`}
            </Button>
          </div>
        </div>

      </div>
    </div>
  );
}
