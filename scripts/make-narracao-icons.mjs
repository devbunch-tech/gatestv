// Ícone, banner e ícones da janela flutuante do app GATES Narração (android/res-narracao).
// Parte dos recursos do GATES! TV (android/res) e acrescenta um selo de microfone e o texto "NARRAÇÃO".
// Uso: node scripts/make-narracao-icons.mjs   (o android/build-apk.mjs chama sozinho se a pasta não existir)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import Jimp from 'jimp';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'android', 'res');
const OUT = path.join(root, 'android', 'res-narracao');
const BG = { r: 0x12, g: 0x12, b: 0x14 };
const RED = { r: 0xe3, g: 0x0b, b: 0x40 };
const WHITE = { r: 255, g: 255, b: 255 };

// Pinta uma forma (função (x, y) -> dentro?) com antisserrilhado por supersampling 4x4.
function fill(img, inside, color, box = [0, 0, img.bitmap.width, img.bitmap.height]) {
  const [x0, y0, x1, y1] = box.map(Math.round);
  for (let y = Math.max(0, y0); y < Math.min(img.bitmap.height, y1); y++) {
    for (let x = Math.max(0, x0); x < Math.min(img.bitmap.width, x1); x++) {
      let n = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) n++;
      if (!n) continue;
      const a = n / 16;
      const i = (y * img.bitmap.width + x) * 4;
      const d = img.bitmap.data;
      const da = d[i + 3] / 255;
      const oa = a + da * (1 - a);
      for (const [k, c] of [[0, color.r], [1, color.g], [2, color.b]]) d[i + k] = oa ? Math.round((c * a + d[i + k] * da * (1 - a)) / oa) : 0;
      d[i + 3] = Math.round(oa * 255);
    }
  }
}

const segDist = (px, py, ax, ay, bx, by) => {
  const vx = bx - ax, vy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / (vx * vx + vy * vy || 1)));
  return Math.hypot(px - ax - vx * t, py - ay - vy * t);
};
const roundRect = (cx, cy, w, h, r) => (x, y) => {
  const dx = Math.max(Math.abs(x - cx) - (w / 2 - r), 0), dy = Math.max(Math.abs(y - cy) - (h / 2 - r), 0);
  return dx * dx + dy * dy <= r * r;
};

// Microfone centrado em (cx, cy), altura total ~1.2u.
function mic(cx, cy, u) {
  return (x, y) => {
    const X = (x - cx) / u, Y = (y - cy) / u;
    if (segDist(X, Y, 0, -0.42, 0, 0.0) <= 0.2) return true; // cápsula
    const r = Math.hypot(X, Y + 0.05);
    if (Y >= -0.05 && Math.abs(r - 0.36) <= 0.05) return true; // suporte em arco
    if (Math.abs(X) <= 0.05 && Y >= 0.3 && Y <= 0.52) return true; // haste
    return Math.abs(X) <= 0.24 && Y >= 0.47 && Y <= 0.57; // base
  };
}

// Recorta o logo (tudo o que não é o fundo escuro) da imagem original.
function cropLogo(img) {
  const { width: w, height: h, data } = img.bitmap;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (Math.abs(data[i] - BG.r) + Math.abs(data[i + 1] - BG.g) + Math.abs(data[i + 2] - BG.b) > 40) {
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
    }
  return img.clone().crop(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

const canvas = (w, h) => new Jimp(w, h, Jimp.rgbaToInt(BG.r, BG.g, BG.b, 255));

async function launcherIcon(dir) {
  const src = await Jimp.read(path.join(SRC, dir, 'ic_launcher.png'));
  const n = src.bitmap.width;
  const logo = cropLogo(src);
  const img = canvas(n, n);
  img.composite(logo, Math.round((n - logo.bitmap.width) / 2), Math.round(n * 0.36 - logo.bitmap.height / 2));
  // Selo vermelho com microfone branco embaixo do logo.
  const cx = n / 2, cy = n * 0.7, r = n * 0.17;
  fill(img, (x, y) => Math.hypot(x - cx, y - cy) <= r, RED);
  fill(img, mic(cx, cy, r * 0.72), WHITE, [cx - r, cy - r, cx + r, cy + r]);
  fs.mkdirSync(path.join(OUT, dir), { recursive: true });
  await img.writeAsync(path.join(OUT, dir, 'ic_launcher.png'));
}

async function banner() {
  const src = await Jimp.read(path.join(SRC, 'drawable-xhdpi', 'banner.png'));
  const { width: w, height: h } = src.bitmap;
  const logo = cropLogo(src);
  const img = canvas(w, h);
  img.composite(logo, Math.round((w - logo.bitmap.width) / 2), Math.round(h * 0.38 - logo.bitmap.height / 2));
  // Faixa vermelha com microfone e "NARRAÇÃO".
  const font = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);
  const text = 'N A R R A Ç Ã O';
  const tw = Jimp.measureText(font, text);
  const th = Jimp.measureTextHeight(font, text, tw + 10);
  const pillH = 30, micW = 18, gap = 8, pad = 16;
  const pillW = pad + micW + gap + tw + pad;
  const px = (w - pillW) / 2, cy = h * 0.72;
  fill(img, roundRect(w / 2, cy, pillW, pillH, pillH / 2), RED);
  fill(img, mic(px + pad + micW / 2, cy, 15), WHITE, [px, cy - pillH / 2, px + pad + micW + 2, cy + pillH / 2]);
  img.print(font, Math.round(px + pad + micW + gap), Math.round(cy - th / 2), text);
  fs.mkdirSync(path.join(OUT, 'drawable-xhdpi'), { recursive: true });
  await img.writeAsync(path.join(OUT, 'drawable-xhdpi', 'banner.png'));
}

// Ícones das ações da janela flutuante (brancos, fundo transparente, 48dp em xhdpi).
async function actionIcons() {
  const n = 96, c = n / 2;
  const shapes = {
    plus: (x, y) => roundRect(c, c, 56, 12, 4)(x, y) || roundRect(c, c, 12, 56, 4)(x, y),
    minus: roundRect(c, c, 56, 12, 4),
    pause: (x, y) => roundRect(c - 13, c, 14, 52, 3)(x, y) || roundRect(c + 13, c, 14, 52, 3)(x, y),
    play: (x, y) => x >= c - 18 && Math.abs(y - c) <= ((c + 26 - x) * 28) / 44 && x <= c + 26,
  };
  for (const [name, inside] of Object.entries(shapes)) {
    const img = new Jimp(n, n, 0x00000000);
    fill(img, inside, WHITE);
    await img.writeAsync(path.join(OUT, 'drawable-xhdpi', `narr_${name}.png`));
  }
}

export async function makeNarracaoIcons() {
  for (const dir of fs.readdirSync(SRC).filter((d) => d.startsWith('mipmap-'))) await launcherIcon(dir);
  await banner();
  await actionIcons();
  console.log('✓ ícones do GATES Narração em', path.relative(root, OUT));
  return OUT;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await makeNarracaoIcons();
