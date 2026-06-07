import type { ReactNode } from "react";
import type { InvoiceRecord, ResolvedContext } from "@ledgerrun/contract";
import { money, pct, confidenceTone } from "../lib";
import { Sparkles, Cube, Bolt, Diamond, Check } from "./icons";

// The AI's work, made visible. Each stage's detail line is a pure read of the
// record as it fills in over the live stream — extraction count, resolved
// entities with confidence, match tally, decision — so watching an invoice
// process feels like watching something think, not like watching a spinner.
const STEP_FOR_STAGE: Record<InvoiceRecord["stage"], number> = {
  received: 0,
  extracting: 0,
  resolving: 1,
  matching: 2,
  deciding: 3,
  done: 4,
  failed: 4,
};

type BeatState = "done" | "active" | "pending";

export default function PipelineTheater({ invoice }: { invoice: InvoiceRecord }) {
  const current = STEP_FOR_STAGE[invoice.stage];
  const beats = buildBeats(invoice);
  return (
    <div className="animate-riseIn rounded-card border border-line bg-card p-5 shadow-card">
      <div className="mb-3.5 flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-breathe rounded-full bg-accent" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        <span className="text-[13.5px] font-semibold tracking-tight text-ink">AI is processing this invoice…</span>
      </div>
      <ol className="flex flex-col gap-0.5">
        {beats.map((b, i) => (
          <Beat key={b.label} {...b} state={i < current ? "done" : i === current ? "active" : "pending"} />
        ))}
      </ol>
    </div>
  );
}

function buildBeats(inv: InvoiceRecord): { icon: ReactNode; label: string; detail: ReactNode }[] {
  const ex = inv.extracted;
  const r = inv.resolved;
  const m = inv.matches;
  const matched = m?.filter((x) => x.status === "matched").length ?? 0;
  return [
    {
      icon: <Sparkles />,
      label: "Extract",
      detail: ex
        ? `${ex.line_items.length} line items · ${money(ex.metadata.total_amount)} total`
        : "Reading the invoice PDF…",
    },
    {
      icon: <Cube />,
      label: "Resolve",
      detail: r ? <ResolveDetail r={r} /> : "Identifying sponsor, study & site…",
    },
    {
      icon: <Bolt />,
      label: "Match",
      detail: m
        ? `${matched} of ${m.length} line items matched to the catalog`
        : "Matching line items to the billing catalog…",
    },
    {
      icon: <Diamond />,
      label: "Decide",
      detail: inv.decision ? inv.decision.rationale : "Weighing exceptions for submit vs hold…",
    },
  ];
}

function ResolveDetail({ r }: { r: ResolvedContext }) {
  const fields: [string, string | undefined, number][] = [
    ["Sponsor", r.sponsor.match?.name, r.sponsor.confidence],
    ["Study", r.study.match?.name, r.study.confidence],
    ["Site", r.site.match?.name, r.site.confidence],
  ];
  return (
    <span className="flex flex-wrap gap-1.5">
      {fields.map(([label, name, conf]) => (
        <span
          key={label}
          className="inline-flex items-center gap-1 rounded-pill border border-line bg-surface px-1.5 py-[2px] text-[12px]"
        >
          <span className="text-muted-2">{label}</span>
          {name ? (
            <>
              <span className="text-ink-2">{name}</span>
              <span className={confidenceTone(conf)}>{pct(conf)}</span>
            </>
          ) : (
            <span className="text-accent-red">unresolved</span>
          )}
        </span>
      ))}
    </span>
  );
}

function Beat({
  icon,
  label,
  detail,
  state,
}: {
  icon: ReactNode;
  label: string;
  detail: ReactNode;
  state: BeatState;
}) {
  return (
    <li
      className={
        "flex items-start gap-3 rounded-lg px-2 py-2 transition-colors duration-300 " +
        (state === "active" ? "bg-surface" : "")
      }
    >
      <span
        className={
          "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-all duration-300 " +
          (state === "done"
            ? "border-accent bg-accent text-white"
            : state === "active"
              ? "animate-breathe border-accent bg-accent/5 text-accent"
              : "border-line bg-card text-muted-2")
        }
      >
        {state === "done" ? <Check size={13} /> : icon}
      </span>
      <div className="min-w-0 pt-0.5">
        <div className={"text-[14px] font-semibold " + (state === "pending" ? "text-muted-2" : "text-ink")}>
          {label}
        </div>
        <div className={"mt-0.5 text-[13.5px] leading-relaxed " + (state === "pending" ? "text-muted-2" : "text-muted")}>
          {detail}
        </div>
      </div>
    </li>
  );
}
