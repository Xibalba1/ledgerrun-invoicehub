import { useEffect, useRef, useState } from "react";
import type { InvoiceRecord, ReferenceSnapshot } from "@ledgerrun/contract";
import { api } from "./api";
import { useInvoices } from "./useInvoices";
import {
  STATUS_TONE,
  STATUS_LABEL,
  STAGE_LABEL,
  sourceLabel,
  partitionLanes,
  computeStats,
  invoiceTotal,
  blockerSummary,
  queueValue,
  relativeTime,
  escalationReason,
  money,
} from "./lib";
import type { Lanes, Stats } from "./lib";
import Card from "./components/Card";
import Button from "./components/Button";
import StatsBar from "./components/StatsBar";
import { Spinner, Sparkles, Check, Invoice, Escalate } from "./components/icons";
import InvoiceDetail from "./InvoiceDetail";

const TILE_TONE: Record<InvoiceRecord["status"], string> = {
  held: "border-accent-amber/30 bg-accent-amber/10 text-accent-amber",
  submitted: "border-accent-green/30 bg-accent-green/10 text-accent-green",
  processing: "border-accent/30 bg-accent/10 text-accent",
  failed: "border-accent-red/30 bg-accent-red/10 text-accent-red",
};

export default function App() {
  const invoices = useInvoices();
  const [reference, setReference] = useState<ReferenceSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [health, setHealth] = useState<{ ok: boolean; llm: boolean } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api.health().then(setHealth).catch(() => {});
    api.reference().then(setReference).catch(() => {});
  }, []);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    setUploading(true);
    try {
      let last: InvoiceRecord | null = null;
      for (const f of Array.from(files)) last = await api.upload(f);
      if (last) setSelectedId(last.id);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function seedDemo() {
    setError(null);
    setSeeding(true);
    try {
      const { ids } = await api.demoSeed();
      if (ids[0]) setSelectedId(ids[0]);
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
    } finally {
      setSeeding(false);
    }
  }

  // Full reset: wipe the server store, then reload so the live stream and all
  // local state restart from a genuinely empty inbox.
  async function resetDemo() {
    setResetting(true);
    try {
      await api.reset();
      window.location.reload();
    } catch (e) {
      setError(String(e instanceof Error ? e.message : e));
      setResetting(false);
    }
  }

  const lanes = partitionLanes(invoices);
  const stats = computeStats(invoices);
  const selected = invoices.find((i) => i.id === selectedId) ?? null;

  return (
    <div
      className="min-h-screen bg-canvas text-ink"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.relatedTarget === null) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        onFiles(e.dataTransfer.files);
      }}
    >
      {dragging && <DropOverlay />}

      <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1600px] items-center gap-4 px-6 py-3">
          <Brand />
          <div className="ml-auto flex items-center gap-4">
            <div className="hidden md:flex">
              <StatsBar invoices={invoices} />
            </div>
            <HealthDot health={health} />
            {invoices.length > 0 && (
              <Button variant="ghost" size="sm" onClick={resetDemo} loading={resetting} icon={<ResetIcon />} title="Clear every invoice and start over">
                Reset demo
              </Button>
            )}
            <input ref={fileRef} type="file" accept=".eml,.pdf" multiple className="hidden" onChange={(e) => onFiles(e.target.files)} />
            <Button onClick={() => fileRef.current?.click()} disabled={uploading} loading={uploading} icon={<UploadIcon />}>
              {uploading ? "Ingesting…" : "Ingest invoice"}
            </Button>
          </div>
        </div>
      </header>

      {invoices.length === 0 ? (
        <Onboarding onSeed={seedDemo} seeding={seeding} llm={health?.llm ?? true} error={error} />
      ) : (
        <main className="mx-auto max-w-[1600px] px-6 py-6">
          <PageHero />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="flex flex-col gap-4 lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto lg:pr-1 scrollbar-none">
            <div className="flex items-baseline justify-between px-0.5">
              <h2 className="text-[19px] font-semibold tracking-tight text-ink">Invoice Review Queue</h2>
              <span className="text-[13px] text-muted-2">
                {lanes.needsYou.length > 0 ? `${lanes.needsYou.length} need you` : `${invoices.length} total`}
              </span>
            </div>

            {error && (
              <div className="rounded-card border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[13.5px] text-accent-red">{error}</div>
            )}

            <Lane title="Needs you" count={lanes.needsYou.length} tone="bg-accent-amber">
              {lanes.needsYou.length === 0 && stats.processed > 0 ? (
                <Card className="flex animate-popIn flex-col items-center gap-1.5 py-7 text-center">
                  <span className="text-accent-green">
                    <Check size={18} />
                  </span>
                  <div className="text-[14px] font-medium text-ink">Inbox zero</div>
                  <div className="text-[13px] text-muted">
                    {stats.processed} processed · {Math.round(stats.autoRate * 100)}% auto-cleared
                  </div>
                </Card>
              ) : (
                lanes.needsYou.map((inv) => (
                  <InvoiceCard key={inv.id} inv={inv} active={inv.id === selectedId} onClick={() => setSelectedId(inv.id)} />
                ))
              )}
            </Lane>

            {lanes.inFlight.length > 0 && (
              <Lane title="In flight" count={lanes.inFlight.length} tone="bg-accent">
                {lanes.inFlight.map((inv) => (
                  <InvoiceCard key={inv.id} inv={inv} active={inv.id === selectedId} onClick={() => setSelectedId(inv.id)} />
                ))}
              </Lane>
            )}

            {lanes.escalated.length > 0 && (
              <Lane title="Escalated" count={lanes.escalated.length} tone="bg-accent-violet">
                <p className="-mt-0.5 px-0.5 text-[12px] leading-relaxed text-muted-2">
                  Handed off for resolution outside LedgerRun. Tracked here until closed.
                </p>
                {lanes.escalated.map((inv) => (
                  <InvoiceCard key={inv.id} inv={inv} active={inv.id === selectedId} onClick={() => setSelectedId(inv.id)} />
                ))}
              </Lane>
            )}

            {lanes.cleared.length > 0 && (
              <Lane title="Auto-submitted" count={lanes.cleared.length} tone="bg-accent-green">
                {lanes.cleared.map((inv) => (
                  <InvoiceCard key={inv.id} inv={inv} active={inv.id === selectedId} onClick={() => setSelectedId(inv.id)} />
                ))}
              </Lane>
            )}
          </aside>

          <section>
            {selected ? (
              <InvoiceDetail key={selected.id} invoice={selected} reference={reference} />
            ) : (
              <QueueOverview lanes={lanes} stats={stats} onSelect={setSelectedId} />
            )}
          </section>
          </div>
        </main>
      )}
    </div>
  );
}

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-7 w-7 place-items-center rounded-[9px] bg-ink text-white shadow-[inset_0_1px_0_0_rgb(255_255_255/0.14)]">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
      <div className="flex items-baseline gap-2">
        <span className="text-[15.5px] font-semibold tracking-tight text-ink">LedgerRun</span>
        <span className="hidden text-[11.5px] font-semibold uppercase tracking-[0.1em] text-muted-2 sm:inline">Invoice Hub</span>
      </div>
    </div>
  );
}

// The screen's identity line: what this place is and why it's calm. The promise
// up top frames every card below it — the AI did the work; you make the calls.
function PageHero() {
  return (
    <div className="mb-6">
      <h1 className="text-[30px] font-semibold tracking-tight text-ink">Let&apos;s review your invoices</h1>
      <p className="mt-1.5 text-[15px] leading-relaxed text-muted">
        The AI reads, matches, and decides every invoice — you just review the ones it flags.
      </p>
    </div>
  );
}

function Lane({ title, count, tone, children }: { title: string; count: number; tone: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-0.5">
        <span className={"h-1.5 w-1.5 rounded-full " + tone} />
        <span className="text-[12px] font-semibold uppercase tracking-[0.08em] text-muted">{title}</span>
        <span className="ml-auto rounded-pill bg-surface px-1.5 py-0.5 text-[12px] font-medium tabular-nums text-muted-2">{count}</span>
      </div>
      <div className="flex flex-col gap-2">{children}</div>
    </div>
  );
}

// A card answers "is this an invoice / what's it worth / what is it / what's
// wrong" in one glance: the document tile + invoice number name it, the dollar
// amount leads, status anchors the corner, blockers call the action.
function InvoiceCard({ inv, active, onClick }: { inv: InvoiceRecord; active: boolean; onClick: () => void }) {
  const total = invoiceTotal(inv);
  const blockers = blockerSummary(inv);
  const processing = inv.status === "processing";
  const invNo = inv.extracted?.metadata.invoice_number;
  const escalated = inv.escalated;
  const reason = escalated ? escalationReason(inv) : null;
  return (
    <button
      onClick={onClick}
      className={
        "group flex w-full animate-popIn items-start gap-3 rounded-card border bg-card p-3.5 text-left shadow-card transition-all hover:-translate-y-px hover:shadow-card-hover " +
        (active ? "border-accent/60 ring-1 ring-accent/20" : "border-line")
      }
    >
      <span
        className={
          "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border " +
          (escalated ? "border-accent-violet/30 bg-accent-violet/10 text-accent-violet" : TILE_TONE[inv.status])
        }
      >
        <Invoice size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-mono text-[12.5px] font-medium text-ink-2">{invNo ?? "Invoice"}</span>
            <span className="shrink-0 rounded bg-surface px-1 py-[1px] text-[11px] font-semibold uppercase tracking-[0.04em] text-muted-2">
              {inv.source.kind}
            </span>
          </span>
          {escalated ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-pill border border-accent-violet/40 bg-accent-violet/10 px-2 py-[3px] text-[12px] font-semibold uppercase tracking-[0.04em] text-accent-violet">
              <Escalate size={10} /> Escalated
            </span>
          ) : (
            <StatusPill status={inv.status} />
          )}
        </div>
        <div className="mt-1">
          {total != null ? (
            <span className="text-[19px] font-semibold tabular-nums tracking-tight text-ink">{money(total)}</span>
          ) : (
            <span className="text-[14px] font-medium text-muted-2">{processing ? STAGE_LABEL[inv.stage] + "…" : "Amount pending"}</span>
          )}
        </div>
        <div className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-muted-2">
          <span className="truncate">{cardContext(inv)}</span>
          <span className="text-line">·</span>
          <span className="shrink-0">{relativeTime(inv.created_at)}</span>
        </div>
        {escalated
          ? reason && (
              <div className="mt-2.5 flex max-w-full items-start gap-1.5 rounded-pill border border-accent-violet/40 bg-accent-violet/10 px-2 py-[3px] text-[12px] font-medium text-accent-violet">
                <span className="mt-[3px] shrink-0">
                  <Escalate size={10} />
                </span>
                <span className="truncate">{reason}</span>
              </div>
            )
          : blockers.count > 0 && (
              <div className="mt-2.5 inline-flex items-center gap-1.5 rounded-pill border border-accent-amber/40 bg-accent-amber/10 px-2 py-[3px] text-[12px] font-medium text-accent-amber">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-amber" />
                {blockers.count} blocker{blockers.count > 1 ? "s" : ""}
                <span className="text-accent-amber/70">· {blockers.label}</span>
              </div>
            )}
      </div>
    </button>
  );
}

// The one-line "who is this" under the title: resolved sponsor when known, the
// raw extracted name while held, the sender as a last resort.
function cardContext(inv: InvoiceRecord): string {
  if (inv.status === "processing") return STAGE_LABEL[inv.stage];
  const sponsor = inv.resolved?.sponsor.match?.name ?? inv.extracted?.metadata.sponsor_name;
  const site = inv.resolved?.site.match?.name ?? inv.extracted?.metadata.site_name;
  if (sponsor) return site ? `${sponsor} · ${site}` : sponsor;
  if (inv.source.email) return `from ${inv.source.email.from}`;
  return inv.source.filename;
}

export function StatusPill({ status }: { status: InvoiceRecord["status"] }) {
  return (
    <span
      className={
        "inline-flex shrink-0 items-center gap-1 rounded-pill border px-2 py-[3px] text-[12px] font-semibold uppercase tracking-[0.04em] " +
        STATUS_TONE[status]
      }
    >
      {status === "processing" && <Spinner size={9} />}
      {STATUS_LABEL[status]}
    </span>
  );
}

function HealthDot({ health }: { health: { ok: boolean; llm: boolean } | null }) {
  const ok = health?.ok && health.llm;
  const title = !health ? "connecting…" : !health.llm ? "ANTHROPIC_API_KEY not set" : "ready";
  return (
    <span className="hidden items-center gap-1.5 text-[12.5px] text-muted-2 sm:flex" title={title}>
      <span className={"h-1.5 w-1.5 rounded-full " + (ok ? "bg-accent-green" : "bg-accent-amber")} />
      {ok ? "ready" : "setup"}
    </span>
  );
}

// The "what matters / what next" surface shown before anything is selected — so
// the screen is never idle. Either tees up the most urgent invoice, or celebrates
// a cleared queue.
function QueueOverview({ lanes, stats, onSelect }: { lanes: Lanes; stats: Stats; onSelect: (id: string) => void }) {
  const top = lanes.needsYou[0];
  const atStake = queueValue(lanes.needsYou);
  return (
    <Card className="flex min-h-[calc(100vh-228px)] flex-col items-center justify-center px-6 py-16 text-center">
      <div className="flex w-full max-w-sm animate-riseIn flex-col items-center gap-6">
        <span
          className={
            "grid h-11 w-11 place-items-center rounded-card border " +
            (top ? "border-accent-amber/30 bg-accent-amber/10 text-accent-amber" : "border-accent-green/30 bg-accent-green/10 text-accent-green")
          }
        >
          {top ? <AlertGlyph /> : <Check size={20} />}
        </span>

        {top ? (
          <>
            <div className="space-y-1.5">
              <h2 className="text-balance text-[23px] font-semibold tracking-tight text-ink">
                {lanes.needsYou.length} invoice{lanes.needsYou.length > 1 ? "s need" : " needs"} your review
              </h2>
              <p className="text-[14.5px] text-muted">
                <span className="font-medium text-ink-2">{money(atStake)}</span> waiting · oldest {relativeTime(top.created_at)}
              </p>
            </div>
            <button
              onClick={() => onSelect(top.id)}
              className="group w-full rounded-card border border-line bg-card p-4 text-left shadow-card transition-all hover:-translate-y-px hover:border-accent/40 hover:shadow-card-hover"
            >
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-accent">
                Start here
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" className="transition-transform group-hover:translate-x-0.5" aria-hidden>
                  <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-[16.5px] font-semibold tabular-nums tracking-tight text-ink">
                  {invoiceTotal(top) != null ? money(invoiceTotal(top)) : "—"}
                </span>
                <StatusPill status={top.status} />
              </div>
              <div className="mt-1 truncate text-[13.5px] text-muted">{sourceLabel(top)}</div>
            </button>
          </>
        ) : (
          <div className="space-y-1.5">
            <h2 className="text-[23px] font-semibold tracking-tight text-ink">You're all caught up</h2>
            <p className="text-[14.5px] text-muted">Every invoice has been reviewed or cleared automatically.</p>
          </div>
        )}

        {stats.processed > 0 && (
          <div className="flex items-center gap-5 border-t border-line pt-5 text-[13.5px]">
            <OverviewStat value={`${stats.processed}`} label="processed" />
            <span className="h-7 w-px bg-line" />
            <OverviewStat value={`${Math.round(stats.autoRate * 100)}%`} label="auto-cleared" tone="text-accent-green" />
            <span className="h-7 w-px bg-line" />
            <OverviewStat value={fmtMinutes(stats.minutesSaved)} label="time saved" />
          </div>
        )}
      </div>
    </Card>
  );
}

function OverviewStat({ value, label, tone = "text-ink" }: { value: string; label: string; tone?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={"text-[18px] font-semibold tabular-nums " + tone}>{value}</span>
      <span className="text-[11.5px] uppercase tracking-[0.06em] text-muted-2">{label}</span>
    </div>
  );
}

function fmtMinutes(m: number): string {
  const r = Math.round(m);
  return r < 60 ? `${r} min` : `${(r / 60).toFixed(1)} hrs`;
}

function Onboarding({ onSeed, seeding, llm, error }: { onSeed: () => void; seeding: boolean; llm: boolean; error: string | null }) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center px-6 py-24 text-center">
      <div className="flex animate-riseIn flex-col items-center gap-5">
        <span className="grid h-12 w-12 place-items-center rounded-card border border-line bg-card text-accent shadow-card">
          <Sparkles size={20} />
        </span>
        <div className="space-y-2">
          <h1 className="text-balance text-[28px] font-semibold tracking-tight text-ink">Watch LedgerRun clear an inbox</h1>
          <p className="text-balance text-[15.5px] leading-relaxed text-muted">
            AI reads each emailed invoice, resolves sponsor / study / site, matches line items to the scoped catalog, and
            decides <span className="text-ink-2">submit</span> or <span className="text-ink-2">hold</span> — you just review
            what needs you.
          </p>
        </div>
        <div className="flex flex-col items-center gap-2.5">
          <Button onClick={onSeed} disabled={seeding} loading={seeding} icon={<Sparkles size={14} />} size="lg">
            {seeding ? "Processing…" : "Process the 4 sample invoices"}
          </Button>
          <span className="text-[13.5px] text-muted-2">No API key needed — or drop a .eml / .pdf anywhere</span>
        </div>
        {!llm && (
          <div className="rounded-card border border-accent-amber/40 bg-accent-amber/10 px-3 py-2 text-[13.5px] text-accent-amber">
            To ingest your own invoices live, set <span className="font-mono">ANTHROPIC_API_KEY</span> in{" "}
            <span className="font-mono">.env</span>.
          </div>
        )}
        {error && (
          <div className="rounded-card border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[13.5px] text-accent-red">{error}</div>
        )}
      </div>
    </div>
  );
}

function DropOverlay() {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-canvas/70 backdrop-blur-sm">
      <div className="animate-popIn rounded-card border-2 border-dashed border-accent/50 bg-card px-10 py-8 text-center shadow-pop">
        <div className="text-[16.5px] font-semibold text-ink">Drop to ingest</div>
        <div className="mt-1 text-[14px] text-muted">.eml email or .pdf invoice</div>
      </div>
    </div>
  );
}

function AlertGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5l9 15.5H3l9-15.5z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="0.6" fill="currentColor" stroke="currentColor" strokeWidth="0.8" />
    </svg>
  );
}

function UploadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 16V4m0 0L7 9m5-5l5 5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v1a2 2 0 002 2h12a2 2 0 002-2v-1" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}

function ResetIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12a8 8 0 108-8 8 8 0 00-5.7 2.4L4 8M4 4v4h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
