/**
 * Native camera capture via @capacitor/camera.
 *
 * Exists for two reasons:
 *
 *   1. **App Store review (Guideline 4.2 Minimum Functionality).**
 *      Apple rejects apps that are "just a webview", so the iOS build
 *      needs at least one native integration that a plain PWA can't
 *      deliver. The Camera plugin hits the native AVFoundation stack
 *      directly — no file picker sheet, no Photos entitlement, just
 *      the camera capture UI. This is the quickest "native feature"
 *      check we can clear for a primarily web-driven app.
 *
 *   2. **UX.** On iOS `<input type="file" accept="image/*" capture>`
 *      opens an intermediate action sheet ("Camera / Photo Library /
 *      Choose Files"). For arborists standing in a customer's yard
 *      the intent is almost always "take a photo of this estimate"
 *      — tapping one button to land straight in the capture UI is a
 *      measurable win over three taps through the picker.
 *
 * Returns a browser-land `File` that the existing UploadBox pipeline
 * can downscale + POST unchanged. On failure (user cancels, plugin
 * unavailable, no camera hardware) returns null and the caller should
 * silently fall back to the web `<input type="file">` path.
 */
export async function takeNativePhoto(): Promise<File | null> {
  // Dynamic import so the plugin never ends up in the web bundle.
  // When running on the web the Capacitor shim proxies every method
  // to a web fallback that opens a browser picker, which defeats the
  // whole point — we only want this code path inside the native shell.
  try {
    const { Camera, CameraResultType, CameraSource } = await import(
      "@capacitor/camera"
    );

    const photo = await Camera.getPhoto({
      // JPEG at 85% strikes the right balance: the OpenAI image API
      // reads the on-screen text fine at this quality, and we save
      // ~60% on upload size vs. raw PNG.
      quality: 85,
      // `Uri` gives us a local file:// (native) or blob: (web fallback)
      // URL that fetch() can consume. `DataUrl` would inline the entire
      // image as base64 and blow the main-thread memory on large photos.
      resultType: CameraResultType.Uri,
      // `Camera` skips the action sheet and goes straight into capture.
      // If the user wants to pick from the library they can still use
      // the regular "Upload" dropzone.
      source: CameraSource.Camera,
      // Don't save to the user's photo library automatically — they
      // may not want every estimate photo in their camera roll. They
      // can still share out from inside LeadFlow if they want to.
      saveToGallery: false,
      // Let the user crop / rotate before it lands in the app. Useful
      // when you snapped the photo on a breezy jobsite.
      allowEditing: true,
    });

    if (!photo.webPath) return null;

    const res = await fetch(photo.webPath);
    const blob = await res.blob();
    const ext = photo.format || "jpeg";
    const fileName = `camera-${Date.now()}.${ext}`;
    // Type must be `image/*` so downscaleImage + the ingest endpoint
    // accept it. `photo.format` is "jpeg"/"png"/"heic"; prefix with
    // "image/" to form a valid MIME type.
    const type = blob.type || `image/${ext}`;
    return new File([blob], fileName, { type });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // User cancel isn't an error — the plugin rejects with a cancel-
    // marker string. Everything else is logged so we can diagnose
    // on-device failures via Safari remote inspector.
    if (!/cancel/i.test(msg)) {
      console.error("takeNativePhoto failed:", err);
    }
    return null;
  }
}
