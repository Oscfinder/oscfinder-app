import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-server';
import { requireAuth, requireActiveAccount, getEffectiveCompanyId } from '@/lib/auth';
import { checkLimit, logUsage, planLimitExceededResponse } from '@/lib/usage';
import * as XLSX from 'xlsx';
import { LeadContact } from '@/types';

export async function GET(req: NextRequest) {
  const { user, error } = await requireAuth();
  if (error) return error;

  if (user.role !== 'admin') {
    const accountError = await requireActiveAccount(user.company_id!);
    if (accountError) return accountError;
  }

  const companyId = await getEffectiveCompanyId(user);
  if (!companyId)
    return NextResponse.json({ error: 'No company associated with this account' }, { status: 403 });

  const allowed = await checkLimit(companyId, 'export');
  if (!allowed)
    return planLimitExceededResponse(companyId, 'export');

  const sp       = req.nextUrl.searchParams;
  const format   = sp.get('format') ?? 'xlsx';
  const category = sp.get('category') ?? '';
  const state    = sp.get('state')    ?? '';
  const status   = sp.get('status')   ?? '';
  const jobId    = sp.get('jobId')    ?? '';
  const idsParam = sp.get('ids')      ?? '';
  const ids      = idsParam ? idsParam.split(',').filter(Boolean) : [];

  let query = supabaseAdmin.from('leads').select('*').eq('company_id', companyId);

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

  const leads = data ?? [];

  // One row per contact (company info repeated) — the more standard shape for
  // downstream data processing than cramming multiple contacts into one cell.
  // A lead with no contacts still gets exactly one row, with blank contact
  // columns, so it isn't dropped from the export entirely.
  const contactsData: LeadContact[] = leads.length > 0
    ? ((await supabaseAdmin.from('lead_contacts').select('*').in('lead_id', leads.map(l => l.id))).data ?? [])
    : [];

  const contactsByLead = new Map<string, LeadContact[]>();
  for (const c of contactsData) {
    if (!contactsByLead.has(c.lead_id)) contactsByLead.set(c.lead_id, []);
    contactsByLead.get(c.lead_id)!.push(c);
  }

  const rows = leads.flatMap(l => {
    const companyFields = {
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
    };
    const contacts = contactsByLead.get(l.id) ?? [];
    if (contacts.length === 0) {
      return [{
        ...companyFields,
        'Contact Name': '', 'Contact Title': '', 'Contact Email': '',
        'Contact Phone': '', 'Contact LinkedIn': '',
      }];
    }
    return contacts.map(c => ({
      ...companyFields,
      'Contact Name':     c!.name,
      'Contact Title':    c!.title ?? '',
      'Contact Email':    c!.email ?? '',
      'Contact Phone':    c!.phone ?? '',
      'Contact LinkedIn': c!.linkedin_url ?? c!.linkedin_search_url ?? '',
    }));
  });

  await logUsage(companyId, 'export', 1, {
    format,
    ...(ids.length > 0 ? { selected_ids: ids.length } : { category, state, status }),
    lead_count: leads.length,
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
  ws['!cols'] = [30, 40, 20, 20, 20, 30, 40, 20, 35, 15, 10, 25, 25, 30, 20, 35].map(wch => ({ wch }));
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
