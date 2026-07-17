import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount } from '@/lib/auth';
import { checkLimit, logUsage } from '@/lib/usage';
import * as XLSX from 'xlsx';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const allowed = await checkLimit(user.company_id!, 'export');
  if (!allowed)
    return NextResponse.json({ error: 'Export limit reached for this month' }, { status: 403 });

  const sp       = req.nextUrl.searchParams;
  const format   = sp.get('format') ?? 'xlsx';
  const category = sp.get('category') ?? '';
  const state    = sp.get('state')    ?? '';
  const status   = sp.get('status')   ?? '';
  const jobId    = sp.get('jobId')    ?? '';
  const idsParam = sp.get('ids')      ?? '';
  const ids      = idsParam ? idsParam.split(',').filter(Boolean) : [];

  let query = supabaseAdmin.from('leads').select('*');

  if (user.role !== 'admin') {
    query = query.eq('company_id', user.company_id);
  }

  // An explicit id list (from the Leads table's "Export Selected") takes precedence
  // over the filter dropdowns — exports exactly those rows, nothing else.
  if (ids.length > 0) {
    query = query.in('id', ids);
  } else {
    if (jobId)    query = query.eq('job_id',  jobId);
    if (category) query = query.eq('category', category);
    if (state)    query = query.eq('state',    state);
    if (status)   query = query.eq('status',   status);
  }

  const { data, error: dbError } = await query;
  if (dbError) return NextResponse.json({ error: dbError.message }, { status: 500 });

  const rows = (data ?? []).map(l => ({
    'Company Name': l.name,
    'Address':      l.address,
    'State':        l.state ?? '',
    'Local Govt':   l.local_govt ?? '',
    'Category':     l.category,
    'Website':      l.website,
    'Emails':       l.emails?.join(', ')  ?? '',
    'Phones':       l.phones?.join(', ')  ?? '',
    'LinkedIn':     l.linkedin_url ?? '',
    'Status':       l.status,
    'Lead Score':   l.lead_score ?? 0,
  }));

  await logUsage(user.company_id!, 'export', 1, {
    format,
    ...(ids.length > 0 ? { selected_ids: ids.length } : { category, state, status }),
    lead_count: rows.length,
  });

  if (format === 'csv') {
    const ws  = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': 'attachment; filename="leads-export.csv"',
      },
    });
  }

  const ws = XLSX.utils.json_to_sheet(rows);
  ws['!cols'] = [30, 40, 20, 20, 20, 30, 40, 20, 35, 15, 10].map(wch => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Leads');
  const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new NextResponse(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="leads-export.xlsx"',
    },
  });
}
