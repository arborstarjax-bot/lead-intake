// iPhone screenshots taken via the share sheet may arrive as HEIC. OpenAI's
// vision model does not accept HEIC; convert to JPEG before upload/signing.
// This is a best-effort path — if conversion fails, fall through and let the
// caller store the original; most iOS share-sheet uploads come through as
// JPEG automatically thanks to the Web File API, so HEIC is a minority case.

export async function maybeConvertHeic(file: Blob, fileName: string): Promise<{
  blob: Blob;
  fileName: string;
}> {
  const looksHeic =
    /heic$|heif$/i.test(fileName) ||
    file.type === "image/heic" ||
    file.type === "image/heif";
  if (!looksHeic) return { blob: file, fileName };

  try {
    const mod = await import("heic-convert");
    const convert = (mod as unknown as { default: typeof mod }).default ?? mod;
    const input = new Uint8Array(await file.arrayBuffer());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const out: ArrayBuffer = await (convert as any)({ buffer: input, format: "JPEG", quality: 0.9 });
    const jpeg = new Blob([new Uint8Array(out)], { type: "image/jpeg" });
    const newName = fileName.replace(/\.(heic|heif)$/i, ".jpg");
    return { blob: jpeg, fileName: newName };
  } catch {
    return { blob: file, fileName };
  }
}
