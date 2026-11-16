'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'react-qr-code';
import JsBarcode from 'jsbarcode';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { animalScanValue, labelFileName } from './animal-scan-code';

type Row = Record<string, any>;

const SEX: Record<string, string> = { F: 'Female', M: 'Male' };

/** "Sow · Female · Large White" — the line under the code on the label. Only what the register holds. */
export function labelSubtitle(animal: Row, breedName?: string | null): string {
  const type = String(animal.animal_type ?? '').replaceAll('_', ' ').toLowerCase();
  return [
    type ? type.charAt(0).toUpperCase() + type.slice(1) : '',
    SEX[String(animal.gender ?? '')] ?? '',
    breedName ?? animal.breed_name ?? '',
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Code 128, drawn into an SVG from the code. Black on white whatever the theme, so it scans off a screen too. */
function Code128({ value, svgRef }: { value: string; svgRef: React.RefObject<SVGSVGElement | null> }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!svgRef.current || !value) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: 'CODE128',
        width: 2,
        height: 64,
        margin: 0,
        displayValue: false,
        background: '#ffffff',
        lineColor: '#000000',
      });
      setFailed(false);
    } catch {
      // Code 128 carries ASCII only; a code outside it still has its QR code.
      setFailed(true);
    }
  }, [value, svgRef]);
  return (
    <>
      <svg ref={svgRef} data-barcode role="img" aria-label={`Barcode ${value}`} className={failed ? 'hidden' : 'h-14 w-full max-w-full'} preserveAspectRatio="none" />
      {failed && <p className="text-xs text-[#555]">This code cannot be drawn as a barcode; use the QR code.</p>}
    </>
  );
}

function svgMarkup(svg: SVGSVGElement | null | undefined): string {
  if (!svg) return '';
  const copy = svg.cloneNode(true) as SVGSVGElement;
  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.removeAttribute('class');
  return new XMLSerializer().serializeToString(copy);
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

/** An SVG as an image the canvas can draw. */
function svgImage(markup: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not draw the label.'));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  });
}

/**
 * The label as a PNG: QR code on the left, the code and what the animal is on
 * the right, the barcode across the bottom. 90 x 50 mm at 10 px/mm, a common
 * label size, so it prints sharp on a card or an ear-tag sheet.
 */
export async function renderLabelPng(code: string, subtitle: string, qrSvg: string, barcodeSvg: string): Promise<Blob> {
  const W = 900;
  const H = 500;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the label.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  const qr = await svgImage(qrSvg);
  ctx.drawImage(qr, 30, 30, 280, 280);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  let size = 48;
  ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
  while (ctx.measureText(code).width > W - 370 && size > 20) {
    size -= 2;
    ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
  }
  ctx.fillText(code, 340, 60);
  ctx.fillStyle = '#333333';
  ctx.font = '400 26px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(subtitle, 340, 60 + size + 24, W - 370);
  if (barcodeSvg) {
    const bars = await svgImage(barcodeSvg);
    ctx.drawImage(bars, 30, 340, W - 60, 110);
  }
  ctx.fillStyle = '#000000';
  ctx.font = '400 22px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(code, W / 2, 458);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the label.'))), 'image/png'),
  );
}

/** Prints only the label, through a hidden frame: the page around it stays as it is, and no pop-up is needed. */
function printLabel(code: string, subtitle: string, qrSvg: string, barcodeSvg: string) {
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  Object.assign(frame.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' });
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc || !frame.contentWindow) {
    frame.remove();
    return;
  }
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(code)}</title><style>
    @page { size: 90mm 50mm; margin: 0; }
    html, body { margin: 0; background: #fff; color: #000; font-family: -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; }
    .label { box-sizing: border-box; width: 90mm; height: 50mm; padding: 3mm; display: grid; grid-template-columns: 28mm 1fr; grid-template-rows: 28mm 1fr; column-gap: 3mm; row-gap: 2mm; }
    .qr svg { width: 28mm; height: 28mm; display: block; }
    .code { font: 700 5mm ui-monospace, Menlo, monospace; word-break: break-all; margin-top: 2mm; }
    .sub { font-size: 3mm; color: #333; margin-top: 1.5mm; }
    .bars { grid-column: 1 / span 2; text-align: center; }
    .bars svg { width: 100%; height: 11mm; display: block; }
    .bars span { font: 2.6mm ui-monospace, Menlo, monospace; }
  </style></head><body><div class="label">
    <div class="qr">${qrSvg}</div>
    <div><div class="code">${escapeHtml(code)}</div><div class="sub">${escapeHtml(subtitle)}</div></div>
    <div class="bars">${barcodeSvg}<span>${escapeHtml(code)}</span></div>
  </div></body></html>`);
  doc.close();
  const win = frame.contentWindow;
  const cleanUp = () => setTimeout(() => frame.remove(), 500);
  win.addEventListener('afterprint', cleanUp, { once: true });
  setTimeout(() => {
    win.focus();
    win.print();
    // Some browsers fire no afterprint; never leave the frame behind.
    setTimeout(() => frame.isConnected && frame.remove(), 60_000);
  }, 150);
}

/**
 * An animal's QR code and Code 128 barcode, with Print and Download. Both carry
 * the animal code (animal-scan-code.ts) and are drawn when shown, not stored.
 */
export function AnimalCodeLabel({ animal, breedName }: { animal: Row; breedName?: string | null }) {
  const code = animalScanValue(animal);
  const subtitle = labelSubtitle(animal, breedName);
  const qrRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<SVGSVGElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!code) return null;

  const parts = () => ({
    qr: svgMarkup(qrRef.current?.querySelector('svg')),
    bars: barRef.current?.classList.contains('hidden') ? '' : svgMarkup(barRef.current),
  });

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const { qr, bars } = parts();
      const blob = await renderLabelPng(code, subtitle, qr, bars);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = labelFileName(code);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      setError(e?.message || 'Could not draw the label.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label="Scan label" className="rounded-[var(--radius-md)] border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-raised)' }}>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Scan label</p>
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>QR code and barcode of the animal code. Scan either on Livestock › Scan Animal.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { const { qr, bars } = parts(); printLabel(code, subtitle, qr, bars); }}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download} disabled={busy}>
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        </div>
      </div>
      {/* The label itself: black on white in every theme, the way it prints. */}
      <div data-animal-label className="max-w-md rounded-[var(--radius-sm)] bg-white p-3 text-black">
        <div className="flex items-start gap-3">
          <div ref={qrRef} data-qr className="shrink-0">
            <QRCode value={code} size={104} level="M" bgColor="#ffffff" fgColor="#000000" title={`QR code ${code}`} />
          </div>
          <div className="min-w-0 pt-1">
            <p className="break-all font-mono text-base font-bold leading-tight">{code}</p>
            {subtitle && <p className="mt-1 text-xs text-[#333]">{subtitle}</p>}
          </div>
        </div>
        <div className="mt-3">
          <Code128 value={code} svgRef={barRef} />
          <p className="mt-0.5 text-center font-mono text-[11px] tracking-wide">{code}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </section>
  );
}
