/** Converts tightly packed RGBA pixels from bottom-left to top-left row order. */
export function flipRgbaRows(bytes: Uint8Array, width: number, height: number): void {
  const rowSize = width * 4;
  const swap = new Uint8Array(rowSize);
  for (let top = 0, bottom = height - 1; top < bottom; top += 1, bottom -= 1) {
    const topOffset = top * rowSize;
    const bottomOffset = bottom * rowSize;
    swap.set(bytes.subarray(topOffset, topOffset + rowSize));
    bytes.copyWithin(topOffset, bottomOffset, bottomOffset + rowSize);
    bytes.set(swap, bottomOffset);
  }
}
