'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  ImageUp,
  Loader2,
  QrCode,
  ScanLine,
  Search,
  SearchX,
  ShieldAlert,
  ExternalLink,
  RotateCcw,
} from 'lucide-react';
import type { IScannerControls } from '@zxing/browser';
import { api } from '@/services/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, ReadField } from '@/components/ui/field';
import { EmptyState, LoadingState } from '@/components/ui/states';
import { StatusBadge } from '@/components/ui/status-badge';
import { formatDate } from '@/utils/date-short';
import { ageBetween, formatAge } from '@/modules/master-data/utils/age';
import AnimalDetailsModal from '@/components/console/piggery/animal-details-modal';
import { parseScannedCode, recentScanEvents } from './animal-scan-code';

type Row = Record<string, any>;

type Lookup =
  | { state: 'idle' }
  | { state: 'loading'; code: string }
  | { state: 'found'; code: string; animal: Row }
  | { state: 'missing'; code: string; message: string };

const unwrap = <T = any,>(res: any): T => (res?.data ?? res) as T;
const SEX: Record<string, string> = { F: 'Female', M: 'Male' };
const words = (v: unknown) => {
  const s = String(v ?? '').replaceAll('_', ' ').toLowerCase();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
};
const today = () => new Date().toISOString().slice(0, 10);

/** The same code read again within this window is the camera still looking at the label, not a second scan. */
const REPEAT_MS = 3000;

/**
 * How old she is today: from her date of birth when it is known, otherwise from
 * her age at entry plus the time since (estimated, and said so).
 */
function ageToday(animal: Row): string {
  const exact = ageBetween(animal.dob, today());
  if (exact) return formatAge(exact);
  const since = ageBetween(animal.entry_date, today());
  if (animal.age_at_entry_weeks == null || !since) return '';
  return `about ${Number(animal.age_at_entry_weeks) + since.weeks} weeks (from age at entry)`;
}

/** The camera error a person can act on. */
function cameraMessage(err: any): string {
  const name = err?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError')
    return 'Camera access was refused. Allow the camera for this site, or type the code or use a USB scanner below.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError')
    return 'No camera was found on this device. Type the code, use a USB scanner, or scan a photo of the label.';
  if (name === 'NotReadableError') return 'The camera is in use by another application.';
  return err?.message || 'The camera could not be started.';
}

async function zxingReader() {
  const [{ BrowserMultiFormatReader }, { BarcodeFormat, DecodeHintType }] = await Promise.all([
    import('@zxing/browser'),
    import('@zxing/library'),
  ]);
  // The two codes the labels carry. Narrowing the formats makes each frame quicker to read.
  const hints = new Map();
  hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE, BarcodeFormat.CODE_128]);
  hints.set(DecodeHintType.TRY_HARDER, true);
  return new BrowserMultiFormatReader(hints, { delayBetweenScanAttempts: 150 });
}

/**
 * Livestock › Scan Animal. Reads an animal's QR code or Code 128 barcode (the
 * label printed from her register card) from the camera, a photo, a USB scanner
 * or typed input, and shows who she is. The lookup is `/animal/lookup/tag`, which
 * applies the same company, area and farm boundary as the register, so a code
 * from another company or farm is "not found" here, never shown.
 */
export default function AnimalScanPanel() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const lastReadRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });
  const requestRef = useRef(0);
  const resultRef = useRef<HTMLElement>(null);

  const [typed, setTyped] = useState('');
  const [lookup, setLookup] = useState<Lookup>({ state: 'idle' });
  const [breeding, setBreeding] = useState<Row | null>(null);
  const [facts, setFacts] = useState<Row | null>(null);
  const [extrasLoading, setExtrasLoading] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraStarting, setCameraStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [photoBusy, setPhotoBusy] = useState(false);
  const [history, setHistory] = useState<{ code: string; label: string }[]>([]);
  const [detailsId, setDetailsId] = useState<string | null>(null);

  const find = useCallback(async (raw: string) => {
    const code = parseScannedCode(raw);
    if (!code) return;
    const request = ++requestRef.current;
    setLookup({ state: 'loading', code });
    setBreeding(null);
    setFacts(null);
    try {
      const animal = unwrap<Row>(await api.get(`/animal/lookup/tag?tag=${encodeURIComponent(code)}`));
      if (request !== requestRef.current) return;
      setLookup({ state: 'found', code, animal });
      setTyped('');
      // On a phone the result sits under the scanner: bring it into view.
      if (window.innerWidth < 1024) requestAnimationFrame(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
      setHistory((h) => [{ code: animal.animal_code, label: animal.animal_code }, ...h.filter((x) => x.code !== animal.animal_code)].slice(0, 6));
      try {
        navigator.vibrate?.(60);
      } catch {
        // Not every device can vibrate.
      }
      setExtrasLoading(true);
      const [b, f] = await Promise.allSettled([
        api.get(`/animal/${animal.animal_id}/breeding`),
        api.get(`/animal/${animal.animal_id}`),
      ]);
      if (request !== requestRef.current) return;
      setBreeding(b.status === 'fulfilled' ? unwrap<Row>(b.value) : null);
      setFacts(f.status === 'fulfilled' ? unwrap<Row>(f.value) : null);
      setExtrasLoading(false);
    } catch (err: any) {
      if (request !== requestRef.current) return;
      const status = err?.status;
      setLookup({
        state: 'missing',
        code,
        message:
          status === 404
            ? 'No animal with this code is registered in the selected company and farm scope.'
            : status === 403
              ? 'You do not have access to this animal.'
              : err?.message || 'The animal could not be looked up.',
      });
    } finally {
      // Ready for the next scan from a USB scanner without a click.
      inputRef.current?.focus();
    }
  }, []);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = async () => {
    setCameraError('');
    setCameraStarting(true);
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw Object.assign(new Error('This browser cannot open the camera here (it needs HTTPS or localhost).'), { name: 'Unsupported' });
      }
      const reader = await zxingReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: 'environment' } } },
        videoRef.current!,
        (result) => {
          if (!result) return;
          const code = result.getText();
          const now = Date.now();
          if (code === lastReadRef.current.code && now - lastReadRef.current.at < REPEAT_MS) return;
          lastReadRef.current = { code, at: now };
          void find(code);
        },
      );
      controlsRef.current = controls;
      setCameraOn(true);
    } catch (err: any) {
      setCameraError(cameraMessage(err));
      stopCamera();
    } finally {
      setCameraStarting(false);
    }
  };

  const scanPhoto = async (file: File | undefined) => {
    if (!file) return;
    setCameraError('');
    setPhotoBusy(true);
    const url = URL.createObjectURL(file);
    try {
      const reader = await zxingReader();
      const result = await reader.decodeFromImageUrl(url);
      await find(result.getText());
    } catch {
      setCameraError('No QR code or barcode could be read from that photo. Try a sharper, closer picture of the label.');
    } finally {
      URL.revokeObjectURL(url);
      setPhotoBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // A link to this screen with ?code= opens straight onto that animal; the camera is released on leaving.
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (code) void find(code);
    inputRef.current?.focus();
    return () => controlsRef.current?.stop();
  }, [find]);

  const animal = lookup.state === 'found' ? lookup.animal : null;
  const events = animal ? recentScanEvents(animal, breeding) : [];
  const isFemale = animal?.gender === 'F';
  const location = [animal?.location_code, animal?.location_name].filter(Boolean).join(' — ');

  return (
    <div className="space-y-4">
      <p className="text-[13px]" style={{ color: 'var(--text-secondary)' }}>
        Scan the QR code or barcode on an animal&apos;s label to see who she is. Print labels from the animal&apos;s card in the
        Animal Register.
      </p>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
        {/* ── Scanner ── */}
        <section className="space-y-4 rounded-[var(--radius-lg)] border p-4" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }} aria-label="Scanner">
          <div className="relative aspect-[4/3] overflow-hidden rounded-[var(--radius-md)] bg-black">
            <video ref={videoRef} className={`h-full w-full object-cover ${cameraOn ? '' : 'hidden'}`} muted playsInline />
            {cameraOn ? (
              // Aiming guide over the live picture.
              <div aria-hidden className="pointer-events-none absolute inset-[14%] rounded-[var(--radius-md)] border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.25)]">
                <div className="absolute inset-x-3 top-1/2 h-0.5 -translate-y-1/2 animate-pulse bg-[var(--accent)]" />
              </div>
            ) : (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center text-white/80">
                <ScanLine className="h-10 w-10" strokeWidth={1.25} />
                <p className="text-[13px]">Point the camera at the QR code or barcode on the label.</p>
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {cameraOn ? (
              <Button type="button" variant="outline" size="sm" onClick={stopCamera}>
                <CameraOff className="h-4 w-4" /> Stop camera
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={startCamera} disabled={cameraStarting}>
                {cameraStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />} Start camera
              </Button>
            )}
            <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={photoBusy}>
              {photoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />} Scan a photo
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              aria-label="Photo of a label"
              data-testid="scan-photo-input"
              onChange={(e) => void scanPhoto(e.target.files?.[0])}
            />
          </div>
          {cameraError && (
            <p role="alert" className="text-[12px]" style={{ color: 'var(--warning)' }}>
              {cameraError}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void find(typed);
            }}
            className="border-t pt-4"
            style={{ borderColor: 'var(--border)' }}
          >
            <Field label="Animal code" htmlFor="scan-code" hint="A USB barcode scanner types here; press Enter after typing or pasting a code.">
              <div className="flex gap-2">
                <Input
                  id="scan-code"
                  ref={inputRef}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="Scan or type an animal code or RFID tag"
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <Button type="submit" size="sm" className="h-10" disabled={!typed.trim() || lookup.state === 'loading'}>
                  <Search className="h-4 w-4" /> Find
                </Button>
              </div>
            </Field>
          </form>

          {history.length > 0 && (
            <div>
              <p className="nf-text-label mb-1.5 text-(--text-secondary)">Scanned this session</p>
              <div className="flex flex-wrap gap-1.5">
                {history.map((h) => (
                  <button
                    key={h.code}
                    type="button"
                    onClick={() => void find(h.code)}
                    className="rounded-full border px-2.5 py-1 font-mono text-[11px] transition hover:bg-[var(--surface-raised)]"
                    style={{ borderColor: 'var(--border)', color: 'var(--text-primary)' }}
                  >
                    {h.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* ── Result ── */}
        <section ref={resultRef} className="min-w-0 scroll-mt-4 rounded-[var(--radius-lg)] border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }} aria-live="polite" aria-label="Scanned animal">
          {lookup.state === 'idle' && (
            <EmptyState icon={QrCode} title="No animal scanned yet" description="Scan a label, or type a code on the left, to see the animal's details here." />
          )}
          {lookup.state === 'loading' && <LoadingState label={`Looking up ${lookup.code}…`} />}
          {lookup.state === 'missing' && (
            <div className="flex flex-col items-center gap-2 px-6 py-14 text-center" data-testid="scan-not-found">
              <SearchX className="h-7 w-7" style={{ color: 'var(--danger)' }} strokeWidth={1.5} />
              <p className="nf-text-body-strong text-(--text-primary)">Animal not found</p>
              <p className="font-mono text-[13px]" style={{ color: 'var(--text-primary)' }}>
                {lookup.code}
              </p>
              <p className="max-w-md text-[13px] text-(--text-secondary)">{lookup.message}</p>
              <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => { setLookup({ state: 'idle' }); inputRef.current?.focus(); }}>
                <RotateCcw className="h-4 w-4" /> Scan another
              </Button>
            </div>
          )}
          {animal && (
            <div data-testid="scan-result">
              <header className="flex flex-wrap items-start justify-between gap-3 border-b p-4 sm:p-5" style={{ borderColor: 'var(--border)' }}>
                <div className="min-w-0">
                  <p className="nf-text-label text-(--text-muted)">{[words(animal.animal_type), SEX[animal.gender] ?? ''].filter(Boolean).join(' · ')}</p>
                  <h2 className="mt-0.5 break-all font-mono text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
                    {animal.animal_code}
                  </h2>
                  <p className="mt-1 text-[13px]" style={{ color: 'var(--text-secondary)' }}>
                    {[animal.breed_name, animal.stage_name].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <StatusBadge status={animal.status} />
                  {!animal.is_active && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>No longer in the herd</span>}
                </div>
              </header>

              {animal.hasActiveWithdrawal && (
                <div className="mx-4 mt-4 flex items-start gap-2 rounded-[var(--radius-sm)] border p-3 text-[12px] sm:mx-5" style={{ borderColor: 'var(--warning)', backgroundColor: 'var(--warning-muted)', color: 'var(--warning)' }}>
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    <p className="font-semibold">Under medicine withdrawal: not for slaughter or sale</p>
                    {(animal.activeWithdrawals ?? []).map((w: Row, i: number) => (
                      <p key={i}>
                        {w.item_name}: {w.daysRemaining} day(s) remaining, last dose {formatDate(w.lastDose)}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">
                <ReadField label="Breed" value={animal.breed_name ?? ''} />
                <ReadField label="Stage" value={animal.stage_name ?? ''} />
                <ReadField label="Sex" value={SEX[animal.gender] ?? animal.gender ?? ''} />
                <ReadField label="Farm" value={animal.farm_name ?? ''} />
                <ReadField label="Pen / location" value={location} />
                <ReadField label="Batch" value={animal.batch_no ?? ''} mono />
                <ReadField label="Age" value={ageToday(animal)} />
                <ReadField label="Date of birth" value={animal.dob ? formatDate(animal.dob) : ''} />
                <ReadField label="Entry" value={[animal.entry_date ? formatDate(animal.entry_date) : '', words(animal.entry_type)].filter(Boolean).join(' · ')} />
                <ReadField
                  label="Current weight"
                  value={
                    extrasLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--text-muted)' }} />
                    ) : facts?.current_weight_kg != null ? (
                      `${Number(facts.current_weight_kg).toFixed(1)} kg${facts.current_weight_date ? ` · ${formatDate(facts.current_weight_date)}` : ''}`
                    ) : (
                      ''
                    )
                  }
                />
                {isFemale && <ReadField label="Parity" value={String(animal.parity_count ?? 0)} />}
                <ReadField label="RFID" value={animal.rfid_tag ?? ''} mono />
              </div>

              <div className="border-t p-4 sm:p-5" style={{ borderColor: 'var(--border)' }}>
                <p className="nf-text-label mb-2 text-(--text-secondary)">Recent events</p>
                {extrasLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                ) : events.length === 0 ? (
                  <p className="text-[13px]" style={{ color: 'var(--text-muted)' }}>No events recorded.</p>
                ) : (
                  <ol className="space-y-0">
                    {events.map((e, i) => (
                      <li key={e.key} className="relative flex gap-3 pb-3 last:pb-0">
                        <div className="flex flex-col items-center">
                          <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: i === 0 ? 'var(--accent)' : 'var(--border-strong, var(--border))' }} />
                          {i < events.length - 1 && <span className="mt-1 w-px flex-1" style={{ backgroundColor: 'var(--border)' }} />}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                            <p className="text-[13px] font-medium" style={{ color: 'var(--text-primary)' }}>{e.title}</p>
                            <p className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatDate(e.date)}</p>
                          </div>
                          {e.detail && <p className="text-[12px]" style={{ color: 'var(--text-secondary)' }}>{e.detail}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </div>

              <footer className="flex flex-wrap justify-end gap-2 border-t p-4 sm:px-5" style={{ borderColor: 'var(--border)' }}>
                <Button type="button" variant="outline" size="sm" onClick={() => { setLookup({ state: 'idle' }); inputRef.current?.focus(); }}>
                  <RotateCcw className="h-4 w-4" /> Scan another
                </Button>
                <Button type="button" size="sm" onClick={() => setDetailsId(animal.animal_id)}>
                  <ExternalLink className="h-4 w-4" /> Open full record
                </Button>
              </footer>
            </div>
          )}
        </section>
      </div>

      <AnimalDetailsModal animalId={detailsId} onClose={() => setDetailsId(null)} />
    </div>
  );
}
