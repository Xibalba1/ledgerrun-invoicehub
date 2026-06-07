import { useEffect, useState, type ReactNode } from "react";
import type {
  CatalogItem,
  InvoiceRecord,
  ReferenceSnapshot,
  ActionRequest,
  Candidate,
  ExceptionCode,
  LineItemMatch,
} from "@ledgerrun/contract";
import { api } from "./api";
import { money, pct, MATCH_TONE, MATCH_LABEL, sourceLabel, confidenceTone, invoiceTotal, escalationReason, EXCEPTION_TITLE } from "./lib";
import { useToast } from "./components/Toast";
import Card from "./components/Card";
import Button from "./components/Button";
import Modal from "./components/Modal";
import PipelineTheater from "./components/PipelineTheater";
import SourcePanel from "./components/SourcePanel";
import { Check, X, ArrowRight, Spinner, Escalate } from "./components/icons";

export default function InvoiceDetail({
  invoice,
  reference,
}: {
  invoice: InvoiceRecord;
  reference: ReferenceSnapshot | null;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [showSource, setShowSource] = useState(false);

  const sponsorId = invoice.resolved?.sponsor.match?.id;
  const studyId = invoice.resolved?.study.match?.id;

  useEffect(() => {
    if (sponsorId && studyId) api.catalog(sponsorId, studyId).then(setCatalog).catch(() => setCatalog([]));
    else setCatalog([]);
  }, [sponsorId, studyId]);

  async function act(action: ActionRequest) {
    const prevStatus = invoice.status;
    setBusy(true);
    setErr(null);
    try {
      const updated = await api.action(invoice.id, action);
      if (prevStatus !== "submitted" && updated.status === "submitted") {
        toast.success(updated.submitted_by === "human" ? "Submitted to ClinRun" : "Cleared — auto-submitted to ClinRun");
      }
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    } finally {
      setBusy(false);
    }
  }

  const m = invoice.extracted?.metadata;
  const r = invoice.resolved;
  const total = invoiceTotal(invoice);
  const inFlight = invoice.stage !== "done" && invoice.stage !== "failed";

  const analysis = (
    <div className="flex flex-col gap-4">
      {busy && (
        <div className="flex animate-fadeIn items-center gap-2.5 rounded-card border border-accent/40 bg-accent/10 px-4 py-3 text-[13.5px] font-medium text-ink-2">
          <span className="text-accent">
            <Spinner size={15} />
          </span>
          Applying your change — re-running the AI match. This can take a few seconds.
        </div>
      )}

      {invoice.stage === "failed" ? (
        <div className="rounded-card border border-accent-red/30 bg-accent-red/5 px-4 py-3 text-[14px] text-accent-red">
          Pipeline failed: {invoice.error}
        </div>
      ) : inFlight ? (
        <PipelineTheater invoice={invoice} />
      ) : null}

      {err && (
        <div className="rounded-card border border-accent-red/30 bg-accent-red/5 px-3 py-2 text-[13.5px] text-accent-red">{err}</div>
      )}

      {invoice.decision && <VerdictHero key={invoice.status} invoice={invoice} />}

      {invoice.decision && invoice.decision.exceptions.length > 0 && (
        <Card padded={false} className="overflow-hidden">
          <SectionLabel>What&apos;s blocking</SectionLabel>
          <ul className="divide-y divide-line-2">
            {invoice.decision.exceptions.map((e, i) => (
              <li key={i} className="flex items-start gap-3 px-5 py-3">
                <span
                  className={
                    "mt-[3px] grid h-4 w-4 shrink-0 place-items-center rounded-full " +
                    (e.severity === "block" ? "bg-accent-red/15 text-accent-red" : "bg-accent-amber/15 text-accent-amber")
                  }
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[14px] font-semibold text-ink">{EXCEPTION_TITLE[e.code]}</span>
                    <span
                      className={
                        "rounded-pill px-1.5 py-[1px] text-[11px] font-semibold uppercase tracking-[0.05em] " +
                        (e.severity === "block" ? "bg-accent-red/10 text-accent-red" : "bg-accent-amber/15 text-accent-amber")
                      }
                    >
                      {e.severity === "block" ? "blocks" : "warning"}
                    </span>
                  </div>
                  <BlockerVisual code={e.code} message={e.message} invoice={invoice} />
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {m && r && (
        <Card padded={false}>
          <SectionLabel>Metadata &amp; resolution</SectionLabel>
          <div className="divide-y divide-line-2">
            <MetaRow
              label="Sponsor"
              extracted={m.sponsor_name}
              match={r.sponsor.match?.name}
              confidence={r.sponsor.confidence}
              alternatives={r.sponsor.alternatives}
              options={reference?.sponsors.map((s) => ({ id: s.id, name: s.name }))}
              current={r.sponsor.match?.id}
              busy={busy}
              onPick={(id) => act({ type: "correct_metadata", sponsor_id: id })}
            />
            <MetaRow
              label="Study"
              extracted={m.study_name}
              match={r.study.match?.name}
              confidence={r.study.confidence}
              alternatives={r.study.alternatives}
              options={reference?.studies.map((s) => ({ id: s.id, name: `${s.name} · ${s.protocol_number}` }))}
              current={r.study.match?.id}
              busy={busy}
              onPick={(id) => act({ type: "correct_metadata", study_id: id })}
              note={
                m.protocol_number ? (
                  <span className={"inline-flex items-center gap-1 " + (r.study.protocol_match === false ? "text-accent-red" : "text-accent-green")}>
                    {r.study.protocol_match === false ? <X size={10} /> : <Check size={10} />}
                    <span className="font-mono text-[12px]">{m.protocol_number}</span>
                  </span>
                ) : null
              }
            />
            <MetaRow
              label="Site"
              extracted={m.site_name}
              match={r.site.match?.name}
              confidence={r.site.confidence}
              alternatives={r.site.alternatives}
              options={reference?.sites.map((s) => ({ id: s.id, name: s.name }))}
              current={r.site.match?.id}
              busy={busy}
              onPick={(id) => act({ type: "correct_metadata", site_id: id })}
            />
          </div>
        </Card>
      )}

      {invoice.matches && invoice.matches.length > 0 && (
        <Card padded={false} className="overflow-hidden">
          <SectionLabel>
            Line items <span className="text-muted-2">· {invoice.matches.length}</span>
          </SectionLabel>
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px]">
              <thead>
                <tr className="border-y border-line-2 text-left text-[11.5px] uppercase tracking-[0.06em] text-muted-2">
                  <th className="px-5 py-2 font-semibold">Description</th>
                  <th className="px-2 py-2 text-right font-semibold">Qty</th>
                  <th className="px-2 py-2 text-right font-semibold">Unit</th>
                  <th className="px-3 py-2 font-semibold">Matched catalog</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 text-right font-semibold">Conf</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line-2">
                {invoice.matches.map((mt, i) => (
                  <tr key={i} className="group align-top hover:bg-surface/60">
                    <td className="px-5 py-2.5 text-ink-2">
                      {mt.line.description}
                      {mt.reason && (
                        <div className="mt-0.5 text-[12px] leading-snug text-muted-2 opacity-0 transition-opacity group-hover:opacity-100">
                          {mt.reason}
                        </div>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted">{mt.line.quantity}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted">{money(mt.line.unit_price)}</td>
                    <td className="px-3 py-2.5">
                      <CatalogSelect
                        catalog={catalog}
                        value={mt.catalog_item?.item_code ?? ""}
                        disabled={busy}
                        onChange={(code) => act({ type: "correct_match", line_index: i, item_code: code })}
                      />
                      {mt.price_delta != null && mt.price_delta !== 0 && (
                        <div className="mt-0.5 text-[12px] text-accent-amber">
                          Δ {money(mt.price_delta)} vs {money(mt.catalog_item?.unit_price)}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={"inline-flex rounded-pill border px-2 py-[2px] text-[11.5px] font-medium " + MATCH_TONE[mt.status]}>
                        {MATCH_LABEL[mt.status]}
                      </span>
                    </td>
                    <td className={"px-3 py-2.5 text-right tabular-nums " + confidenceTone(mt.confidence)}>{pct(mt.confidence)}</td>
                  </tr>
                ))}
              </tbody>
              <LineItemTotals matches={invoice.matches} invoiceTotal={total} />
            </table>
          </div>
        </Card>
      )}

      {invoice.qc_actions.length > 0 && (
        <Card padded={false}>
          <SectionLabel>Audit trail</SectionLabel>
          <ul className="divide-y divide-line-2">
            {invoice.qc_actions.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 px-5 py-2 text-[13px]">
                <span className="text-muted">
                  <span className="font-mono text-[12px] uppercase tracking-[0.04em] text-muted-2">{a.type}</span> {a.detail}
                </span>
                <span className="shrink-0 text-muted-2">{new Date(a.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {!inFlight && <ActionBar invoice={invoice} busy={busy} onAct={act} />}
    </div>
  );

  return (
    <div className="flex flex-col gap-4 pb-2">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="truncate text-[18px] font-semibold tracking-tight">{sourceLabel(invoice)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[13px] text-muted-2">
            {total != null && <span className="text-[13.5px] font-semibold tabular-nums text-ink-2">{money(total)}</span>}
            {m?.invoice_number && <span className="font-mono">{m.invoice_number}</span>}
            {m?.invoice_date && <span>{m.invoice_date}</span>}
            {invoice.source.email && <span className="truncate">from {invoice.source.email.from}</span>}
          </div>
        </div>
        <SourceToggle on={showSource} onClick={() => setShowSource((s) => !s)} />
      </div>

      {showSource ? (
        <div className="grid items-start gap-4 xl:grid-cols-[1fr_minmax(360px,420px)]">
          {analysis}
          <div className="xl:sticky xl:top-[84px]">
            <SourcePanel invoice={invoice} />
          </div>
        </div>
      ) : (
        analysis
      )}
    </div>
  );
}

// Lead the analysis with the AI's call — what it decided, in plain language, and
// (when held) the one move left to the human. This is the "what matters" anchor.
function VerdictHero({ invoice }: { invoice: InvoiceRecord }) {
  const d = invoice.decision!;
  const submitted = invoice.status === "submitted";
  const escalated = invoice.escalated;
  const blockers = d.exceptions.filter((e) => e.severity === "block").length;
  const reason = escalationReason(invoice);

  const tone = submitted
    ? { wrap: "border-accent-green/40 bg-accent-green/10", chip: "bg-accent-green/15 text-accent-green", text: "text-accent-green" }
    : escalated
      ? { wrap: "border-accent-violet/40 bg-accent-violet/10", chip: "bg-accent-violet/15 text-accent-violet", text: "text-accent-violet" }
      : { wrap: "border-accent-amber/40 bg-accent-amber/10", chip: "bg-accent-amber/15 text-accent-amber", text: "text-accent-amber" };

  return (
    <div className={"animate-revealIn overflow-hidden rounded-card border " + tone.wrap}>
      <div className="flex items-start gap-3.5 px-5 py-4">
        <span className={"mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full " + tone.chip}>
          {submitted ? <Check size={16} /> : escalated ? <Escalate size={15} /> : <AlertGlyph />}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={"text-[15.5px] font-semibold tracking-tight " + tone.text}>
              {submitted ? "Submitted to ClinRun" : escalated ? "Escalated — awaiting external resolution" : "Held for your review"}
            </span>
            {invoice.submitted_by && (
              <span className="rounded-pill bg-card px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-[0.05em] text-muted-2">
                by {invoice.submitted_by}
              </span>
            )}
          </div>
          {escalated && reason ? (
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">
              <span className="text-muted-2">Reason: </span>
              {reason}
            </p>
          ) : (
            <p className="mt-1 text-[14px] leading-relaxed text-ink-2">{d.rationale}</p>
          )}
          {escalated ? (
            <p className="mt-1.5 text-[13px] text-muted">
              Handed off outside LedgerRun — it stays here for tracking until resolved.
            </p>
          ) : !submitted && blockers > 0 ? (
            <p className="mt-1.5 text-[13px] text-muted">
              Resolve {blockers} blocker{blockers > 1 ? "s" : ""} below, or submit anyway.
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// The persistent decision toolbar: one dominant action, the rest recede. Pinned
// to the bottom of the analysis column so "what do I do next" is always in reach.
function ActionBar({ invoice, busy, onAct }: { invoice: InvoiceRecord; busy: boolean; onAct: (a: ActionRequest) => void }) {
  const held = invoice.status === "held";
  const submitted = invoice.status === "submitted";
  const failed = invoice.stage === "failed";
  const escalated = invoice.escalated;
  const blockers = invoice.decision?.exceptions.filter((e) => e.severity === "block").length ?? 0;
  const [escalating, setEscalating] = useState(false);

  return (
    <div className="sticky bottom-4 z-20 mt-1">
      <div className="flex items-center gap-2 rounded-card border border-line bg-card/85 px-3 py-2.5 shadow-pop backdrop-blur-xl">
        <span className="mr-auto flex items-center gap-2 pl-1 text-[13.5px]">
          {busy ? (
            <>
              <span className="text-accent">
                <Spinner size={14} />
              </span>
              <span className="font-medium text-ink-2">Applying…</span>
            </>
          ) : failed ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-accent-red" />
              <span className="font-medium text-accent-red">Pipeline failed</span>
            </>
          ) : submitted ? (
            <>
              <span className="text-accent-green">
                <Check size={13} />
              </span>
              <span className="font-medium text-ink-2">Submitted to ClinRun</span>
            </>
          ) : escalated ? (
            <>
              <span className="text-accent-violet">
                <Escalate size={13} />
              </span>
              <span className="font-medium text-ink-2">Escalated · awaiting external resolution</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-accent-amber" />
              <span className="font-medium text-ink-2">
                Held{blockers > 0 ? ` · ${blockers} blocker${blockers > 1 ? "s" : ""}` : ""}
              </span>
            </>
          )}
        </span>

        <Button variant="ghost" icon={<Escalate size={13} />} onClick={() => setEscalating(true)} disabled={busy || escalated}>
          {escalated ? "Escalated" : "Escalate"}
        </Button>
        <Button variant="secondary" icon={<Refresh />} onClick={() => onAct({ type: "rerun" })} disabled={busy}>
          Re-run
        </Button>
        {failed ? (
          <Button size="lg" icon={<Refresh />} loading={busy} onClick={() => onAct({ type: "rerun" })}>
            Retry pipeline
          </Button>
        ) : held ? (
          <Button size="lg" icon={<Check size={14} />} loading={busy} onClick={() => onAct({ type: "submit" })}>
            Submit anyway
          </Button>
        ) : null}
      </div>

      {escalating && (
        <EscalateDialog
          onClose={() => setEscalating(false)}
          onConfirm={(reason) => {
            onAct({ type: "escalate", reason });
            setEscalating(false);
          }}
        />
      )}
    </div>
  );
}

const ESCALATION_REASONS = [
  "Billed price exceeds catalog — needs contract amendment",
  "Query back to site for a corrected invoice",
  "Catalog/budget is out of date",
];

// Escalation is a deliberate hand-off, not a one-click flag: capturing why is what
// makes the Escalated lane a worklist the next person can act on cold.
function EscalateDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  return (
    <Modal onClose={onClose}>
      <div className="w-[440px] max-w-[80vw]">
        <div className="flex items-center gap-2.5">
          <span className="grid h-7 w-7 place-items-center rounded-full bg-accent-violet/15 text-accent-violet">
            <Escalate size={14} />
          </span>
          <h3 className="text-[16px] font-semibold tracking-tight text-ink">Escalate this invoice</h3>
        </div>
        <p className="mt-2.5 text-[13.5px] leading-relaxed text-muted">
          It leaves your review queue and moves to <span className="font-medium text-accent-violet">Escalated</span> — handed off
          for resolution outside LedgerRun (contract amendment, sponsor query, budget fix). Note why, so whoever picks it up has
          the context.
        </p>
        <textarea
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          placeholder="Why can't this be resolved here?"
          className="mt-3 w-full resize-none rounded-card border border-line bg-card px-3 py-2 text-[13.5px] leading-relaxed text-ink placeholder:text-muted-2 focus:border-accent-violet/50 focus:outline-none focus:ring-1 focus:ring-accent-violet/30"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {ESCALATION_REASONS.map((r) => (
            <button
              key={r}
              onClick={() => setReason(r)}
              className="rounded-pill border border-line bg-card px-2.5 py-1 text-[12px] text-muted transition-colors hover:border-accent-violet/40 hover:text-ink-2"
            >
              {r}
            </button>
          ))}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button icon={<Escalate size={13} />} disabled={!reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Escalate
          </Button>
        </div>
      </div>
    </Modal>
  );
}

function LineItemTotals({ matches, invoiceTotal }: { matches: InvoiceRecord["matches"]; invoiceTotal: number | null }) {
  if (!matches) return null;
  const sum = matches.reduce((s, mt) => {
    const line = mt.line.amount ?? (mt.line.unit_price != null ? mt.line.unit_price * mt.line.quantity : 0);
    return s + line;
  }, 0);
  const mismatch = invoiceTotal != null && Math.abs(sum - invoiceTotal) > 0.01;
  return (
    <tfoot>
      <tr className="border-t border-line text-[13px]">
        <td className="px-5 py-2.5 font-medium text-muted" colSpan={4}>
          Line items total
          {mismatch && <span className="ml-2 text-accent-amber">doesn&apos;t match invoice {money(invoiceTotal)}</span>}
        </td>
        <td className="px-3 py-2.5 text-right font-semibold tabular-nums text-ink" colSpan={2}>
          <span className={mismatch ? "text-accent-amber" : ""}>{money(sum)}</span>
        </td>
      </tr>
    </tfoot>
  );
}

// Why this is blocked, shown not told. Each visual is built from the typed
// record — resolved protocols, line-item matches, price deltas — so the eye lands
// on exactly what doesn't match instead of reading a sentence to find it. Falls
// back to the prose message only when the structured data isn't present.
function BlockerVisual({ code, message, invoice }: { code: ExceptionCode; message: string; invoice: InvoiceRecord }) {
  const m = invoice.extracted?.metadata;
  const r = invoice.resolved;
  const matches = invoice.matches ?? [];

  if (code === "protocol_mismatch" && m?.protocol_number && r?.study.match?.protocol_number) {
    return (
      <div className="mt-2 space-y-1">
        <DiffRow label="Invoice" value={m.protocol_number} other={r.study.match.protocol_number} tone="bad" />
        <DiffRow label="Study" value={r.study.match.protocol_number} other={m.protocol_number} tone="good" sub={r.study.match.name} />
      </div>
    );
  }

  if (code === "price_mismatch") {
    const rows = matches.filter((mt) => mt.status === "price_mismatch" || (mt.price_delta != null && mt.price_delta !== 0));
    if (rows.length) {
      return (
        <div className="mt-2 space-y-1.5">
          {rows.map((mt, i) => (
            <PriceRow key={i} mt={mt} />
          ))}
        </div>
      );
    }
  }

  if (code === "unmatched_line_items") {
    const rows = matches.filter((mt) => mt.status === "unmatched");
    if (rows.length) {
      return (
        <ul className="mt-2 space-y-1">
          {rows.map((mt, i) => (
            <li key={i} className="flex items-center gap-2 text-[13.5px]">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent-red/70" />
              <span className="truncate text-ink-2">{mt.line.description}</span>
              <span className="ml-auto shrink-0 rounded-pill bg-accent-red/10 px-1.5 py-0.5 text-[11.5px] font-medium text-accent-red">
                no catalog match
              </span>
            </li>
          ))}
        </ul>
      );
    }
  }

  if (code === "low_confidence_match") {
    const rows = matches.filter((mt) => mt.status === "low_confidence");
    if (rows.length) {
      return (
        <ul className="mt-2 space-y-1">
          {rows.map((mt, i) => (
            <li key={i} className="flex items-center gap-2 text-[13.5px]">
              <span className="truncate text-ink-2">{mt.line.description}</span>
              {mt.catalog_item && <span className="shrink-0 font-mono text-[12.5px] text-muted-2">→ {mt.catalog_item.item_code}</span>}
              <span className={"ml-auto shrink-0 tabular-nums " + confidenceTone(mt.confidence)}>{pct(mt.confidence)} conf</span>
            </li>
          ))}
        </ul>
      );
    }
  }

  if (code === "total_mismatch" && m?.total_amount != null) {
    const sum = matches.reduce(
      (s, mt) => s + (mt.line.amount ?? (mt.line.unit_price != null ? mt.line.unit_price * mt.line.quantity : 0)),
      0,
    );
    return (
      <Compare
        leftLabel="line items"
        left={money(sum)}
        rightLabel="invoice"
        right={money(m.total_amount)}
        delta={`Δ ${money(Math.abs(m.total_amount - sum))}`}
      />
    );
  }

  if (code === "metadata_unresolved" && r) {
    const fields: [string, boolean][] = [
      ["Sponsor", r.sponsor.match != null],
      ["Study", r.study.match != null],
      ["Site", r.site.match != null],
    ];
    return (
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
        <span className="text-muted-2">Needs your selection:</span>
        {fields
          .filter(([, ok]) => !ok)
          .map(([label]) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 rounded-pill border border-accent-red/30 bg-accent-red/10 px-2 py-[2px] text-[12.5px] text-accent-red"
            >
              <X size={9} /> {label}
            </span>
          ))}
      </div>
    );
  }

  return <p className="mt-0.5 text-[14px] leading-relaxed text-muted">{message}</p>;
}

// Two strings aligned character-by-character; the positions that differ light up,
// so "NWD-VER-2024-002" vs "…2023…" shows you the one digit that's wrong.
function DiffRow({ label, value, other, tone, sub }: { label: string; value: string; other: string; tone: "bad" | "good"; sub?: string }) {
  const hit =
    tone === "bad" ? "rounded-[3px] bg-accent-red/15 px-[1px] font-semibold text-accent-red" : "rounded-[3px] bg-accent-green/15 px-[1px] font-semibold text-accent-green";
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-12 shrink-0 text-[11px] font-semibold uppercase tracking-[0.05em] text-muted-2">{label}</span>
      <span className="font-mono text-[14px] tracking-tight">
        {[...value].map((ch, i) => (
          <span key={i} className={other[i] !== ch ? hit : "text-ink-2"}>
            {ch}
          </span>
        ))}
      </span>
      {sub && <span className="truncate text-[12.5px] text-muted-2">{sub}</span>}
    </div>
  );
}

function PriceRow({ mt }: { mt: LineItemMatch }) {
  return (
    <div className="rounded-lg border border-line bg-surface/40 px-2.5 py-1.5">
      <div className="truncate text-[13px] font-medium text-ink-2">{mt.line.description}</div>
      <Compare
        className="mt-1"
        leftLabel="billed"
        left={money(mt.line.unit_price)}
        rightLabel="catalog"
        right={money(mt.catalog_item?.unit_price)}
        delta={mt.price_delta != null ? `${mt.price_delta > 0 ? "+" : ""}${money(mt.price_delta)}` : undefined}
      />
    </div>
  );
}

// The shared "billed value → reference value (Δ)" comparison: the off value in
// amber, the reference in ink, the delta as a pill — readable at a glance.
function Compare({
  leftLabel,
  left,
  rightLabel,
  right,
  delta,
  className = "",
}: {
  leftLabel: string;
  left: string;
  rightLabel: string;
  right: string;
  delta?: string;
  className?: string;
}) {
  return (
    <div className={"flex items-center gap-2 text-[13.5px] tabular-nums " + className}>
      <span className="text-[11.5px] uppercase tracking-[0.04em] text-muted-2">{leftLabel}</span>
      <span className="font-semibold text-accent-amber">{left}</span>
      <span className="text-muted-2">
        <ArrowRight size={12} />
      </span>
      <span className="text-[11.5px] uppercase tracking-[0.04em] text-muted-2">{rightLabel}</span>
      <span className="font-semibold text-ink">{right}</span>
      {delta && (
        <span className="ml-auto rounded-pill bg-accent-amber/15 px-1.5 py-0.5 text-[12.5px] font-semibold text-accent-amber">{delta}</span>
      )}
    </div>
  );
}

function MetaRow({
  label,
  extracted,
  match,
  confidence,
  alternatives,
  options,
  current,
  busy,
  onPick,
  note,
}: {
  label: string;
  extracted: string | null | undefined;
  match: string | undefined;
  confidence: number;
  alternatives: Candidate[];
  options?: { id: number; name: string }[];
  current?: number;
  busy: boolean;
  onPick: (id: number) => void;
  note?: ReactNode;
}) {
  const resolved = match != null;
  const needsAttention = !resolved || confidence < 0.85;
  // Ranked candidates the system already scored — the one-tap correction path,
  // minus whatever is already selected.
  const picks = needsAttention ? alternatives.filter((a) => a.id !== current).slice(0, 3) : [];
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 px-5 py-3">
      <div className="pt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-muted-2">{label}</div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[14.5px] text-ink">{extracted || <span className="text-muted-2">—</span>}</span>
          {resolved ? (
            <span className="inline-flex items-center gap-1.5 rounded-pill border border-accent-green/30 bg-accent-green/10 px-2 py-[2px] text-[12.5px] text-accent-green">
              <Check size={10} /> {match} · {pct(confidence)}
            </span>
          ) : (
            <span className="rounded-pill border border-accent-red/30 bg-accent-red/10 px-2 py-[2px] text-[12.5px] text-accent-red">unresolved</span>
          )}
          {note}
        </div>
        {picks.length > 0 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[11.5px] uppercase tracking-[0.06em] text-muted-2">Did you mean</span>
            {picks.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                onClick={() => onPick(p.id)}
                className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-card px-2 py-[3px] text-[12.5px] text-ink-2 transition hover:-translate-y-px hover:border-accent/40 hover:bg-surface active:scale-[0.97] disabled:opacity-50"
              >
                {p.name}
                <span className={confidenceTone(p.score)}>{pct(p.score)}</span>
              </button>
            ))}
          </div>
        )}
        {options && (
          <div className="mt-1.5">
            <select
              className="max-w-full rounded-lg border border-line bg-card px-2 py-1 text-[13.5px] text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
              value={current ?? ""}
              disabled={busy}
              onChange={(e) => e.target.value && onPick(Number(e.target.value))}
            >
              <option value="">{resolved ? "Reassign…" : "Browse all…"}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </div>
  );
}

function CatalogSelect({
  catalog,
  value,
  disabled,
  onChange,
}: {
  catalog: CatalogItem[];
  value: string;
  disabled: boolean;
  onChange: (code: string | null) => void;
}) {
  if (catalog.length === 0)
    return <span className="text-[13px] text-muted-2">{value || <span className="text-accent-red">unmatched</span>}</span>;
  return (
    <select
      className="w-full max-w-[260px] rounded-lg border border-line bg-card px-2 py-1 text-[13.5px] text-ink-2 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value || null)}
    >
      <option value="">— unmatched —</option>
      {catalog.map((c) => (
        <option key={c.item_code} value={c.item_code}>
          {c.item_code} · {c.description} ({money(c.unit_price)})
        </option>
      ))}
    </select>
  );
}

// The source document is folded away by default; this is the obvious handle that
// slides it out on the right. The panel glyph fills on the open side and the
// chevron flips, so the button reads as a real toggle, not a static label.
function SourceToggle({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={
        "group inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[14px] font-medium transition " +
        (on ? "border-accent/50 bg-accent/5 text-ink" : "border-line bg-card text-ink-2 hover:border-accent/40 hover:bg-surface hover:text-ink")
      }
      title={on ? "Hide the source invoice" : "Show the original invoice document"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
        <line x1="14.5" y1="4.5" x2="14.5" y2="19.5" stroke="currentColor" strokeWidth="1.8" />
        {on && <rect x="14.5" y="4.5" width="6.5" height="15" rx="2.5" fill="currentColor" opacity="0.16" />}
      </svg>
      {on ? "Hide source" : "Show source invoice"}
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden
        className={"text-muted-2 transition-transform duration-200 " + (on ? "rotate-180" : "")}
      >
        <path d="M15 6l-6 6 6 6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function SectionLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={"px-5 py-2.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-2 " + className}>{children}</div>
  );
}

function AlertGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 3.5l9 15.5H3l9-15.5z" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M12 10v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="0.55" fill="currentColor" stroke="currentColor" strokeWidth="0.9" />
    </svg>
  );
}

function Refresh() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M20 11a8 8 0 10-1.6 5.6M20 5v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
