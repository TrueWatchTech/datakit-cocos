/**
 * Waits until a newly attached native RenderTexture is safe to read back.
 *
 * Creator 3 can submit the first draw while the target attachment is still
 * being applied by the native renderer. Keeping the target attached for a
 * second complete draw prevents an empty first Session Replay snapshot.
 */
export async function waitForRenderTextureReadback(drawCycle: () => Promise<void>): Promise<void> {
  await drawCycle();
  await drawCycle();
}
