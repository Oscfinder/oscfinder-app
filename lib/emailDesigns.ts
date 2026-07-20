// The 7 selectable email layouts ("designs") a client can wrap their outreach
// content in. A design is purely the HTML shell — subject/body text always
// comes from the chosen template (lib/seedTemplates.ts) or a hand-typed
// message; any content can go inside any design. Kept brand-neutral (no
// OsCFinder branding) since these are the client's own outreach emails, sent
// under their own display name/reply-to — see lib/emailHtml.ts.
//
// All designs are table-based, inline-CSS-only HTML (no <style> blocks, no
// flexbox/grid) for email client compatibility, fluid up to 600px, and end
// with the same unsubscribe line.

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const TEXT = '#1A3A5C';
const HEADING = '#0A1628';
const MUTED = '#9CA3AF';
const BORDER = '#E5E7EB';
const PAGE_BG = '#F3F4F6';
const ACCENT = '#2F4858';       // neutral slate — header bars / stripes
const ACCENT_SOFT = '#EEF2F6';  // neutral soft tint — two-tone top band / cards

export interface EmailDesign {
  id: string;
  name: string;
  description: string;
  thumbnail: string; // inline SVG markup for the selector UI
  render: (bodyHtml: string, senderName: string, replyTo: string) => string;
}

// ── shared helpers ──────────────────────────────────────────────────

function shell(inner: string): string {
  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background-color:${PAGE_BG};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${PAGE_BG};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
            ${inner}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function unsubscribeRow(replyTo: string, bg = '#ffffff'): string {
  return `<tr><td style="padding:0 36px 32px 36px;background-color:${bg};font-family:${FONT};">
    <hr style="border:none;border-top:1px solid ${BORDER};margin:0 0 16px 0;">
    <p style="font-size:11px;color:${MUTED};margin:0;line-height:1.5;">
      If you'd rather not receive these emails, reply with "unsubscribe" to
      <a href="mailto:${replyTo}" style="color:${MUTED};">${replyTo}</a>.
    </p>
  </td></tr>`;
}

// Pulls the individual <p>...</p> blocks out of the already-built bodyHtml
// (see lib/emailHtml.ts) so designs that need per-paragraph layout (cards,
// a two-tone split, a bold first line) can lay them out individually. Falls
// back to treating the whole string as one block if no <p> tags are found.
function extractParagraphs(bodyHtml: string): string[] {
  const matches = [...bodyHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
  return matches.length ? matches.map(m => m[1]) : [bodyHtml];
}

function paragraphHtml(inner: string, style = `margin:0 0 16px 0;`): string {
  return `<p style="${style}">${inner}</p>`;
}

const BODY_TEXT_STYLE = `font-size:14px;line-height:1.7;color:${TEXT};font-family:${FONT};`;

// ── Design 1: Clean Minimal (default) ───────────────────────────────

function renderCleanMinimal(bodyHtml: string, _senderName: string, replyTo: string): string {
  return shell(`
    <tr>
      <td style="background-color:#ffffff;padding:36px 36px 0 36px;">
        <div style="${BODY_TEXT_STYLE}">${bodyHtml}</div>
      </td>
    </tr>
    ${unsubscribeRow(replyTo)}
  `);
}

// ── Design 2: Professional Header ───────────────────────────────────

function renderProfessionalHeader(bodyHtml: string, senderName: string, replyTo: string): string {
  return shell(`
    <tr>
      <td style="background-color:${ACCENT};height:60px;padding:0 36px;" valign="middle">
        <p style="margin:0;font-size:16px;font-weight:700;color:#ffffff;line-height:60px;font-family:${FONT};">
          ${senderName || 'Sender'}
        </p>
      </td>
    </tr>
    <tr>
      <td style="background-color:#ffffff;padding:32px 36px 0 36px;">
        <div style="${BODY_TEXT_STYLE}">${bodyHtml}</div>
      </td>
    </tr>
    ${unsubscribeRow(replyTo)}
  `);
}

// ── Design 3: Accent Sidebar ─────────────────────────────────────────

function renderAccentSidebar(bodyHtml: string, _senderName: string, replyTo: string): string {
  return shell(`
    <tr>
      <td style="background-color:#ffffff;border-left:5px solid ${ACCENT};padding:32px 36px 0 31px;">
        <div style="${BODY_TEXT_STYLE}">${bodyHtml}</div>
      </td>
    </tr>
    <tr>
      <td style="border-left:5px solid ${ACCENT};padding:0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${unsubscribeRow(replyTo)}
        </table>
      </td>
    </tr>
  `);
}

// ── Design 4: Feature Highlight ──────────────────────────────────────

function renderFeatureHighlight(bodyHtml: string, _senderName: string, replyTo: string): string {
  const paragraphs = extractParagraphs(bodyHtml);
  const intro = paragraphs[0] ?? '';
  const rest  = paragraphs.slice(1);
  const cta   = rest.length > 1 ? rest[rest.length - 1] : (rest.length === 1 ? rest[0] : null);
  const cards = rest.length > 1 ? rest.slice(0, -1) : [];

  const cardsHtml = cards.map(c => `
    <tr>
      <td style="padding:0 0 12px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:${ACCENT_SOFT};border:1px solid ${BORDER};border-radius:8px;">
          <tr><td style="padding:14px 18px;font-size:14px;line-height:1.6;color:${TEXT};font-family:${FONT};">${c}</td></tr>
        </table>
      </td>
    </tr>`).join('');

  return shell(`
    <tr>
      <td style="background-color:#ffffff;padding:36px 36px 8px 36px;">
        <div style="${BODY_TEXT_STYLE}">${paragraphHtml(intro)}</div>
      </td>
    </tr>
    ${cardsHtml ? `<tr><td style="background-color:#ffffff;padding:8px 36px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${cardsHtml}</table></td></tr>` : ''}
    ${cta ? `<tr><td style="background-color:#ffffff;padding:8px 36px 0 36px;"><p style="margin:0;font-size:15px;font-weight:700;color:${HEADING};line-height:1.6;font-family:${FONT};">${cta}</p></td></tr>` : ''}
    <tr><td style="background-color:#ffffff;padding-top:20px;"></td></tr>
    ${unsubscribeRow(replyTo)}
  `);
}

// ── Design 5: Bold Headline ──────────────────────────────────────────

function renderBoldHeadline(bodyHtml: string, _senderName: string, replyTo: string): string {
  const paragraphs = extractParagraphs(bodyHtml);
  const headline = paragraphs[0] ?? '';
  const remainder = paragraphs.slice(1).map(p => paragraphHtml(p)).join('');

  return shell(`
    <tr>
      <td style="background-color:#ffffff;padding:36px 36px 0 36px;">
        <p style="margin:0 0 20px 0;font-size:24px;font-weight:800;color:${HEADING};line-height:1.3;font-family:${FONT};">
          ${headline}
        </p>
        ${remainder ? `<div style="${BODY_TEXT_STYLE}">${remainder}</div>` : ''}
      </td>
    </tr>
    ${unsubscribeRow(replyTo)}
  `);
}

// ── Design 6: Boxed Card ──────────────────────────────────────────────

function renderBoxedCard(bodyHtml: string, _senderName: string, replyTo: string): string {
  return shell(`
    <tr>
      <td style="padding:4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border:1px solid ${BORDER};border-radius:12px;box-shadow:0 2px 8px rgba(10,22,40,0.06);">
          <tr>
            <td style="padding:36px 36px 0 36px;border-radius:12px 12px 0 0;">
              <div style="${BODY_TEXT_STYLE}">${bodyHtml}</div>
            </td>
          </tr>
          ${unsubscribeRow(replyTo)}
        </table>
      </td>
    </tr>
  `);
}

// ── Design 7: Two-Tone ──────────────────────────────────────────────

function renderTwoTone(bodyHtml: string, _senderName: string, replyTo: string): string {
  const paragraphs = extractParagraphs(bodyHtml);
  const top = paragraphs[0] ?? '';
  const bottom = paragraphs.slice(1).map(p => paragraphHtml(p)).join('');

  return shell(`
    <tr>
      <td style="background-color:${ACCENT_SOFT};padding:36px 36px ${bottom ? '28px' : '36px'} 36px;">
        <p style="margin:0;font-size:15px;line-height:1.7;color:${TEXT};font-family:${FONT};">${top}</p>
      </td>
    </tr>
    ${bottom ? `
    <tr>
      <td style="background-color:#ffffff;padding:28px 36px 0 36px;">
        <div style="${BODY_TEXT_STYLE}">${bottom}</div>
      </td>
    </tr>` : ''}
    ${unsubscribeRow(replyTo)}
  `);
}

// ── Thumbnails (structural skeleton only — not a real render) ────────

const THUMB_CLEAN = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="160" fill="#ffffff" stroke="#E5E7EB"/>
  <rect x="14" y="22" width="92" height="6" rx="2" fill="#CBD5E1"/>
  <rect x="14" y="36" width="76" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="50" width="88" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="64" width="56" height="6" rx="2" fill="#E2E8F0"/>
  <line x1="14" y1="132" x2="106" y2="132" stroke="#E5E7EB" stroke-width="1"/>
  <rect x="14" y="142" width="64" height="4" rx="2" fill="#E5E7EB"/>
</svg>`;

const THUMB_HEADER = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="160" fill="#ffffff" stroke="#E5E7EB"/>
  <rect x="0" y="0" width="120" height="24" fill="#2F4858"/>
  <rect x="14" y="9" width="40" height="6" rx="2" fill="#ffffff"/>
  <rect x="14" y="40" width="92" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="54" width="80" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="68" width="88" height="6" rx="2" fill="#E2E8F0"/>
  <line x1="14" y1="132" x2="106" y2="132" stroke="#E5E7EB" stroke-width="1"/>
  <rect x="14" y="142" width="64" height="4" rx="2" fill="#E5E7EB"/>
</svg>`;

const THUMB_SIDEBAR = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="160" fill="#ffffff" stroke="#E5E7EB"/>
  <rect x="0" y="0" width="5" height="160" fill="#2F4858"/>
  <rect x="16" y="22" width="90" height="6" rx="2" fill="#CBD5E1"/>
  <rect x="16" y="36" width="74" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="16" y="50" width="86" height="6" rx="2" fill="#E2E8F0"/>
  <line x1="16" y1="132" x2="106" y2="132" stroke="#E5E7EB" stroke-width="1"/>
  <rect x="16" y="142" width="64" height="4" rx="2" fill="#E5E7EB"/>
</svg>`;

const THUMB_FEATURE = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="160" fill="#ffffff" stroke="#E5E7EB"/>
  <rect x="14" y="18" width="92" height="6" rx="2" fill="#CBD5E1"/>
  <rect x="14" y="32" width="60" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="46" width="92" height="18" rx="4" fill="#EEF2F6" stroke="#E5E7EB"/>
  <rect x="14" y="70" width="92" height="18" rx="4" fill="#EEF2F6" stroke="#E5E7EB"/>
  <rect x="14" y="96" width="70" height="6" rx="2" fill="#0A1628"/>
  <line x1="14" y1="132" x2="106" y2="132" stroke="#E5E7EB" stroke-width="1"/>
  <rect x="14" y="142" width="64" height="4" rx="2" fill="#E5E7EB"/>
</svg>`;

const THUMB_HEADLINE = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="160" fill="#ffffff" stroke="#E5E7EB"/>
  <rect x="14" y="20" width="92" height="12" rx="2" fill="#0A1628"/>
  <rect x="14" y="42" width="80" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="56" width="88" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="70" width="60" height="6" rx="2" fill="#E2E8F0"/>
  <line x1="14" y1="132" x2="106" y2="132" stroke="#E5E7EB" stroke-width="1"/>
  <rect x="14" y="142" width="64" height="4" rx="2" fill="#E5E7EB"/>
</svg>`;

const THUMB_BOXED = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="160" fill="#ffffff"/>
  <rect x="6" y="6" width="108" height="148" rx="10" fill="#ffffff" stroke="#CBD5E1" stroke-width="1.5"/>
  <rect x="18" y="24" width="84" height="6" rx="2" fill="#CBD5E1"/>
  <rect x="18" y="38" width="68" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="18" y="52" width="80" height="6" rx="2" fill="#E2E8F0"/>
  <line x1="18" y1="122" x2="102" y2="122" stroke="#E5E7EB" stroke-width="1"/>
  <rect x="18" y="132" width="60" height="4" rx="2" fill="#E5E7EB"/>
</svg>`;

const THUMB_TWOTONE = `<svg viewBox="0 0 120 160" xmlns="http://www.w3.org/2000/svg">
  <rect width="120" height="160" fill="#ffffff" stroke="#E5E7EB"/>
  <rect x="0" y="0" width="120" height="60" fill="#EEF2F6"/>
  <rect x="14" y="20" width="90" height="6" rx="2" fill="#94A3B8"/>
  <rect x="14" y="34" width="70" height="6" rx="2" fill="#CBD5E1"/>
  <rect x="14" y="76" width="88" height="6" rx="2" fill="#E2E8F0"/>
  <rect x="14" y="90" width="76" height="6" rx="2" fill="#E2E8F0"/>
  <line x1="14" y1="132" x2="106" y2="132" stroke="#E5E7EB" stroke-width="1"/>
  <rect x="14" y="142" width="64" height="4" rx="2" fill="#E5E7EB"/>
</svg>`;

// ── Registry ──────────────────────────────────────────────────────────

export const EMAIL_DESIGNS: EmailDesign[] = [
  {
    id:          'clean-minimal',
    name:        'Clean Minimal',
    description: 'Cold outreach — looks like a regular email, not a marketing blast.',
    thumbnail:   THUMB_CLEAN,
    render:      renderCleanMinimal,
  },
  {
    id:          'professional-header',
    name:        'Professional Header',
    description: 'Introductions and partnership proposals — adds a professional touch.',
    thumbnail:   THUMB_HEADER,
    render:      renderProfessionalHeader,
  },
  {
    id:          'accent-sidebar',
    name:        'Accent Sidebar',
    description: 'Follow-ups and check-ins — subtly distinctive without looking designed.',
    thumbnail:   THUMB_SIDEBAR,
    render:      renderAccentSidebar,
  },
  {
    id:          'feature-highlight',
    name:        'Feature Highlight',
    description: 'Service or product pitches — when you have multiple points to make.',
    thumbnail:   THUMB_FEATURE,
    render:      renderFeatureHighlight,
  },
  {
    id:          'bold-headline',
    name:        'Bold Headline',
    description: 'Special offers, announcements, or promotions — grabs attention immediately.',
    thumbnail:   THUMB_HEADLINE,
    render:      renderBoldHeadline,
  },
  {
    id:          'boxed-card',
    name:        'Boxed Card',
    description: 'Company introductions — polished and contained.',
    thumbnail:   THUMB_BOXED,
    render:      renderBoxedCard,
  },
  {
    id:          'two-tone',
    name:        'Two-Tone',
    description: "Longer emails — breaks up the content so it doesn't feel like a wall of text.",
    thumbnail:   THUMB_TWOTONE,
    render:      renderTwoTone,
  },
];

export const DEFAULT_DESIGN_ID = 'clean-minimal';

export function getEmailDesign(designId: string | null | undefined): EmailDesign {
  return EMAIL_DESIGNS.find(d => d.id === designId) ?? EMAIL_DESIGNS.find(d => d.id === DEFAULT_DESIGN_ID)!;
}
