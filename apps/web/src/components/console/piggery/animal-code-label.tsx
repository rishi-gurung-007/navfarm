'use client';

import { useRef, useState } from 'react';
import { Download, Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Barcode } from '@/components/console/barcode';
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
 * The label as a PNG: the code and what the animal is across the top, the barcode
 * below. 90 x 50 mm at 10 px/mm, a common label size, so it prints sharp on a
 * card or an ear-tag sheet.
 */
export async function renderLabelPng(code: string, subtitle: string, barcodeSvg: string): Promise<Blob> {
  const W = 900;
  const H = 500;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not draw the label.');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#000000';
  ctx.textBaseline = 'top';
  let size = 48;
  ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
  while (ctx.measureText(code).width > W - 60 && size > 20) {
    size -= 2;
    ctx.font = `700 ${size}px ui-monospace, Menlo, monospace`;
  }
  ctx.fillText(code, 30, 40);
  ctx.fillStyle = '#333333';
  ctx.font = '400 26px -apple-system, "Segoe UI", Helvetica, Arial, sans-serif';
  ctx.fillText(subtitle, 30, 40 + size + 20, W - 60);
  if (barcodeSvg) {
    const bars = await svgImage(barcodeSvg);
    ctx.drawImage(bars, 30, 200, W - 60, 220);
  }
  ctx.fillStyle = '#000000';
  ctx.font = '400 22px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillText(code, W / 2, 440);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the label.'))), 'image/png'),
  );
}

/** Prints only the label, through a hidden frame: the page around it stays as it is, and no pop-up is needed. */
function printLabel(code: string, subtitle: string, barcodeSvg: string) {
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
    .label { box-sizing: border-box; width: 90mm; height: 50mm; padding: 3mm; display: flex; flex-direction: column; gap: 3mm; }
    .code { font: 700 6mm ui-monospace, Menlo, monospace; word-break: break-all; }
    .sub { font-size: 3mm; color: #333; margin-top: 1.5mm; }
    .bars { text-align: center; }
    .bars svg { width: 100%; height: 20mm; display: block; }
    .bars span { font: 2.6mm ui-monospace, Menlo, monospace; }
  </style></head><body><div class="label">
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
 * An animal's Code 128 barcode, with Print and Download. It carries the animal
 * code (animal-scan-code.ts) and is drawn when shown, not stored.
 */
export function AnimalCodeLabel({ animal, breedName }: { animal: Row; breedName?: string | null }) {
  const code = animalScanValue(animal);
  const subtitle = labelSubtitle(animal, breedName);
  const barRef = useRef<SVGSVGElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  if (!code) return null;

  const bars = () => (barRef.current?.classList.contains('hidden') ? '' : svgMarkup(barRef.current));

  const download = async () => {
    setBusy(true);
    setError('');
    try {
      const blob = await renderLabelPng(code, subtitle, bars());
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
          <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Barcode of the animal code. Scan it on Livestock › Scan Animal.</p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => printLabel(code, subtitle, bars())}>
            <Printer className="h-3.5 w-3.5" /> Print
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={download} disabled={busy}>
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        </div>
      </div>
      {/* The label itself: black on white in every theme, the way it prints. */}
      <div data-animal-label className="max-w-md rounded-[var(--radius-sm)] bg-white p-3 text-black">
        <div className="min-w-0">
          <p className="break-all font-mono text-base font-bold leading-tight">{code}</p>
          {subtitle && <p className="mt-1 text-xs text-[#333]">{subtitle}</p>}
        </div>
        <div className="mt-3">
          <Barcode value={code} svgRef={barRef} />
          <p className="mt-0.5 text-center font-mono text-[11px] tracking-wide">{code}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: 'var(--danger)' }}>{error}</p>}
    </section>
  );
}
