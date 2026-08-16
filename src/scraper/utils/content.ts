import type { NewsItem } from "@/lib/core/types";
import { contentFingerprint } from "@/lib/utils/corroboration";

export const MAX_STORED_DESCRIPTION_CHARS = 2_000;
export const MAX_STORED_TITLE_CHARS = 500;
export const LOW_SIGNAL_RETENTION_DAYS = 180;

const TRACKING_PARAMETER_NAMES = new Set([
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "igshid",
  "vero_id",
]);

const STRONG_EVENT_TERMS = /\b(?:attack(?:ed|s)?|airstrike|missile|drone|bomb(?:ing|ed)?|explosion|blast|shooting|killed|wounded|casualt(?:y|ies)|earthquake|tsunami|flood(?:ing|ed)?|wildfire|landslide|eruption|hurricane|cyclone|typhoon|tornado|evacuat(?:e|ed|ion)|emergency|outbreak|epidemic|pandemic|disease|virus|collapse|crash|collision|derail(?:ment|ed)?|shipwreck|outage|blackout|shutdown|disruption|protest|riot|coup|arrest(?:ed|s)?|detain(?:ed|s)?|sanction(?:ed|s)?|ceasefire|invasion|incursion|deploy(?:ed|ment|s)?|mobiliz(?:e|ed|ation)|strike|election|referendum|law|ban(?:ned|s)?|blockade|hostage|kidnap(?:ped|s)?|assassinat(?:ed|ion)|cyberattack|breach|hack(?:ed|ing)?|fire)\b/i;

const OBVIOUS_NON_EVENT_PATTERNS = [
  /\b(?:daily|weekly) horoscope\b/i,
  /\bcrossword (?:answers?|clues?)\b/i,
  /\b(?:recipe|recipes)\b.*\b(?:make|cook|bake|ingredients?)\b/i,
  /\b(?:best deals?|coupon codes?|promo codes?)\b/i,
  /\b(?:hands[- ]on|product review|phone review|laptop review)\b/i,
  /\bhow to (?:watch|stream)\b/i,
  /\b(?:betting odds|match odds|fantasy football)\b/i,
  /\b(?:transfer rumours?|starting lineup|match preview|live score)\b/i,
];

// Recurring editorial products are useful content, but they are not discrete
// events and their date variants are especially prone to semantic chaining.
const RECURRING_EDITORIAL_TITLE_PATTERNS = [
  /\b(?:daily|morning|evening|nightly|weekly)\s+(?:brief|briefing|digest|roundup|recap|headlines?)\b/i,
  /\bnightlife\s+(?:tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b.*\b(?:january|february|march|april|may|june|july|august|september|october|november|december|20\d{2})\b/i,
  /\btoday in (?:[\p{L}\p{N}]+\s+){0,3}history\b/iu,
  /\btop headlines\b/i,
  /\bconference-by-conference\b.*\b(?:leaders|rankings)\b/i,
  /\b(?:football|basketball|baseball|hockey|soccer|cricket)\b.*\breturning\b.*\b(?:stat(?:istic)?\s+)?leaders\b/i,
  /\bmost expensive homes sold\b/i,
  /\bwhat(?:'|’)s on\b.*\b(?:today|tonight|week|weekend)\b/i,
];

const TEMPORAL_TITLE_MARKER = /\b(?:today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|20\d{2}|\d{1,2}(?:st|nd|rd|th)?)\b/i;
const TEMPORAL_TEMPLATE_PARTS = /\b(?:today|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december|20\d{2}|\d{1,2}(?:st|nd|rd|th)?)\b/gi;

const LOW_SIGNAL_ARCHIVE_PATTERNS = /\b(?:analysis|commentary|opinion|interview|explainer|podcast|newsletter|thread|what to know|five things|takeaways?)\b/i;

const BOILERPLATE_LINE = /^(?:advertisement|sponsored content|sign up for (?:our|the) newsletter|subscribe (?:now|to continue|for more)|follow us on|read more:?|click here|all rights reserved|copyright \d{4}|download (?:our|the) app)\b/i;

function coerceFeedText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map(coerceFeedText).filter(Boolean).join(" ");
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["_", "#text", "text", "value"]) {
      const text = coerceFeedText(record[key]);
      if (text) return text;
    }
  }
  return "";
}

export function canonicalizeEventUrl(rawUrl: unknown): string {
  const input = coerceFeedText(rawUrl).trim();
  if (!input) return "";

  try {
    const url = new URL(input);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";

    url.hostname = url.hostname.toLowerCase();
    url.hash = "";

    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith("utm_") || TRACKING_PARAMETER_NAMES.has(normalized)) {
        url.searchParams.delete(key);
      }
    }

    if (url.pathname !== "/") {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.toString();
  } catch {
    return "";
  }
}

export function cleanAndCapTitle(title: unknown): string {
  const rawTitle = coerceFeedText(title);
  if (!rawTitle) return "";

  const codePoints = rawTitle[Symbol.iterator]();
  let bounded = "";
  let length = 0;
  while (length < MAX_STORED_TITLE_CHARS) {
    const next = codePoints.next();
    if (next.done) break;
    bounded += next.value;
    length += 1;
  }
  return bounded.replace(/\s+/g, " ").trim();
}

export function normalizeTitleFingerprint(title: string): string {
  return contentFingerprint(title);
}

export function recurringTemplateFingerprint(title: string): string {
  return normalizeTitleFingerprint(title.replace(TEMPORAL_TEMPLATE_PARTS, " "));
}

/** Prevents successive dated editions from becoming one endlessly refreshed event. */
export function isRecurringTemplatePair(firstTitle: string, secondTitle: string): boolean {
  const first = normalizeTitleFingerprint(firstTitle);
  const second = normalizeTitleFingerprint(secondTitle);
  if (!first || !second || first === second) return false;
  if (!TEMPORAL_TITLE_MARKER.test(firstTitle) || !TEMPORAL_TITLE_MARKER.test(secondTitle)) return false;

  const firstTemplate = recurringTemplateFingerprint(firstTitle);
  const secondTemplate = recurringTemplateFingerprint(secondTitle);
  return firstTemplate.length >= 12 && firstTemplate === secondTemplate;
}

export function cleanAndCapDescription(description?: unknown): string {
  const rawDescription = coerceFeedText(description);
  if (!rawDescription) return "";

  const normalized = rawDescription
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t ]+/g, " ")
    .trim();

  const keptLines: string[] = [];
  for (const rawLine of normalized.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (BOILERPLATE_LINE.test(line) && keptLines.join(" ").length >= 80) break;
    if (/^(?:[-=_*•]\s*){4,}$/.test(line)) continue;
    keptLines.push(line);
  }

  const cleaned = keptLines.join(" ").replace(/\s+/g, " ").trim();
  if (cleaned.length <= MAX_STORED_DESCRIPTION_CHARS) return cleaned;

  const candidate = cleaned.slice(0, MAX_STORED_DESCRIPTION_CHARS - 1);
  const lastBoundary = Math.max(
    candidate.lastIndexOf(". "),
    candidate.lastIndexOf("! "),
    candidate.lastIndexOf("? "),
  );
  const cut = lastBoundary >= 1_200 ? candidate.slice(0, lastBoundary + 1) : candidate;
  return `${cut.trimEnd()}…`;
}

export function isClearlyNonEvent(item: Pick<NewsItem, "title" | "description">): boolean {
  const text = `${item.title} ${item.description ?? ""}`.replace(/\s+/g, " ");
  if (RECURRING_EDITORIAL_TITLE_PATTERNS.some((pattern) => pattern.test(item.title))) return true;
  if (STRONG_EVENT_TERMS.test(text)) return false;
  return OBVIOUS_NON_EVENT_PATTERNS.some((pattern) => pattern.test(text));
}

export function shouldExpireLowSignalEvent(input: {
  title: string;
  description?: string | null;
  sourceType: NewsItem["sourceType"];
  credibilityTier: number;
}): boolean {
  if (input.sourceType !== "social" || input.credibilityTier !== 3) return false;
  const text = `${input.title} ${input.description ?? ""}`;
  return !STRONG_EVENT_TERMS.test(text) && LOW_SIGNAL_ARCHIVE_PATTERNS.test(text);
}

export function lowSignalExpiry(publishedAt: string): string {
  const base = new Date(publishedAt).getTime();
  const safeBase = Number.isFinite(base) ? base : Date.now();
  return new Date(safeBase + LOW_SIGNAL_RETENTION_DAYS * 86_400_000).toISOString();
}

export function prepareIncomingItems(items: NewsItem[]): NewsItem[] {
  const byIdentity = new Map<string, NewsItem>();

  for (const original of items) {
    const url = canonicalizeEventUrl(original.url);
    const title = cleanAndCapTitle(original.title);
    const description = cleanAndCapDescription(original.description);
    if (!url || !title) continue;

    const item = { ...original, url, title, description };
    const fingerprint = normalizeTitleFingerprint(title);
    const identity = fingerprint.length >= 24
      ? `${item.source}\u0000${fingerprint}`
      : `${item.source}\u0000${url}`;
    const existing = byIdentity.get(identity);

    if (!existing || description.length > (existing.description?.length ?? 0)) {
      byIdentity.set(identity, item);
    }
  }

  const byUrl = new Map<string, NewsItem>();
  for (const item of byIdentity.values()) {
    const existing = byUrl.get(item.url);
    if (!existing || (item.description?.length ?? 0) > (existing.description?.length ?? 0)) {
      byUrl.set(item.url, item);
    }
  }

  return [...byUrl.values()];
}
