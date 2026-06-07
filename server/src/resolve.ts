import type {
  ExtractedInvoice,
  ReferenceSnapshot,
  ResolvedContext,
  Candidate,
  EntityResolutionProposal,
} from "@ledgerrun/contract";
import { rank, protocolEquals } from "./fuzzy.js";

// A candidate must score at least this well to be accepted as a confident match.
// Below it, the field resolves to null and the alternatives are surfaced for a
// human to pick — which (deterministically) forces a HOLD via `metadata_unresolved`.
export const ACCEPT = 0.6;

const round = (n: number) => Math.round(n * 100) / 100;
const confidence = (n: number) => round(Math.max(0, Math.min(1, n)));
const acceptable = (modelConfidence: number, referenceScore: number) =>
  modelConfidence >= ACCEPT && referenceScore >= ACCEPT;

function toCandidates<T extends { id: number; name: string }>(
  alts: { item: T; score: number }[],
): Candidate[] {
  return alts.map(({ item, score }) => ({ id: item.id, name: item.name, score: round(score) }));
}

/**
 * Deterministic metadata resolution over MCP-fetched reference candidates.
 * Sponsor first; studies are scoped to the resolved sponsor when possible.
 * Pure — given the same extraction + snapshot it always resolves identically,
 * which is what lets it run in the offline verify gate.
 */
export function resolveContextDeterministic(extracted: ExtractedInvoice, ref: ReferenceSnapshot): ResolvedContext {
  const meta = extracted.metadata;

  const sponsorRank = meta.sponsor_name
    ? rank(meta.sponsor_name, ref.sponsors, (s) => s.name)
    : { best: null, score: 0, alternatives: [] };
  const sponsor = sponsorRank.score >= ACCEPT ? sponsorRank.best : null;

  const studyPool = sponsor ? ref.studies.filter((s) => s.sponsor_id === sponsor.id) : ref.studies;
  const studyRank = meta.study_name
    ? rank(meta.study_name, studyPool, (s) => s.name)
    : { best: null, score: 0, alternatives: [] };
  const study = studyRank.score >= ACCEPT ? studyRank.best : null;
  const protocol_match =
    study && meta.protocol_number ? protocolEquals(study.protocol_number, meta.protocol_number) : null;

  const siteRank = meta.site_name
    ? rank(meta.site_name, ref.sites, (s) => s.name)
    : { best: null, score: 0, alternatives: [] };
  const site = siteRank.score >= ACCEPT ? siteRank.best : null;

  return {
    sponsor: { match: sponsor, confidence: round(sponsorRank.score), alternatives: toCandidates(sponsorRank.alternatives) },
    study: { match: study, confidence: round(studyRank.score), alternatives: toCandidates(studyRank.alternatives), protocol_match },
    site: { match: site, confidence: round(siteRank.score), alternatives: toCandidates(siteRank.alternatives) },
  };
}

/**
 * Validate an LLM entity-resolution proposal against MCP-fetched reference data.
 * The model can choose candidate IDs, but it cannot invent entities, override
 * sponsor scoping, or decide protocol equivalence.
 */
export function resolveContextFromProposal(
  extracted: ExtractedInvoice,
  ref: ReferenceSnapshot,
  proposal: EntityResolutionProposal,
): ResolvedContext {
  const meta = extracted.metadata;

  const sponsorRank = meta.sponsor_name
    ? rank(meta.sponsor_name, ref.sponsors, (s) => s.name)
    : { best: null, score: 0, alternatives: [] };
  const sponsorCandidate = proposal.sponsor.id == null ? null : ref.sponsors.find((s) => s.id === proposal.sponsor.id) ?? null;
  const sponsorScore = sponsorCandidate && meta.sponsor_name ? rank(meta.sponsor_name, [sponsorCandidate], (s) => s.name).score : 0;
  const sponsor = sponsorCandidate && acceptable(proposal.sponsor.confidence, sponsorScore) ? sponsorCandidate : null;

  const studyPool = sponsor ? ref.studies.filter((s) => s.sponsor_id === sponsor.id) : ref.studies;
  const studyRank = meta.study_name
    ? rank(meta.study_name, studyPool, (s) => s.name)
    : { best: null, score: 0, alternatives: [] };
  const studyCandidate = proposal.study.id == null ? null : studyPool.find((s) => s.id === proposal.study.id) ?? null;
  const studyScore = studyCandidate && meta.study_name ? rank(meta.study_name, [studyCandidate], (s) => s.name).score : 0;
  const study = studyCandidate && acceptable(proposal.study.confidence, studyScore) ? studyCandidate : null;
  const protocol_match =
    study && meta.protocol_number ? protocolEquals(study.protocol_number, meta.protocol_number) : null;

  const siteRank = meta.site_name
    ? rank(meta.site_name, ref.sites, (s) => s.name)
    : { best: null, score: 0, alternatives: [] };
  const siteCandidate = proposal.site.id == null ? null : ref.sites.find((s) => s.id === proposal.site.id) ?? null;
  const siteScore = siteCandidate && meta.site_name ? rank(meta.site_name, [siteCandidate], (s) => s.name).score : 0;
  const site = siteCandidate && acceptable(proposal.site.confidence, siteScore) ? siteCandidate : null;

  return {
    sponsor: {
      match: sponsor,
      confidence: sponsor ? confidence(proposal.sponsor.confidence) : 0,
      alternatives: toCandidates(sponsorRank.alternatives),
    },
    study: {
      match: study,
      confidence: study ? confidence(proposal.study.confidence) : 0,
      alternatives: toCandidates(studyRank.alternatives),
      protocol_match,
    },
    site: {
      match: site,
      confidence: site ? confidence(proposal.site.confidence) : 0,
      alternatives: toCandidates(siteRank.alternatives),
    },
  };
}

export const resolveContext = resolveContextDeterministic;
