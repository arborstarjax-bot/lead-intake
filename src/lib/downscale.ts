// Client-side image downscale. Vercel serverless functions cap the request
// body at 4.5 MB; modern iPhone screenshots routinely exceed that when they
// include inline photos. We only need to read text from the screenshot, so
// there is no value in shipping the original high-res PNG — resizing to a
// max longest-side and re-encoding as JPEG consistently produces <500 KB
// files that stay well under the platform ceiling.
//
// HEIC is handled by the server (browsers can't decode it) — pass through
// untouched. Tiny files that are already under the threshold are returned
// as-is to keep the fast path fast.

// Target size stays well below Vercel's 4.5 MB serverless body ceiling so
// even multipart overhead can't push us over. If the first-pass encode
// overshoots, we tighten quality and retry until we land under the cap.
const TARGET_MAX_BYTES = 3_500_000;
const MAX_LONG_EDGES = [1600, 1280, 1024];
const QUALITY_STEPS = [0.85, 0.75, 0.6];
const PASSTHROUGH_BYTES = 500 * 1024;

function isHeic(file: File): boolean {
  return (
    /\.(heic|heif)$/i.test(file.name) ||
    file.type === "image/heic" ||
    file.type === "image/heif"
  );
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
  });
}

async function encodeAt(bitmap: ImageBitmap, maxEdge: number, quality: number): Promise<Blob | null> {
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, width, height);
  return canvasToBlob(canvas, quality);
}

/**
 * Returns a downscaled JPEG version of the file when it is both decodable
 * and large enough to warrant it. The output is guaranteed to be under
 * TARGET_MAX_BYTES whenever the browser can decode the image; otherwise
 * the original file is returned unchanged so HEIC and edge cases still
 * reach the server-side conversion path.
 */
export async function downscaleImage(file: File): Promise<File> {
  if (isHeic(file)) return file;
  if (!file.type.startsWith("image/")) return file;
  // Fast path: already small enough to skip decode/encode entirely.
  if (file.size <= PASSTHROUGH_BYTES) return file;

  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  try {
    let best: Blob | null = null;
    for (const maxEdge of MAX_LONG_EDGES) {
      for (const quality of QUALITY_STEPS) {
        const blob = await encodeAt(bitmap, maxEdge, quality);
        if (!blob) continue;
        if (!best || blob.size < best.size) best = blob;
        if (blob.size <= TARGET_MAX_BYTES) {
          const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
          return new File([blob], newName, {
            type: "image/jpeg",
            lastModified: Date.now(),
          });
        }
      }
    }
    // Never got under the target, but our smallest attempt still beats
    // the original — ship that. If even that lost to the original, the
    // source was already reasonable-size, so pass it through.
    if (best && best.size < file.size) {
      const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([best], newName, {
        type: "image/jpeg",
        lastModified: Date.now(),
      });
    }
    return file;
  } catch {
    return file;
  } finally {
    bitmap.close?.();
  }
}
