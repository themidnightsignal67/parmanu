import { useMemo, useState } from 'react';
import {
  Check,
  Compass,
  Copy,
  Crosshair,
  ExternalLink,
  KeyRound,
  MapPin,
  Radar,
  Search,
  Star,
} from 'lucide-react';
import { maskIdentifierLabel, maskPiiString } from '@/src/lib/annotationsStore';
import type { GhuntIntelligenceData } from '@/src/types/investigation';
import { Button } from '@/src/components/ui/Button';
import { Card } from '@/src/components/ui/Card';
import { SafeAvatar } from '@/src/components/ui/SafeAvatar';

interface GhuntProfileCardProps {
  intel: GhuntIntelligenceData;
  redactPii?: boolean;
  onFocusMapLocation?: (
    lat: number,
    lng: number,
    zoom?: number,
    markerId?: string
  ) => void;
}

function zoomForRadiusKm(radiusKm: number): number {
  if (radiusKm <= 3) return 12;
  if (radiusKm <= 10) return 11;
  if (radiusKm <= 25) return 10;
  if (radiusKm <= 60) return 9;
  if (radiusKm <= 140) return 8;
  return 6;
}

function GoogleWordmarkLogo() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="w-6 h-6 shrink-0"
      aria-label="Google"
      role="img"
    >
      <path
        fill="#4285F4"
        d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.3 0 6.08-1.09 8.11-2.96l-3.88-3.05c-1.09.73-2.48 1.16-4.23 1.16-3.25 0-6.01-2.19-7-5.15H.99v3.14C3.01 21.15 7.21 24 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5 14c-.25-.73-.39-1.51-.39-2.31s.14-1.58.39-2.31V6.24H.99C.36 7.5 0 8.92 0 11.69c0 2.77.36 4.19.99 5.45L5 14Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.8 0 3.41.62 4.68 1.83l3.51-3.51C18.07 1.19 15.3 0 12 0 7.21 0 3.01 2.85.99 6.24l4.01 3.14C5.99 6.94 8.75 4.75 12 4.75Z"
      />
    </svg>
  );
}

function formatLastUpdateDate(raw?: string): string {
  if (!raw) return 'Not exposed';
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }
  return trimmed;
}

export function GhuntProfileCard({
  intel,
  redactPii = false,
  onFocusMapLocation,
}: GhuntProfileCardProps) {
  const [reviewQuery, setReviewQuery] = useState('');
  const [ratingFilter, setRatingFilter] = useState<'all' | 'high' | 'low'>('all');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const shownEmail = redactPii ? maskIdentifierLabel(intel.email, 'email', true) : intel.email;
  const shownName = intel.displayName
    ? redactPii
      ? maskPiiString(intel.displayName, true)
      : intel.displayName
    : shownEmail;
  const shownGaiaId = intel.gaiaId
    ? redactPii
      ? maskPiiString(intel.gaiaId, true)
      : intel.gaiaId
    : undefined;
  const formattedLastUpdate = formatLastUpdateDate(intel.lastUpdated);

  const googleMapsServiceUrl = intel.gaiaId
    ? `https://www.google.com/maps/contrib/${intel.gaiaId}`
    : intel.profileUrl;
  const googleCalendarServiceUrl =
    intel.calendarEmbedUrl ||
    `https://calendar.google.com/calendar/u/0/embed?src=${encodeURIComponent(intel.email)}`;
  const googlePlusServiceUrl =
    intel.googlePlusArchiveUrl ||
    (intel.gaiaId
      ? `https://web.archive.org/web/*/plus.google.com/${intel.gaiaId}*`
      : undefined);

  const filteredReviews = useMemo(() => {
    const q = reviewQuery.trim().toLowerCase();
    return intel.reviews.filter((rev) => {
      if (ratingFilter === 'high' && rev.rating < 4) return false;
      if (ratingFilter === 'low' && rev.rating > 3) return false;
      if (!q) return true;
      return (
        rev.placeName.toLowerCase().includes(q) ||
        (rev.address || '').toLowerCase().includes(q) ||
        (rev.comment || '').toLowerCase().includes(q)
      );
    });
  }, [intel.reviews, ratingFilter, reviewQuery]);

  const handleCopy = async (key: string, val: string) => {
    try {
      await navigator.clipboard.writeText(val);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey(null), 1600);
    } catch {
      // clipboard unavailable
    }
  };

  const authLabel = !intel.tokenConfigured
    ? 'Public Metadata Mode'
    : intel.authMode === 'oauth_access'
    ? 'Live OAuth Access Token'
    : intel.authMode === 'oauth_auth_code'
    ? 'Public Metadata Mode'
    : intel.authMode === 'oauth_refresh'
    ? 'Live OAuth Refresh Flow'
    : intel.authMode === 'android_master'
    ? 'Live Android Master Token'
    : 'Live Cookie / SAPISID Session';

  const hasLiveExchangeableCreds =
    intel.tokenConfigured && intel.authMode !== 'oauth_auth_code';

  const serviceRows: Array<{
    key: string;
    label: string;
    url?: string;
    extraUrl?: string;
    extraLabel?: string;
  }> = [
    {
      key: 'svc-maps',
      label: 'Google Maps',
      url: googleMapsServiceUrl,
    },
    {
      key: 'svc-calendar',
      label: 'Google Calendar',
      url: googleCalendarServiceUrl,
      extraUrl: intel.publicCalendar ? intel.calendarUrl : undefined,
      extraLabel: 'Public ICS',
    },
    {
      key: 'svc-gplus',
      label: 'Google Plus Archive',
      url: googlePlusServiceUrl,
    },
  ];

  const initials = (shownName.replace(/[^A-Za-z0-9]/g, '').charAt(0) || 'G').toUpperCase();

  return (
    <Card className="p-4 sm:p-6 space-y-5 overflow-hidden">
      {/* Google Account Finder Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3 border-b border-slate-200/80 dark:border-slate-800 pb-4">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 flex items-center justify-center shrink-0 shadow-xs">
            <GoogleWordmarkLogo />
          </div>
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-display text-base sm:text-lg font-semibold text-[#0F172A] dark:text-slate-100">
                Google Account Finder
              </h2>
              <span
                className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
                  hasLiveExchangeableCreds
                    ? 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800'
                    : 'text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800'
                }`}
              >
                {authLabel}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              Google account finder will show you if the requested email is linked to a Google account and/or if the person left reviews on Google Maps.
            </p>
          </div>
        </div>
      </div>

      {/* Structured Google Account Finder Profile & Services Panel */}
      <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/60 dark:bg-[#0B1120] divide-y divide-slate-200/80 dark:divide-slate-800 overflow-hidden">
        {/* Profile Picture Row */}
        <div className="p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-2 sm:gap-4 items-center">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Profile picture
          </span>
          <div className="flex flex-wrap items-center gap-3.5 min-w-0">
            <SafeAvatar
              src={intel.avatarUrl}
              alt={shownName}
              className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl object-cover border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-xs shrink-0"
              fallback={
                <span className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-slate-800 dark:to-slate-900 border border-slate-200 dark:border-slate-700 text-[#0F172A] dark:text-slate-200 flex items-center justify-center font-display text-2xl font-bold shrink-0">
                  {initials}
                </span>
              }
            />
            <div className="min-w-0 space-y-1">
              <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                {shownName}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {intel.accountType}
                {intel.primaryMx ? ` · MX ${intel.primaryMx}` : ''}
              </p>
              {intel.avatarUrl ? (
                <div className="flex flex-wrap items-center gap-2 pt-0.5">
                  <a
                    href={intel.avatarUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <span>Open image</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  No public avatar exposed
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Query Row */}
        <div className="px-3.5 sm:px-4 py-3 grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-1 sm:gap-4 items-center">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Query
          </span>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="font-mono text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100 break-all">
              {shownEmail}
            </span>
            {!redactPii && (
              <button
                type="button"
                onClick={() => void handleCopy('query-email', intel.email)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-indigo-400 shrink-0 cursor-pointer"
              >
                {copiedKey === 'query-email' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Photo ID Row */}
        <div className="px-3.5 sm:px-4 py-3 grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-1 sm:gap-4 items-center">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Photo ID
          </span>
          <div className="flex items-center justify-between gap-2 min-w-0">
            <span className="font-mono text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100 break-all tabular-nums">
              {shownGaiaId || 'Not exposed'}
            </span>
            {intel.gaiaId && !redactPii && (
              <button
                type="button"
                onClick={() => void handleCopy('gaia', intel.gaiaId!)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:border-indigo-400 shrink-0 cursor-pointer"
              >
                {copiedKey === 'gaia' ? (
                  <>
                    <Check className="w-3 h-3 text-emerald-600" />
                    <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Last Update Row */}
        <div className="px-3.5 sm:px-4 py-3 grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-1 sm:gap-4 items-center">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400">
            Last update
          </span>
          <span className="font-mono text-xs sm:text-sm font-medium text-[#0F172A] dark:text-slate-100 tabular-nums">
            {formattedLastUpdate}
          </span>
        </div>

        {/* Services Rows */}
        <div className="p-3.5 sm:p-4 grid grid-cols-1 sm:grid-cols-[150px_1fr] gap-2.5 sm:gap-4 items-start">
          <span className="text-[11px] uppercase tracking-wider font-semibold text-slate-500 dark:text-slate-400 sm:pt-1">
            Services
          </span>
          <div className="space-y-2.5 min-w-0">
            {serviceRows.map((svc) => (
              <div
                key={svc.key}
                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/70"
              >
                <div className="min-w-0 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                      {svc.label}
                    </span>
                    {svc.extraUrl && svc.extraLabel && (
                      <a
                        href={svc.extraUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400 hover:underline"
                      >
                        <span>{svc.extraLabel}</span>
                        <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                  {svc.url ? (
                    <a
                      href={svc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block font-mono text-[11px] text-indigo-600 dark:text-indigo-400 hover:underline break-all"
                    >
                      {redactPii ? maskPiiString(svc.url, true) : svc.url}
                    </a>
                  ) : (
                    <span className="block text-[11px] text-slate-400 dark:text-slate-500">
                      Requires Google Photo / Gaia ID
                    </span>
                  )}
                </div>

                {svc.url && !redactPii && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    <a
                      href={svc.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400 transition-colors"
                    >
                      <span>Open</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <button
                      type="button"
                      onClick={() => void handleCopy(svc.key, svc.url!)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400 transition-colors cursor-pointer"
                    >
                      {copiedKey === svc.key ? (
                        <>
                          <Check className="w-3 h-3 text-emerald-600" />
                          <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy className="w-3 h-3" />
                          <span>Copy URL</span>
                        </>
                      )}
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Compact Secondary Intelligence Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] space-y-1">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
            Maps Contributor Reviews
          </p>
          <p className="font-display text-sm font-bold text-[#0F172A] dark:text-slate-100 tabular-nums">
            {intel.mapsReviewsCount} indexed
            {typeof intel.mapsPhotosCount === 'number' && intel.mapsPhotosCount > 0
              ? ` · ${intel.mapsPhotosCount} photos`
              : ''}
          </p>
        </div>

        <div className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] space-y-1">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
            Reachable Google Apps
          </p>
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200 break-words">
            {intel.inAppReachability.length > 0
              ? intel.inAppReachability.join(' · ')
              : 'Gmail MX Check'}
          </p>
        </div>

        <div className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] space-y-1">
          <p className="text-[11px] uppercase tracking-wider font-semibold text-slate-400">
            Calendar & Mail Posture
          </p>
          <p className="text-xs font-medium text-slate-700 dark:text-slate-200">
            Calendar: {intel.publicCalendar ? 'Public' : 'Private'} · SPF:{' '}
            {intel.spfPolicy ? 'Yes' : 'No'} · DMARC: {intel.dmarcPolicy ? 'Yes' : 'No'}
          </p>
        </div>
      </div>

      {/* Approximate Location Center & Triangulation Ring */}
      {intel.locationRing ? (
        <div className="p-4 rounded-xl border border-orange-200/80 dark:border-orange-900/60 bg-orange-50/50 dark:bg-orange-950/20 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-start gap-3 min-w-0">
            <span className="w-9 h-9 rounded-xl bg-orange-100 dark:bg-orange-950/60 border border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400 flex items-center justify-center shrink-0">
              <Radar className="w-4 h-4" />
            </span>
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                  Approximate Location Center & Triangulation Ring
                </span>
                <span className="text-orange-700 dark:text-orange-300 font-semibold tabular-nums">
                  · ±{intel.locationRing.radiusKm} km radius · {intel.locationRing.confidence}{' '}
                  confidence
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 tabular-nums">
                Centroid:{' '}
                <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100">
                  {intel.locationRing.centerLat.toFixed(4)}, {intel.locationRing.centerLng.toFixed(4)}
                </span>{' '}
                · Area: <span className="font-medium">{intel.locationRing.estimatedAreaLabel}</span>{' '}
                · Derived from {intel.locationRing.sampleCount}/{intel.locationRing.totalGeoReviews}{' '}
                geo-tagged reviews
                {intel.locationRing.outliersTrimmed > 0
                  ? ` (${intel.locationRing.outliersTrimmed} travel outlier${
                      intel.locationRing.outliersTrimmed === 1 ? '' : 's'
                    } trimmed)`
                  : ''}
              </p>
            </div>
          </div>

          {onFocusMapLocation && (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                onFocusMapLocation(
                  intel.locationRing!.centerLat,
                  intel.locationRing!.centerLng,
                  zoomForRadiusKm(intel.locationRing!.radiusKm),
                  'ghunt-location-ring-center'
                )
              }
              className="border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-300 hover:bg-orange-100/70 dark:hover:bg-orange-950/50 shrink-0"
            >
              <Crosshair className="w-3.5 h-3.5" />
              <span>Focus Ring on Map</span>
            </Button>
          )}
        </div>
      ) : (
        (!intel.tokenConfigured || intel.authMode === 'public_metadata' || (Boolean(intel.note) && intel.reviews.length === 0)) && (
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-[#0B1120] flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              {!intel.tokenConfigured || intel.authMode === 'public_metadata' ? (
                <KeyRound className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              ) : (
                <Compass className="w-4 h-4 text-indigo-600 dark:text-indigo-400 shrink-0 mt-0.5" />
              )}
              <div className="text-xs space-y-1">
                <p className="font-semibold text-[#0F172A] dark:text-slate-100">
                  {intel.tokenConfigured && intel.authMode !== 'public_metadata'
                    ? 'GHunt Authenticated Check Status'
                    : 'Public Metadata Mode Active'}
                </p>
                <p className="text-slate-500 dark:text-slate-400 leading-relaxed">
                  {intel.note ||
                    'Verified via Google Workspace MX/SPF/DMARC, public Calendar ICS, Gravatar, and Google Avatar endpoints. Add a Google OAuth refresh token (1//* + client credentials), Android master token (aas_et/*), or Google cookies (GHUNT_COOKIES) to unlock private Gaia IDs and Maps reviews.'}
                </p>
              </div>
            </div>
          </div>
        )
      )}

      {/* Google Maps Contributor Reviews List or Transparent Public Index Fallback */}
      {intel.reviews.length > 0 ? (
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
                Google Maps Reviews ({intel.reviews.length})
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Geo-tagged places reviewed by this Google contributor · Click Focus Pin to inspect on the map.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={reviewQuery}
                  onChange={(e) => setReviewQuery(e.target.value)}
                  placeholder="Filter place or text..."
                  aria-label="Filter Maps reviews"
                  className="pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] text-xs text-[#0F172A] dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-[#0B1120] p-0.5 text-[11px]">
                {(
                  [
                    { id: 'all', label: 'All' },
                    { id: 'high', label: '4-5★' },
                    { id: 'low', label: '1-3★' },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setRatingFilter(tab.id)}
                    className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                      ratingFilter === tab.id
                        ? 'bg-[#0F172A] dark:bg-indigo-600 text-white'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-200/80 dark:divide-slate-800 max-h-[420px] overflow-y-auto bg-white dark:bg-[#0B1120]">
            {filteredReviews.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500 dark:text-slate-400">
                No Maps reviews match the current filter.
              </div>
            ) : (
              filteredReviews.map((rev) => {
                const shownComment = rev.comment
                  ? redactPii
                    ? maskPiiString(rev.comment, true)
                    : rev.comment
                  : undefined;
                const shownAddress = rev.address
                  ? redactPii
                    ? maskPiiString(rev.address, true)
                    : rev.address
                  : undefined;

                return (
                  <div
                    key={rev.id}
                    className="p-4 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 hover:bg-slate-50/70 dark:hover:bg-slate-900/40 transition-colors"
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-xs sm:text-sm text-[#0F172A] dark:text-slate-100">
                          {rev.placeName}
                        </span>
                        {rev.rating > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 dark:text-amber-400 tabular-nums">
                            <Star className="w-3.5 h-3.5 fill-amber-500 text-amber-500" />
                            <span>{rev.rating}.0</span>
                          </span>
                        )}
                        {rev.dateText && (
                          <span className="text-[11px] text-slate-400 tabular-nums">
                            · {rev.dateText}
                          </span>
                        )}
                      </div>

                      {shownAddress && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                          <MapPin className="w-3 h-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                          <span className="truncate">{shownAddress}</span>
                        </p>
                      )}

                      {shownComment && (
                        <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                          “{shownComment}”
                        </p>
                      )}

                      {typeof rev.lat === 'number' && typeof rev.lng === 'number' && (
                        <p className="font-mono text-[11px] text-slate-400 tabular-nums">
                          {rev.lat.toFixed(5)}, {rev.lng.toFixed(5)}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {typeof rev.lat === 'number' &&
                        typeof rev.lng === 'number' &&
                        onFocusMapLocation && (
                          <button
                            type="button"
                            onClick={() =>
                              onFocusMapLocation(rev.lat!, rev.lng!, 14, `ghunt-map-${rev.id}`)
                            }
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50/70 dark:bg-emerald-950/30 text-[11px] font-medium text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100/80 dark:hover:bg-emerald-950/60 transition-colors cursor-pointer"
                          >
                            <Crosshair className="w-3 h-3" />
                            <span>Focus Pin</span>
                          </button>
                        )}
                      {(rev.reviewUrl || rev.placeUrl) && (
                        <a
                          href={rev.reviewUrl || rev.placeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:text-[#0F172A] dark:hover:text-white hover:border-slate-300 transition-colors"
                        >
                          <span>Maps</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        <div className="p-4 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0B1120] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h3 className="text-xs sm:text-sm font-semibold text-[#0F172A] dark:text-slate-100 tabular-nums">
              Google Maps Contributor & Reviews ({intel.mapsReviewsCount} indexed)
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
              {intel.gaiaId
                ? intel.mapsRateLimited
                  ? `Resolved Gaia ID ${redactPii ? maskPiiString(intel.gaiaId, true) : intel.gaiaId}, but Google Maps rate-limited review scraping from this shared server IP (HTTP 429). Click Open Maps Reviews to view reviews directly in your browser.`
                  : intel.tokenConfigured
                  ? `Authenticated GHunt session resolved Gaia ID ${redactPii ? maskPiiString(intel.gaiaId, true) : intel.gaiaId} and verified Google Maps contributor profile (${intel.mapsReviewsCount} public reviews indexed).`
                  : `Gaia ID ${redactPii ? maskPiiString(intel.gaiaId, true) : intel.gaiaId} resolved with ${intel.mapsReviewsCount} public review items indexed. Open the contributor profile directly to inspect Local Guide activity.`
                : 'No public Google Gaia ID was exposed for this email. Use the search pivot to check publicly indexed Google Maps contributor pages.'}
            </p>
          </div>
          {intel.mapsContribUrl && (
            <a
              href={intel.mapsContribUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 text-xs font-medium text-slate-700 dark:text-slate-200 hover:border-indigo-400 transition-colors shrink-0 whitespace-nowrap"
            >
              <span>{intel.gaiaId ? 'Open Maps Reviews' : 'Search Maps Contributors'}</span>
              <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            </a>
          )}
        </div>
      )}
    </Card>
  );
}
