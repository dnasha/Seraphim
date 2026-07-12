import type { NewsItem } from "@/lib/core/types";

const DEGRADED_SUMMARY_SOURCES = new Set([
  "Indian Express",
  "Nikkei Asia",
  "Romania Insider",
  "Nature",
]);

const INDIAN_EXPRESS_IRRELEVANT_SECTIONS = [
  "/sports/",
  "/lifestyle/",
  "/entertainment/",
  "/education/",
  "/trending/",
  "/opinion/",
  "/upsc-",
];

const MIN_SUMMARY_CHARACTERS = 80;
const MIN_SUMMARY_WORDS = 12;

export type QualityRejectionReason =
  | "irrelevant_section"
  | "insubstantial_description";

export function getQualityRejectionReason(
  item: Pick<NewsItem, "source" | "url" | "description">,
): QualityRejectionReason | null {
  if (
    item.source === "Indian Express" &&
    INDIAN_EXPRESS_IRRELEVANT_SECTIONS.some((section) =>
      item.url.toLowerCase().includes(section),
    )
  ) {
    return "irrelevant_section";
  }

  if (!DEGRADED_SUMMARY_SOURCES.has(item.source)) return null;

  const summary = (item.description ?? "").replace(/\s+/g, " ").trim();
  const words = summary.split(/\s+/).filter(Boolean);
  if (
    summary.length < MIN_SUMMARY_CHARACTERS ||
    words.length < MIN_SUMMARY_WORDS
  ) {
    return "insubstantial_description";
  }

  return null;
}

export function filterItemsByQuality(items: NewsItem[]): {
  accepted: NewsItem[];
  rejectedByReason: Record<QualityRejectionReason, number>;
} {
  const accepted: NewsItem[] = [];
  const rejectedByReason: Record<QualityRejectionReason, number> = {
    irrelevant_section: 0,
    insubstantial_description: 0,
  };

  for (const item of items) {
    const reason = getQualityRejectionReason(item);
    if (reason) rejectedByReason[reason]++;
    else accepted.push(item);
  }

  return { accepted, rejectedByReason };
}
