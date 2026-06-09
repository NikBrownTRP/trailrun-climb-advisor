import { PNG } from "pngjs";

/** Generate a simple solid-with-chevron 300x300 PNG as a Buffer. */
export function makeIcon(): Buffer {
  const size = 300;
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (size * y + x) << 2;
      // background teal; a white upward chevron near centre as a "climb" mark
      const onChevron = Math.abs(x - size / 2) <= (size / 2 - Math.abs(y - size * 0.62) * 1.2)
        && Math.abs(x - size / 2) >= (size / 2 - Math.abs(y - size * 0.62) * 1.2) - 18
        && y > size * 0.30 && y < size * 0.70;
      png.data[idx] = onChevron ? 255 : 13;
      png.data[idx + 1] = onChevron ? 255 : 148;
      png.data[idx + 2] = onChevron ? 255 : 136;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}
