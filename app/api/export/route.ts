import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import * as XLSX from 'xlsx';

export async function GET(req: NextRequest) {
  const jobId = req.nextUrl.searchParams.get('jobId');
  if (!jobId) return NextResponse.json({ error: 'jobId required' }, { status: 400 });

  const { data, error } = await supabaseAdmin
    .from('leads')
    .select('*')
    .eq('job_id', jobId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []).map((l) => ({
    'Company Name': l.name,
    Address: l.address,
    Website: l.website,
    Emails: l.emails?.join(', ') ?? '',
    Phones: l.phones?.join(', ') ?? '',
    Status: l.status,
    Category: l.category,
    Location: l.location,
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [30, 40, 30, 40, 20, 15, 20, 20].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');

  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="leads-${jobId}.xlsx"`,
    },
  });
}
