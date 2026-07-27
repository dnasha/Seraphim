import sharp from "sharp";
import { supabaseAdmin } from "@/lib/core/supabase-admin";
import { getTrustedClientIp } from "@/lib/security/clientIdentity";
import { createLocalFixedWindowLimiter } from "@/lib/security/localRateLimit";
import { fetchPublicImage } from "@/lib/security/ogImage";
import { createSingleFlight } from "@/lib/server/singleFlight";
import { selectNewsImageWidth } from "@/lib/utils/newsImages";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IMAGE_CACHE_CONTROL = "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000";
const perIpLimit = createLocalFixedWindowLimiter({ limit: 180, windowMs: 60_000 });
const instanceLimit = createLocalFixedWindowLimiter({ limit: 360, windowMs: 60_000, maxEntries: 1 });
const transforms = createSingleFlight(32);

async function loadThumbnail(eventId: string, width: number) {
  const { data, error } = await supabaseAdmin
    .from("events")
    .select("image_url")
    .eq("id", eventId)
    .maybeSingle();
  if (error || !data?.image_url) return null;

  const source = await fetchPublicImage(data.image_url, {
    timeoutMs: 2_500,
    maxRedirects: 3,
  });
  if (!source || source.contentType.toLowerCase().includes("svg")) return null;

  try {
    return await sharp(Buffer.from(source.arrayBuffer), {
      failOn: "warning",
      limitInputPixels: 40_000_000,
    })
      .rotate()
      .resize({
        width,
        height: Math.round(width * 0.75),
        fit: "cover",
        position: "attention",
        withoutEnlargement: true,
      })
      .webp({ quality: 78, effort: 4 })
      .toBuffer();
  } catch {
    return null;
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const clientIp = getTrustedClientIp(request.headers);
  if (!clientIp) return new Response(null, { status: 400 });

  const now = Date.now();
  const perIp = perIpLimit.check([`net:${clientIp}`], now);
  const instance = instanceLimit.check(["instance:news-image"], now);
  if (!perIp.success || !instance.success) {
    return new Response(null, {
      status: 429,
      headers: {
        "Retry-After": String(Math.max(perIp.retryAfterSeconds, instance.retryAfterSeconds)),
        "Cache-Control": "private, no-store",
      },
    });
  }

  const { id } = await params;
  if (!UUID_PATTERN.test(id)) return new Response(null, { status: 404 });

  const requestedWidth = Number(new URL(request.url).searchParams.get("w"));
  const width = selectNewsImageWidth(requestedWidth);
  const thumbnail = await transforms.run(`${id}:${width}`, () => loadThumbnail(id, width));
  if (!thumbnail) {
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "private, no-store" },
    });
  }

  return new Response(new Uint8Array(thumbnail), {
    headers: {
      "Cache-Control": IMAGE_CACHE_CONTROL,
      "Content-Type": "image/webp",
      "Content-Length": String(thumbnail.byteLength),
      "Content-Disposition": `inline; filename="${id}-${width}.webp"`,
      "Cross-Origin-Resource-Policy": "same-origin",
    },
  });
}
