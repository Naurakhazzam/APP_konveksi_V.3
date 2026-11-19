'use client';

/**
 * Panduan baca menu Keuangan:
 *   - <InfoIstilah k="..."/>  : ikon ⓘ, dibuka dengan KLIK (bisa di HP). Isi dari KAMUS.
 *   - <TombolPanduan/>         : tombol "📖 Panduan" → panel samping.
 *   - <PanelPanduan konten/>   : isi panel per menu (untuk apa, langkah + tombol "Tunjukkan", istilah, tanya-jawab).
 * Semua di bawah <PanduanProvider>.
 * Elemen yang bisa "ditunjukkan" diberi atribut data-panduan="<id>".
 */

import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Popover } from '@base-ui/react/popover';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { KAMUS, type Istilah, type KunciIstilah } from '@/lib/keuangan/kamus';

// ─── Context ────────────────────────────────────────────────────────────────

interface PanduanCtx {
  terbuka: boolean;
  setTerbuka: (b: boolean) => void;
  fokus: KunciIstilah | null;
  bukaPanduan: (fokus?: KunciIstilah) => void;
}

const Ctx = createContext<PanduanCtx | null>(null);

export function PanduanProvider({ children }: { children: React.ReactNode }) {
  const [terbuka, setTerbuka] = useState(false);
  const [fokus, setFokus] = useState<KunciIstilah | null>(null);
  const bukaPanduan = useCallback((f?: KunciIstilah) => { setFokus(f ?? null); setTerbuka(true); }, []);
  return <Ctx.Provider value={{ terbuka, setTerbuka, fokus, bukaPanduan }}>{children}</Ctx.Provider>;
}

export function usePanduan() {
  const c = useContext(Ctx);
  if (!c) throw new Error('usePanduan harus di dalam <PanduanProvider>');
  return c;
}

// ─── Sorot elemen ───────────────────────────────────────────────────────────

/** Scroll ke elemen lalu beri bingkai berkedip ~3 detik */
function sorot(el: HTMLElement) {
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  const bingkai = el.style.outline, offset = el.style.outlineOffset, radius = el.style.borderRadius;
  el.style.outline = '3px solid #e5c17b';
  el.style.outlineOffset = '3px';
  if (!radius) el.style.borderRadius = '8px';
  el.animate(
    [{ outlineColor: 'rgba(229,193,123,1)' }, { outlineColor: 'rgba(229,193,123,0.15)' }, { outlineColor: 'rgba(229,193,123,1)' }],
    { duration: 700, iterations: 4 },
  );
  window.setTimeout(() => {
    el.style.outline = bingkai; el.style.outlineOffset = offset; el.style.borderRadius = radius;
  }, 3000);
}

export function tunjukkan(target: string, bilaTidakAda?: string) {
  const el = document.querySelector<HTMLElement>(`[data-panduan="${target}"]`);
  if (!el) { toast.info(bilaTidakAda ?? 'Bagian ini belum tampil di layar.'); return; }
  sorot(el);
}

// ─── Ikon ⓘ ────────────────────────────────────────────────────────────────

export function InfoIstilah({ k, className = '' }: { k: KunciIstilah; className?: string }) {
  const { bukaPanduan } = usePanduan();
  const [open, setOpen] = useState(false);
  const i: Istilah = KAMUS[k];
  const henti = (e: React.SyntheticEvent) => e.stopPropagation(); // jangan memicu sort kolom / klik induk
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label={`Arti ${i.judul}`}
        onClick={henti}
        onPointerDown={henti}
        onKeyDown={henti}
        className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current text-[9px] font-bold normal-case leading-none tracking-normal text-[#7d8389] opacity-80 transition hover:text-[#e5c17b] hover:opacity-100 data-[popup-open]:text-[#e5c17b] ${className}`}
      >
        i
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="center" sideOffset={6} collisionPadding={12} className="z-[60]">
          <Popover.Popup
            onClick={henti}
            className="w-[min(20rem,calc(100vw-24px))] rounded-lg border border-[#3A3D41] bg-[#1E2124] p-3 text-left text-xs normal-case tracking-normal text-[#c0c6cc] shadow-xl outline-none"
          >
            <p className="mb-1.5 text-sm font-bold text-[#e8eaed]">{i.judul}</p>
            <p className="leading-relaxed"><b className="text-[#9aa0a6]">Artinya:</b> {i.artinya}</p>
            {i.rumus && <p className="mt-1.5 leading-relaxed"><b className="text-[#9aa0a6]">Rumus:</b> {i.rumus}</p>}
            {i.sumber && <p className="mt-1.5 leading-relaxed"><b className="text-[#9aa0a6]">Sumber angka:</b> {i.sumber}</p>}
            <button
              type="button"
              onClick={() => { setOpen(false); bukaPanduan(k); }}
              className="mt-2.5 text-[11px] font-semibold text-[#e5c17b] hover:underline"
            >
              Baca panduan lengkap →
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

// ─── Tombol 📖 Panduan ──────────────────────────────────────────────────────

export function TombolPanduan() {
  const { bukaPanduan } = usePanduan();
  return (
    <button
      type="button"
      data-panduan="tombol-panduan"
      onClick={() => bukaPanduan()}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#3A3D41] bg-[#1E2124] px-3 text-xs font-semibold text-[#e8eaed] hover:border-[#e5c17b] hover:text-[#e5c17b]"
    >
      📖 Panduan
    </button>
  );
}

// ─── Panel Panduan ──────────────────────────────────────────────────────────

export interface LangkahPanduan {
  judul: string;
  isi: React.ReactNode;
  /** nilai data-panduan elemen yang disorot tombol "Tunjukkan" */
  target?: string;
  /** pesan bila elemen belum tampil (mis. harus buka Detail PO dulu) */
  bilaTidakAda?: string;
}

export interface KontenPanduan {
  judul: string;
  untukApa: React.ReactNode;
  langkah: LangkahPanduan[];
  istilah: KunciIstilah[];
  tanyaJawab: { t: string; j: React.ReactNode }[];
}

export function PanelPanduan({ konten }: { konten: KontenPanduan }) {
  const { terbuka, setTerbuka, fokus } = usePanduan();

  // Dibuka dari "Baca panduan lengkap" → langsung ke istilah itu
  useEffect(() => {
    if (!terbuka || !fokus) return;
    const t = window.setTimeout(() => {
      const el = document.getElementById(`istilah-${fokus}`);
      if (el) sorot(el);
    }, 250);
    return () => window.clearTimeout(t);
  }, [terbuka, fokus]);

  const klikTunjukkan = (l: LangkahPanduan) => {
    setTerbuka(false);
    window.setTimeout(() => tunjukkan(l.target!, l.bilaTidakAda), 250);
  };

  const istilah = fokus && !konten.istilah.includes(fokus) ? [...konten.istilah, fokus] : konten.istilah;
  const h3 = 'mb-2 text-[11px] font-bold uppercase tracking-widest text-[#e5c17b]';

  return (
    <Sheet open={terbuka} onOpenChange={setTerbuka}>
      <SheetContent side="right" className="w-full overflow-y-auto border-[#2A2D31] bg-[#16181A] text-[#e8eaed] sm:max-w-lg">
        <SheetHeader className="border-b border-[#2A2D31] pr-12">
          <SheetTitle className="text-[#e8eaed]">📖 Panduan — {konten.judul}</SheetTitle>
          <SheetDescription className="text-xs text-[#9aa0a6]">Cara membaca angka di halaman ini, dengan contoh dari data Anda sendiri.</SheetDescription>
        </SheetHeader>

        <div className="space-y-6 px-4 pb-8 text-[13px] leading-relaxed text-[#c0c6cc]">
          <section>
            <h3 className={h3}>Menu ini untuk apa?</h3>
            <div className="space-y-2">{konten.untukApa}</div>
          </section>

          <section>
            <h3 className={h3}>Cara membaca, langkah demi langkah</h3>
            <ol className="space-y-3">
              {konten.langkah.map((l, n) => (
                <li key={n} className="rounded-lg border border-[#2A2D31] bg-[#1A1D1F] p-3">
                  <div className="mb-1 flex items-start justify-between gap-2">
                    <p className="font-semibold text-[#e8eaed]"><span className="mr-1.5 text-[#e5c17b]">{n + 1}.</span>{l.judul}</p>
                    {l.target && (
                      <button
                        type="button"
                        onClick={() => klikTunjukkan(l)}
                        className="shrink-0 rounded-md border border-[#e5c17b]/40 px-2 py-0.5 text-[11px] font-semibold text-[#e5c17b] hover:bg-[#e5c17b]/10"
                      >
                        Tunjukkan
                      </button>
                    )}
                  </div>
                  <div className="space-y-1.5">{l.isi}</div>
                </li>
              ))}
            </ol>
          </section>

          <section>
            <h3 className={h3}>Daftar istilah</h3>
            <dl className="space-y-2">
              {istilah.map(k => {
                const i: Istilah = KAMUS[k];
                return (
                  <div key={k} id={`istilah-${k}`} className="rounded-lg border border-[#2A2D31] p-3">
                    <dt className="font-semibold text-[#e8eaed]">{i.judul}</dt>
                    <dd className="mt-0.5">{i.artinya}</dd>
                    {i.rumus && <dd className="mt-1 text-xs"><b className="text-[#9aa0a6]">Rumus:</b> {i.rumus}</dd>}
                    {i.sumber && <dd className="mt-0.5 text-xs"><b className="text-[#9aa0a6]">Sumber angka:</b> {i.sumber}</dd>}
                  </div>
                );
              })}
            </dl>
          </section>

          <section>
            <h3 className={h3}>Pertanyaan umum</h3>
            <div className="space-y-2">
              {konten.tanyaJawab.map((q, n) => (
                <details key={n} className="group rounded-lg border border-[#2A2D31] p-3">
                  <summary className="cursor-pointer font-semibold text-[#e8eaed] marker:text-[#e5c17b]">{q.t}</summary>
                  <div className="mt-1.5">{q.j}</div>
                </details>
              ))}
            </div>
          </section>
        </div>
      </SheetContent>
    </Sheet>
  );
}
