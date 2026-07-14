import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';

export function SendLimitConsentModal({
  senderEmail,
  dailyLimit,
  sentToday,
  confirming,
  onConfirm,
  onCancel,
}: {
  senderEmail: string;
  dailyLimit:  number;
  sentToday:   number;
  confirming:  boolean;
  onConfirm:   () => void;
  onCancel:    () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[480px]">
        <div className="px-6 py-5 flex flex-col items-center text-center gap-3">
          <div className="w-12 h-12 rounded-full bg-[#fff3e0] border border-[#ffe0b2] flex items-center justify-center">
            <AlertTriangle size={20} className="text-[#e67e22]" />
          </div>
          <h2 className="text-[16px] font-bold text-[#0A1628]">Daily sending limit reached</h2>
          <p className="text-[13px] text-[#1A3A5C] leading-relaxed">
            You've reached {dailyLimit} emails today from {senderEmail}. Sending more increases
            the risk that Gmail, Outlook and other providers flag your domain as a bulk sender —
            once flagged, your emails (including future ones) may be delivered to spam
            permanently. We recommend staying at {dailyLimit}/day per mailbox.
          </p>
          <p className="text-[11.5px] text-[#888888]">Sent today: {sentToday}</p>
        </div>
        <div className="px-6 py-4 border-t border-[#E5E7EB] flex gap-3">
          <Button variant="outline" className="flex-1" onClick={onCancel} disabled={confirming}>
            Stop here
          </Button>
          <Button
            className="flex-1 bg-red-500 hover:bg-red-600"
            isLoading={confirming}
            onClick={onConfirm}
          >
            {confirming ? 'Confirming...' : 'Proceed at my own risk'}
          </Button>
        </div>
      </div>
    </div>
  );
}
