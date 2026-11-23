import type { InvestigationRecord } from '@/src/types/investigation';

export function renderInvestigationSnapshotPng(
  investigation: InvestigationRecord
): string {
  if (typeof document === 'undefined') return '';
  const canvas = document.createElement('canvas');
  canvas.width = 1120;
  canvas.height = 600;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  // Clean off-white canvas
  ctx.fillStyle = '#FAFAFA';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Pure white main surface
  ctx.fillStyle = '#FFFFFF';
  ctx.strokeStyle = '#E5E7EB';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(36, 36, canvas.width - 72, canvas.height - 72, 24);
  ctx.fill();
  ctx.stroke();

  // Subtle Tricolour top accent strip
  const stripGrad = ctx.createLinearGradient(36, 36, canvas.width - 36, 36);
  stripGrad.addColorStop(0, '#FF9933');
  stripGrad.addColorStop(0.5, '#E2E8F0');
  stripGrad.addColorStop(1, '#138808');
  ctx.fillStyle = stripGrad;
  ctx.beginPath();
  ctx.roundRect(36, 36, canvas.width - 72, 5, [24, 24, 0, 0]);
  ctx.fill();

  // Header
  ctx.fillStyle = '#EA580C';
  ctx.font = '600 14px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('ॐ  PARMANU · INDIA’S ATOMIC OSINT ENGINE', 72, 92);

  ctx.fillStyle = '#0F172A';
  ctx.font = '700 32px "Plus Jakarta Sans", sans-serif';
  ctx.fillText(investigation.target, 72, 138);

  ctx.fillStyle = '#64748B';
  ctx.font = '500 15px "Public Sans", sans-serif';
  ctx.fillText(
    `${investigation.targetType.toUpperCase()}  ·  Scan ${investigation.scanId}  ·  ${new Date(
      investigation.createdAt
    ).toLocaleString()}`,
    72,
    170
  );

  // 4 Summary Stat Boxes
  const stats = [
    { label: 'Total Results', value: String(investigation.summary.total) },
    { label: 'Breached Results', value: String(investigation.summary.breached) },
    { label: 'Registered Accounts', value: String(investigation.summary.registered) },
    { label: 'Leaked Results', value: String(investigation.summary.leaked) },
  ];

  stats.forEach((stat, idx) => {
    const x = 72 + idx * 246;
    const y = 212;
    ctx.fillStyle = '#FAFAFA';
    ctx.strokeStyle = '#E5E7EB';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(x, y, 228, 108, 16);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.font = '700 36px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(stat.value, x + 20, y + 54);

    ctx.fillStyle = '#64748B';
    ctx.font = '500 14px "Public Sans", sans-serif';
    ctx.fillText(stat.label, x + 20, y + 84);
  });

  // Brief
  ctx.fillStyle = '#0F172A';
  ctx.font = '600 16px "Plus Jakarta Sans", sans-serif';
  ctx.fillText('Executive Brief', 72, 366);

  ctx.fillStyle = '#475569';
  ctx.font = '400 15px "Public Sans", sans-serif';
  const text =
    investigation.aiSummary?.executiveBrief ||
    `Verified ${investigation.summary.found} signals across ${investigation.summary.total} checks.`;

  const words = text.split(' ');
  let line = '';
  let lineY = 398;
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > 960) {
      ctx.fillText(line, 72, lineY);
      line = w;
      lineY += 24;
      if (lineY > 475) break;
    } else {
      line = test;
    }
  }
  if (line && lineY <= 475) ctx.fillText(line, 72, lineY);

  // Footer
  ctx.fillStyle = '#94A3B8';
  ctx.font = '500 13px "Public Sans", sans-serif';
  ctx.fillText(
    'Parmanu Intelligence · One Signal. Every Trace. Zero Blind Spots. · Authorized OSINT Case Export',
    72,
    530
  );

  const pngUrl = canvas.toDataURL('image/png', 0.9);
  if (pngUrl.length <= 420_000) return pngUrl;
  return canvas.toDataURL('image/jpeg', 0.85);
}
