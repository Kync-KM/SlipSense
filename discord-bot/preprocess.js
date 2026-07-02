// Image preprocessing to help Tesseract read text on colored/gradient slip
// backgrounds more reliably: grayscale + contrast stretch (min-max
// normalization), with a mild upscale for small images.
// Same idea as the browser canvas version in expense-tracker.html, just using
// jimp (pure JS, no native build deps) since this runs on a plain VPS.

const Jimp = require("jimp");

async function preprocessImage(buffer) {
  const image = await Jimp.read(buffer);
  const w = image.bitmap.width;
  const h = image.bitmap.height;

  if (w < 1000) {
    const scale = Math.min(2, 1000 / w);
    image.resize(Math.round(w * scale), Math.round(h * scale));
  }

  image.greyscale();

  let min = 255, max = 0;
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    const v = this.bitmap.data[idx];
    if (v < min) min = v;
    if (v > max) max = v;
  });

  const range = Math.max(1, max - min);
  image.scan(0, 0, image.bitmap.width, image.bitmap.height, function (x, y, idx) {
    const v = Math.max(0, Math.min(255, (this.bitmap.data[idx] - min) * (255 / range)));
    this.bitmap.data[idx] = v;
    this.bitmap.data[idx + 1] = v;
    this.bitmap.data[idx + 2] = v;
  });

  return image.getBufferAsync(Jimp.MIME_PNG);
}

module.exports = { preprocessImage };
