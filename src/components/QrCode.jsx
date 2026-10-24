// QR code desenhado no próprio app (sem internet extra): aponta a câmera do celular e abre o link.
import { useMemo } from 'react';
import qrcode from 'qrcode-generator';

export default function QrCode({ text, size = 220 }) {
  const cells = useMemo(() => {
    try {
      const qr = qrcode(0, 'M');
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      const out = [];
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) out.push([c, r]);
      return { n, out };
    } catch {
      return null;
    }
  }, [text]);
  if (!cells) return null;
  const pad = 2;
  const box = cells.n + pad * 2;
  return (
    <svg className="qr-code" width={size} height={size} viewBox={`0 0 ${box} ${box}`} shapeRendering="crispEdges" role="img" aria-label="QR code">
      <rect width={box} height={box} fill="#fff" />
      {cells.out.map(([x, y]) => (
        <rect key={x + '-' + y} x={x + pad} y={y + pad} width="1" height="1" fill="#111" />
      ))}
    </svg>
  );
}
