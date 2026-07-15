import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';

export function formatCurrency(amount) {
  const num = Number(amount) || 0;
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    minimumFractionDigits: 2,
  }).format(num);
}

export function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatDateInput(dateStr) {
  if (!dateStr) return '';
  return dateStr.slice(0, 10);
}

export function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export function generateVoucherHTML(voucher, company, template) {
  const config = template?.layout_config ? JSON.parse(template.layout_config) : {};
  const showLogo = config.showLogo !== false && company.show_logo;
  const showAddress = config.showAddress !== false && company.show_address;
  const showBank = config.showBank !== false && company.show_bank_details;
  const showSignature = config.showSignature !== false && company.show_signature;

  return `
    <div style="font-family: 'Inter', system-ui, sans-serif; max-width: 800px; margin: 0 auto; padding: 30px;">
      ${showLogo && company.logo_url ? `
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="${company.logo_url}" alt="${company.name}" style="max-height: 60px;"/>
        </div>
      ` : ''}

      <div style="text-align: center; margin-bottom: 30px;">
        <h1 style="font-size: 18px; font-weight: 700; margin: 0 0 4px; letter-spacing: 1px; text-transform: uppercase;">
          ${company.name}
        </h1>
        ${showAddress && company.address ? `
          <p style="font-size: 11px; color: #555; margin: 2px 0;">${company.address}</p>
        ` : ''}
        ${company.show_phone && company.phone ? `
          <p style="font-size: 11px; color: #555; margin: 2px 0;">Tel: ${company.phone}</p>
        ` : ''}
        ${company.show_email && company.email ? `
          <p style="font-size: 11px; color: #555; margin: 2px 0;">Email: ${company.email}</p>
        ` : ''}
      </div>

      <hr style="border: none; border-top: 2px solid #222; margin: 0 0 20px;" />

      <div style="display: flex; justify-content: space-between; margin-bottom: 24px;">
        <div>
          <h2 style="font-size: 16px; font-weight: 600; margin: 0 0 8px;">PAYMENT VOUCHER</h2>
          <p style="font-size: 12px; color: #555; margin: 2px 0;">
            <strong>Voucher No:</strong> ${voucher.voucher_number}
          </p>
          <p style="font-size: 12px; color: #555; margin: 2px 0;">
            <strong>Date:</strong> ${voucher.date}
          </p>
        </div>
        ${company.show_tax_id && company.tax_id ? `
          <div style="text-align: right; font-size: 12px; color: #555;">
            <p style="margin: 2px 0;"><strong>Tax ID:</strong> ${company.tax_id}</p>
          </div>
        ` : ''}
      </div>

      <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; border: 1px solid #ddd;">Description</th>
            <th style="padding: 8px 12px; text-align: left; font-size: 11px; text-transform: uppercase; border: 1px solid #ddd;">Invoice Ref</th>
            <th style="padding: 8px 12px; text-align: right; font-size: 11px; text-transform: uppercase; border: 1px solid #ddd;">Amount (RM)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 10px 12px; border: 1px solid #ddd; font-size: 12px;">
              ${voucher.description || '-'}
              ${voucher.payee ? `<br/><span style="color: #666;">Payee: ${voucher.payee}</span>` : ''}
            </td>
            <td style="padding: 10px 12px; border: 1px solid #ddd; font-size: 12px;">${voucher.invoice_ref || '-'}</td>
            <td style="padding: 10px 12px; border: 1px solid #ddd; font-size: 12px; text-align: right; font-weight: 600;">
              ${Number(voucher.amount).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
            </td>
          </tr>
          <tr>
            <td colspan="2" style="padding: 10px 12px; border: 1px solid #ddd; text-align: right; font-weight: 600; font-size: 12px;">
              ${voucher.category ? `Category: ${voucher.category}` : ''}
              ${voucher.payment_method ? `&nbsp;&nbsp;|&nbsp;&nbsp; Payment: ${voucher.payment_method}` : ''}
            </td>
            <td style="padding: 10px 12px; border: 1px solid #ddd; text-align: right; font-weight: 700; font-size: 13px; background: #fafafa;">
              ${Number(voucher.amount).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
            </td>
          </tr>
        </tbody>
      </table>

      ${showBank ? `
        <div style="font-size: 11px; color: #555; margin-bottom: 20px; padding: 12px; background: #fafafa; border: 1px solid #eee;">
          <strong>Bank Details:</strong><br/>
          ${company.bank_name || '-'} &nbsp;|&nbsp; Account: ${company.bank_account || '-'}
        </div>
      ` : ''}

      <div style="font-size: 11px; color: #999; margin-bottom: 40px;">
        <em>${voucher.notes || ''}</em>
      </div>

      ${showSignature ? `
        <div style="display: flex; justify-content: space-between; margin-top: 50px; padding-top: 20px;">
          <div style="text-align: center; width: 40%;">
            <hr style="border: none; border-top: 1px solid #222; margin-bottom: 6px;"/>
            <p style="font-size: 11px; margin: 0;">
              ${company.signature_name || 'Prepared by'}<br/>
              <span style="color: #666;">${company.signature_title || ''}</span>
            </p>
          </div>
          <div style="text-align: center; width: 40%;">
            <hr style="border: none; border-top: 1px solid #222; margin-bottom: 6px;"/>
            <p style="font-size: 11px; margin: 0;">
              Approved by<br/>
              <span style="color: #666;">Authorised Signatory</span>
            </p>
          </div>
        </div>
      ` : ''}

      <div style="text-align: center; margin-top: 30px; font-size: 9px; color: #bbb;">
        This is a computer-generated payment voucher. No signature required.
      </div>
    </div>
  `;
}

// Minimal A5 landscape payment voucher — clean, no voucher number, no signatures
export function generateB5VoucherHTML({ payee, date, description, amount, paymentMethod, company }) {
  const safe = (v) => v || '';

  return `
    <div style="
      font-family: 'Inter', system-ui, -apple-system, sans-serif;
      width: 210mm; height: 148.5mm;
      padding: 12mm 16mm;
      box-sizing: border-box;
      page-break-after: always;
      background: #fff;
      margin: 0 auto 16px;
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
    ">
      <!-- Company Header -->
      <div style="text-align: center; margin-bottom: 14mm;">
        <div style="font-size: 20px; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 3px;">
          ${safe(company?.name)}
        </div>
        ${company?.tax_id ? `<div style="font-size: 13px; color: #555;">${safe(company.tax_id)}</div>` : ''}
      </div>

      <!-- Title -->
      <div style="
        text-align: center;
        font-size: 18px; font-weight: 700;
        letter-spacing: 4px;
        padding: 10px 0;
        border-top: 2px solid #222;
        border-bottom: 2px solid #222;
        margin-bottom: 14mm;
      ">PAYMENT VOUCHER</div>

      <!-- Pay To & Date -->
      <div style="margin-bottom: 12mm; font-size: 14px; line-height: 2;">
        <div>
          <span style="font-weight: 600;">Pay To : </span>
          <span>${safe(payee)}</span>
        </div>
        <div>
          <span style="font-weight: 600;">Date : </span>
          <span>${formatDateLong(date)}</span>
        </div>
      </div>

      <!-- Table -->
      <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
        <thead>
          <tr style="background: #f5f5f5;">
            <th style="padding: 10px 12px; text-align: left; border: 1px solid #ccc; width: 40%;">Particulars</th>
            <th style="padding: 10px 12px; text-align: left; border: 1px solid #ccc; width: 30%;">Method Of Payment</th>
            <th style="padding: 10px 12px; text-align: right; border: 1px solid #ccc; width: 30%;">Amount (RM)</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style="padding: 12px; border: 1px solid #ccc; vertical-align: top;">${safe(description)}</td>
            <td style="padding: 12px; border: 1px solid #ccc; vertical-align: top;">${safe(paymentMethod || 'Transfer')}</td>
            <td style="padding: 12px; border: 1px solid #ccc; text-align: right; font-weight: 600; vertical-align: top;">
              ${Number(amount || 0).toLocaleString('en-MY', { minimumFractionDigits: 2 })}
            </td>
          </tr>
        </tbody>
      </table>

    </div>
  `;
}

function formatDateLong(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-MY', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

// Open B5 landscape print preview overlay
export function printB5Vouchers(vouchersHtml) {
  // Remove existing overlay if any
  const existing = document.getElementById('voucher-print-overlay');
  if (existing) existing.remove();

  // Create overlay container
  const overlay = document.createElement('div');
  overlay.id = 'voucher-print-overlay';
  overlay.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;z-index:9999;'
    + 'overflow-y:auto;background:#f5f5f5;';

  // Voucher content wrapper
  const content = document.createElement('div');
  content.style.cssText = 'max-width:210mm;margin:20px auto;padding-bottom:80px;';
  content.innerHTML = vouchersHtml;

  // Sticky toolbar
  const toolbar = document.createElement('div');
  toolbar.className = 'no-print';
  toolbar.style.cssText = 'position:fixed;bottom:0;left:0;right:0;padding:14px 20px;'
    + 'background:#fff;border-top:1px solid #ddd;display:flex;justify-content:center;gap:12px;z-index:10001;'
    + 'box-shadow:0 -2px 8px rgba(0,0,0,0.08);';

  const printBtn = document.createElement('button');
  printBtn.textContent = '🖨 Print';
  printBtn.style.cssText = 'padding:10px 28px;font-size:14px;cursor:pointer;'
    + 'background:#18181b;color:#fff;border:none;border-radius:8px;font-weight:500;';
  printBtn.onclick = () => window.print();

  const pdfBtn = document.createElement('button');
  pdfBtn.textContent = '📄 Save as PDF';
  pdfBtn.style.cssText = 'padding:10px 28px;font-size:14px;cursor:pointer;'
    + 'background:#18181b;color:#fff;border:none;border-radius:8px;font-weight:500;';
  pdfBtn.onclick = async () => {
    pdfBtn.textContent = '⏳ Generating...';
    pdfBtn.style.opacity = '0.7';
    pdfBtn.disabled = true;
    try {
      await saveAsPDF();
    } finally {
      pdfBtn.textContent = '📄 Save as PDF';
      pdfBtn.style.opacity = '1';
      pdfBtn.disabled = false;
    }
  };

  const closeBtn = document.createElement('button');
  closeBtn.textContent = '✕ Close';
  closeBtn.style.cssText = 'padding:10px 28px;font-size:14px;cursor:pointer;'
    + 'background:#fff;color:#555;border:1px solid #ccc;border-radius:8px;';
  closeBtn.onclick = () => overlay.remove();

  toolbar.appendChild(printBtn);
  toolbar.appendChild(pdfBtn);
  toolbar.appendChild(closeBtn);

  overlay.appendChild(content);
  overlay.appendChild(toolbar);
  document.body.appendChild(overlay);

  // Print-specific CSS
  const style = document.createElement('style');
  style.id = 'voucher-print-style';
  style.textContent = `
    @media print {
      @page {
        size: 210mm 148.5mm landscape;
        margin: 0;
      }
      body * { visibility: hidden; }
      #voucher-print-overlay, #voucher-print-overlay * { visibility: visible; }
      #voucher-print-overlay {
        position: absolute !important;
        top: 0 !important; left: 0 !important;
        width: 100% !important; height: auto !important;
        overflow: visible !important;
        background: #fff !important;
      }
      #voucher-print-overlay > div:first-child {
        display: flex !important;
        flex-direction: column !important;
        align-items: center !important;
        max-width: none !important;
        margin: 0 !important;
        padding: 0 !important;
      }
      #voucher-print-overlay > div:first-child > div {
        margin: 0 !important;
        box-shadow: none !important;
        page-break-after: always;
      }
      #voucher-print-overlay .no-print {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  // Clean up print style when overlay is removed
  const observer = new MutationObserver(() => {
    if (!document.getElementById('voucher-print-overlay')) {
      const s = document.getElementById('voucher-print-style');
      if (s) s.remove();
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true });
}

// Generate PDF from voucher pages using html2canvas + jsPDF
async function saveAsPDF() {
  const pages = document.querySelectorAll('#voucher-print-overlay > div:first-child > div');
  if (!pages.length) return;

  // A5 landscape: 210mm x 148.5mm
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [210, 148.5],
  });

  for (let i = 0; i < pages.length; i++) {
    if (i > 0) pdf.addPage();

    const canvas = await html2canvas(pages[i], {
      scale: 4,
      useCORS: true,
      backgroundColor: '#ffffff',
      logging: false,
    });

    const imgData = canvas.toDataURL('image/png');
    pdf.addImage(imgData, 'PNG', 0, 0, 210, 148.5);
  }

  pdf.save('payment-vouchers.pdf');
}
