import { useState } from 'react';
import { Check, Copy, ExternalLink, Scale, ShieldCheck } from 'lucide-react';
import { Card } from '@/src/components/ui/Card';
import { IndianFlag } from '@/src/components/ui/IndianFlag';
import type { TargetType } from '@/src/types/investigation';

interface BharatRegistryPivotCardProps {
  target: string;
  targetType: TargetType;
  createdAt: string;
  redactPii?: boolean;
}

interface RegistryLink {
  name: string;
  authority: string;
  purpose: string;
  href: string;
}

function formatIstTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(new Date(iso)) + ' IST';
  } catch {
    return 'IST Ready';
  }
}

export function BharatRegistryPivotCard({
  target,
  targetType,
  createdAt,
  redactPii = false,
}: BharatRegistryPivotCardProps) {
  const [copiedTarget, setCopiedTarget] = useState(false);

  const cleanDigits = target.replace(/\D/g, '');
  const indianPhoneDigits =
    cleanDigits.length === 10
      ? `91${cleanDigits}`
      : cleanDigits.startsWith('91') && cleanDigits.length === 12
        ? cleanDigits
        : cleanDigits;

  const isIndianPhone =
    targetType === 'phone' &&
    (target.trim().startsWith('+91') ||
      (cleanDigits.length === 10 && /^[6-9]/.test(cleanDigits)) ||
      (cleanDigits.length === 12 && cleanDigits.startsWith('91')));

  const registries: RegistryLink[] =
    targetType === 'phone'
      ? [
          {
            name: 'Sanchar Saathi (Chakshu)',
            authority: 'DoT · Government of India',
            purpose: 'Verify lost SIMs, TAFCOP connections, or report suspected telecom fraud',
            href: 'https://sancharsaathi.gov.in/',
          },
          {
            name: 'National CyberCrime Portal',
            authority: 'I4C · Ministry of Home Affairs',
            purpose: 'Cross-check suspect reporting & official cyber incident helpline (1930)',
            href: 'https://cybercrime.gov.in/',
          },
          {
            name: 'TRAI DND & Numbering',
            authority: 'TRAI · Telecom Authority',
            purpose: 'Validate DND registration status, telecom circle & MSC operator allocation',
            href: 'https://www.trai.gov.in/',
          },
          {
            name: 'WhatsApp Direct Verification',
            authority: 'Public Messenger Pivot',
            purpose: 'Open official wa.me profile check without triggering any SMS OTP',
            href: `https://wa.me/${indianPhoneDigits || cleanDigits}`,
          },
        ]
      : [
          {
            name: 'CERT-In Advisories',
            authority: 'MeitY · Government of India',
            purpose: 'Cross-reference Indian vulnerability advisories & incident directives',
            href: 'https://www.cert-in.org.in/',
          },
          {
            name: 'NIXI .IN WHOIS Registry',
            authority: 'National Internet Exchange of India',
            purpose: 'Official public WHOIS / RDAP lookup for .IN and .BHARAT domains',
            href: 'https://www.registry.in/whois',
          },
          {
            name: 'MCA Corporate & Director',
            authority: 'Ministry of Corporate Affairs',
            purpose: 'Public corporate CIN, LLPIN & signatory trace lookup in India',
            href: 'https://www.mca.gov.in/content/mca/global/en/mca/master-data/MDS.html',
          },
          {
            name: 'GSTIN Public Taxpayer Search',
            authority: 'GST Network · India',
            purpose: 'Verify registered Indian business GST entities & filing compliance',
            href: 'https://services.gst.gov.in/services/searchtp',
          },
        ];

  return (
    <Card className="overflow-hidden border-slate-200/90 dark:border-slate-800 bg-white/90 dark:bg-[#0E1526]">
      {/* Crisp 1px Indian Tricolour Top Hairline */}
      <div
        aria-hidden="true"
        className="h-[2px] w-full bg-gradient-to-r from-[#FF9933] via-slate-100 dark:via-slate-700 to-[#138808]"
      />

      <div className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <IndianFlag className="w-5 h-3.5" />
            <div>
              <h3 className="font-display text-sm font-bold text-[#0F172A] dark:text-slate-100">
                <span className="font-devanagari font-semibold text-orange-600 dark:text-orange-400 mr-1.5">
                  परमाणु
                </span>
                Bharat Sovereign Registry & Compliance Pivots
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isIndianPhone
                  ? 'Detected Indian +91 numbering plan · Zero-OTP official portal pivots & IST audit clock'
                  : 'Authorized Indian public-registry pivots · DPDP Act 2023 & BSA Sec. 63 audit posture'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-300">
              {formatIstTimestamp(createdAt)}
            </span>
            {!redactPii && (
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(target);
                  setCopiedTarget(true);
                  window.setTimeout(() => setCopiedTarget(false), 1600);
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 hover:border-orange-400 text-[#0F172A] dark:text-slate-200 font-medium transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedTarget ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span>Copied Target</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 text-slate-400" />
                    <span>Copy Target</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {registries.map((reg) => (
            <a
              key={reg.name}
              href={reg.href}
              target="_blank"
              rel="noopener noreferrer"
              className="group rounded-xl border border-slate-200/85 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/60 hover:bg-white dark:hover:bg-slate-900 hover:border-orange-300 dark:hover:border-orange-700 p-3 flex flex-col justify-between gap-2 transition-colors"
            >
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 group-hover:text-orange-700 dark:group-hover:text-orange-300 transition-colors">
                    {reg.name}
                  </p>
                  <ExternalLink className="w-3.5 h-3.5 text-slate-400 group-hover:text-orange-600 shrink-0 mt-0.5" />
                </div>
                <p className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400">
                  {reg.authority}
                </p>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                {reg.purpose}
              </p>
            </a>
          ))}
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="inline-flex items-center gap-1.5">
            <Scale className="w-3.5 h-3.5 text-orange-600 dark:text-orange-400 shrink-0" />
            <span>DPDP Act 2023 Sec. 3(c)(ii) Public Data Boundary</span>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-700 dark:text-emerald-400 shrink-0" />
            <span>Zero-OTP · Passive Public Verification</span>
          </span>
        </div>
      </div>
    </Card>
  );
}
