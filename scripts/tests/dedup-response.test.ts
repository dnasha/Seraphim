import { describe, expect, it } from "vitest";
import { parseExistingUrlRows } from "@/scraper/utils/dedup";

describe("deduplication RPC response parsing", () => {
  it("accepts the established existing_url contract", () => {
    expect(parseExistingUrlRows([
      { existing_url: "https://example.com/known", event_id: "event-1" },
    ])).toEqual(["https://example.com/known"]);
  });

  it("accepts the temporary url response during a rolling deployment", () => {
    expect(parseExistingUrlRows([
      { url: "https://example.com/known", event_id: "event-1" },
    ])).toEqual(["https://example.com/known"]);
  });

  it("fails closed when the RPC response shape changes", () => {
    expect(() => parseExistingUrlRows([{ event_id: "event-1" }]))
      .toThrow("missing an existing URL");
  });
});
