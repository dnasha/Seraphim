import { describe, expect, it } from "vitest";
import { canOptimizeNewsImage } from "@/lib/utils/newsImages";

describe("news image optimization allowlist", () => {
  it("optimizes known high-volume HTTPS image hosts", () => {
    expect(canOptimizeNewsImage("https://images.indianexpress.com/story.jpg")).toBe(true);
    expect(canOptimizeNewsImage("https://img.lemde.fr/story.jpg")).toBe(true);
  });

  it("leaves unknown, insecure, and malformed image URLs unproxied", () => {
    expect(canOptimizeNewsImage("https://untrusted.example/story.jpg")).toBe(false);
    expect(canOptimizeNewsImage("http://images.indianexpress.com/story.jpg")).toBe(false);
    expect(canOptimizeNewsImage("not-a-url")).toBe(false);
  });
});
