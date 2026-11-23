import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Camera,
  CheckCircle2,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Pin,
  ScanFace,
  ShieldCheck,
  Sparkles,
  Upload,
  XCircle,
} from 'lucide-react';
import type {
  FacialAnalysisResponse,
  FacialCandidateMatch,
  FaceMatchVerdict,
  ProfilePhotoItem,
} from '@/src/types/investigation';
import { analyzeFacialRecognition } from '@/src/lib/api';
import { Dialog } from '@/src/components/ui/Dialog';
import { Button } from '@/src/components/ui/Button';

interface FacialRecognitionDialogProps {
  open: boolean;
  onClose: () => void;
  target: string;
  profilePhotos: ProfilePhotoItem[];
  initialPhotoId?: string;
  pinnedMatchIds?: Set<string>;
  onTogglePinMatch?: (match: FacialCandidateMatch) => void;
}

interface UploadedRefState {
  label: string;
  mimeType: string;
  base64: string;
  previewDataUrl: string;
}

function fileToBase64Parts(file: File): Promise<UploadedRefState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read image file.'));
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const commaIdx = dataUrl.indexOf(',');
      if (commaIdx < 0) {
        reject(new Error('Unsupported image encoding.'));
        return;
      }
      const meta = dataUrl.slice(0, commaIdx);
      const mimeMatch = /data:([^;]+);base64/i.exec(meta);
      const mimeType = mimeMatch?.[1] || file.type || 'image/jpeg';
      const base64 = dataUrl.slice(commaIdx + 1);
      resolve({
        label: file.name || 'Uploaded Reference Photo',
        mimeType,
        base64,
        previewDataUrl: dataUrl,
      });
    };
    reader.readAsDataURL(file);
  });
}

function verdictStyle(verdict: FaceMatchVerdict): {
  text: string;
  bar: string;
  border: string;
} {
  switch (verdict) {
    case 'High Confidence Match':
      return {
        text: 'text-emerald-700 dark:text-emerald-300',
        bar: 'bg-emerald-500',
        border: 'border-emerald-200/80 dark:border-emerald-900/60',
      };
    case 'Probable Match':
      return {
        text: 'text-indigo-700 dark:text-indigo-300',
        bar: 'bg-indigo-500',
        border: 'border-indigo-200/80 dark:border-indigo-900/60',
      };
    case 'Inconclusive':
      return {
        text: 'text-amber-700 dark:text-amber-300',
        bar: 'bg-amber-500',
        border: 'border-amber-200/80 dark:border-amber-900/60',
      };
    case 'Different Person':
      return {
        text: 'text-rose-700 dark:text-rose-300',
        bar: 'bg-rose-500',
        border: 'border-rose-200/80 dark:border-rose-900/60',
      };
    default:
      return {
        text: 'text-slate-500 dark:text-slate-400',
        bar: 'bg-slate-400',
        border: 'border-slate-200/80 dark:border-slate-800',
      };
  }
}

export function FacialRecognitionDialog({
  open,
  onClose,
  target,
  profilePhotos,
  initialPhotoId,
  pinnedMatchIds,
  onTogglePinMatch,
}: FacialRecognitionDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadedRef, setUploadedRef] = useState<UploadedRefState | null>(null);
  const [selectedPhotoId, setSelectedPhotoId] = useState<string>(
    initialPhotoId || profilePhotos[0]?.id || ''
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<FacialAnalysisResponse | null>(null);

  useEffect(() => {
    if (!open) return;
    if (initialPhotoId) {
      setSelectedPhotoId(initialPhotoId);
      setUploadedRef(null);
    } else if (!selectedPhotoId && profilePhotos[0]?.id) {
      setSelectedPhotoId(profilePhotos[0].id);
    }
  }, [open, initialPhotoId, profilePhotos, selectedPhotoId]);

  const activeReferencePreview = useMemo(() => {
    if (uploadedRef) return uploadedRef.previewDataUrl;
    const found = profilePhotos.find((p) => p.id === selectedPhotoId);
    return found?.url || profilePhotos[0]?.url || '';
  }, [uploadedRef, profilePhotos, selectedPhotoId]);

  const activeReferenceLabel = useMemo(() => {
    if (uploadedRef) return uploadedRef.label;
    const found =
      profilePhotos.find((p) => p.id === selectedPhotoId) || profilePhotos[0];
    if (!found) return 'No Reference Selected';
    return `${found.platform}${found.handle ? ` (${found.handle.includes('@') ? found.handle : `@${found.handle}`})` : ''}`;
  }, [uploadedRef, profilePhotos, selectedPhotoId]);

  const handleUploadFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (file.size > 4 * 1024 * 1024) {
      setError('Please choose an image smaller than 4 MB.');
      return;
    }
    try {
      const parsed = await fileToBase64Parts(file);
      setUploadedRef(parsed);
      setReport(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to read image.');
    }
  };

  const handleRunScan = async () => {
    if (running) return;
    if (!uploadedRef && profilePhotos.length === 0) {
      setError('Upload a reference face photo or scan a target with public profile avatars.');
      return;
    }

    setRunning(true);
    setError(null);
    try {
      const res = await analyzeFacialRecognition({
        target,
        referenceImage: uploadedRef
          ? {
              label: uploadedRef.label,
              mimeType: uploadedRef.mimeType,
              base64: uploadedRef.base64,
            }
          : undefined,
        referencePhotoId: uploadedRef
          ? undefined
          : selectedPhotoId || profilePhotos[0]?.id,
        candidates: profilePhotos.slice(0, 10).map((p) => ({
          id: p.id,
          platform: p.platform,
          url: p.url,
          handle: p.handle,
        })),
      });
      setReport(res);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Facial recognition comparison failed.'
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Facial Recognition & Visual Identity Lab"
      description="Compare a reference face or discovered avatar against all resolved platform profile photos and launch reverse-face OSINT lookups."
      maxWidthClass="max-w-3xl"
    >
      <div className="space-y-5">
        {/* Reference Face Selector: Upload OR Pick Discovered Avatar */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Upload Dropzone */}
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              void handleUploadFile(e.dataTransfer.files?.[0]);
            }}
            className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-4 flex flex-col items-center justify-center text-center gap-2.5"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={(e) => void handleUploadFile(e.target.files?.[0])}
              className="hidden"
            />
            {uploadedRef ? (
              <div className="flex items-center gap-3 w-full text-left">
                <img
                  src={uploadedRef.previewDataUrl}
                  alt="Uploaded reference face"
                  className="w-14 h-14 rounded-xl object-cover border border-indigo-300 dark:border-indigo-700 shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                    {uploadedRef.label}
                  </p>
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                    Reference photo loaded
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline cursor-pointer"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadedRef(null)}
                      className="text-[11px] font-medium text-slate-500 hover:text-rose-600 cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <Upload className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
                <div className="space-y-0.5">
                  <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
                    Upload Reference Face Photo
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    JPEG, PNG, or WebP up to 4 MB
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={running}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>Select Photo</span>
                </Button>
              </>
            )}
          </div>

          {/* Or Pick Discovered Platform Avatar */}
          <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-[#0E1526] p-4 flex flex-col justify-between gap-3">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-orange-600" />
                <span>Or Use Discovered Platform Avatar ({profilePhotos.length})</span>
              </p>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Cross-verify if all discovered social & code profiles show the same person.
              </p>
            </div>

            {profilePhotos.length === 0 ? (
              <p className="text-[11px] text-slate-400 py-3 text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
                No public avatars resolved in this scan — upload a reference photo on the left.
              </p>
            ) : (
              <div className="flex items-center gap-2 overflow-x-auto pb-1">
                {profilePhotos.slice(0, 8).map((p) => {
                  const active = !uploadedRef && selectedPhotoId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => {
                        setUploadedRef(null);
                        setSelectedPhotoId(p.id);
                      }}
                      className={`p-1.5 rounded-xl border flex flex-col items-center gap-1 w-20 shrink-0 transition-colors cursor-pointer ${
                        active
                          ? 'border-indigo-500 bg-indigo-50/70 dark:bg-indigo-950/40'
                          : 'border-slate-200 dark:border-slate-700 hover:border-slate-400'
                      }`}
                    >
                      <img
                        src={p.url}
                        alt={p.platform}
                        referrerPolicy="no-referrer"
                        className="w-10 h-10 rounded-lg object-cover bg-slate-100 dark:bg-slate-800"
                      />
                      <span className="text-[10px] font-medium text-[#0F172A] dark:text-slate-200 truncate w-full text-center">
                        {p.platform}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Action Strip */}
        <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50/80 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5 min-w-0">
            {activeReferencePreview ? (
              <img
                src={activeReferencePreview}
                alt="Baseline"
                referrerPolicy="no-referrer"
                className="w-9 h-9 rounded-lg object-cover border border-slate-200 dark:border-slate-700 shrink-0"
              />
            ) : (
              <span className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                <ScanFace className="w-4 h-4 text-slate-500" />
              </span>
            )}
            <div className="min-w-0">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Baseline Face Reference
              </p>
              <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                {activeReferenceLabel}
              </p>
            </div>
          </div>

          <Button
            variant="gradient"
            size="sm"
            disabled={running || (!uploadedRef && profilePhotos.length === 0)}
            onClick={() => void handleRunScan()}
          >
            {running ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <ScanFace className="w-3.5 h-3.5" />
            )}
            <span>
              {running
                ? 'Analyzing Facial Geometry...'
                : 'Run Facial Recognition Match'}
            </span>
          </Button>
        </div>

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-200 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Analysis Output */}
        {report && (
          <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            {report.warning && (
              <div className="p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{report.warning}</span>
              </div>
            )}

            {/* Reference Face Analysis Card */}
            <div className="p-4 rounded-2xl bg-white dark:bg-[#0E1526] border border-slate-200/80 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="text-sm font-semibold text-[#0F172A] dark:text-slate-100">
                    Reference Facial Assessment
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-[11px]">
                  <span
                    className={`font-semibold inline-flex items-center gap-1 ${
                      report.reference.faceDetected
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    {report.reference.faceDetected ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5" />
                    )}
                    <span>
                      {report.reference.faceDetected ? 'Face Detected' : 'No Clear Face'}
                    </span>
                  </span>
                  <span className="text-slate-300 dark:text-slate-700">·</span>
                  <span className="font-mono text-slate-500 dark:text-slate-400">
                    Quality: {report.reference.quality}
                  </span>
                </div>
              </div>

              <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                {report.overallSummary}
              </p>

              {report.reference.description && (
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  {report.reference.description}
                </p>
              )}

              {report.reference.facialAttributes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {report.reference.facialAttributes.map((attr, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-medium text-slate-700 dark:text-slate-200"
                    >
                      {attr}
                    </span>
                  ))}
                </div>
              )}

              {report.reference.sourceUrl && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-3 text-[11px]">
                  <span className="font-semibold text-slate-500 dark:text-slate-400">
                    Reverse Face Search Reference:
                  </span>
                  <a
                    href={`https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(
                      report.reference.sourceUrl
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <span>Yandex Images</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                  <a
                    href={`https://lens.google.com/uploadbyurl?url=${encodeURIComponent(
                      report.reference.sourceUrl
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <span>Google Lens</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                  <a
                    href={`https://tineye.com/search?url=${encodeURIComponent(
                      report.reference.sourceUrl
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                  >
                    <span>TinEye</span>
                    <ArrowUpRight className="w-3 h-3" />
                  </a>
                </div>
              )}
            </div>

            {/* Candidate Comparisons */}
            {report.matches.length > 0 && (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-[#0F172A] dark:text-slate-100">
                    Cross-Platform Facial Comparison ({report.matches.length})
                  </span>
                  <span className="font-mono text-[11px] text-slate-400">
                    {report.model ? `${report.model} · ` : ''}
                    {(report.durationMs / 1000).toFixed(1)}s
                  </span>
                </div>

                <div className="grid grid-cols-1 gap-3">
                  {report.matches.map((m) => {
                    const st = verdictStyle(m.verdict);
                    return (
                      <div
                        key={m.id}
                        className={`p-4 rounded-2xl bg-white dark:bg-[#0B1120] border ${st.border} space-y-3`}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <img
                              src={m.url}
                              alt={m.platform}
                              referrerPolicy="no-referrer"
                              className="w-12 h-12 rounded-xl object-cover border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                                  {m.platform}
                                </p>
                                {m.exactByteMatch && (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-mono font-semibold text-emerald-700 dark:text-emerald-300">
                                    <ShieldCheck className="w-3 h-3" />
                                    <span>SHA-256 Identical</span>
                                  </span>
                                )}
                              </div>
                              {m.handle && (
                                <p className="text-xs font-mono text-slate-400 truncate">
                                  {m.handle.includes('@') ? m.handle : `@${m.handle}`}
                                </p>
                              )}
                            </div>
                          </div>

                          <div className="flex items-center gap-3 shrink-0">
                            <div className="text-right">
                              <p className={`text-xs font-bold ${st.text}`}>
                                {m.verdict}
                              </p>
                              <p className="font-mono text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                                {m.similarityScore}% match
                              </p>
                            </div>
                            {onTogglePinMatch && (
                              <button
                                type="button"
                                onClick={() => onTogglePinMatch(m)}
                                title={
                                  pinnedMatchIds?.has(m.id)
                                    ? 'Pinned to Case Board'
                                    : 'Pin to Case Board'
                                }
                                className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium transition-colors cursor-pointer ${
                                  pinnedMatchIds?.has(m.id)
                                    ? 'bg-indigo-50 dark:bg-indigo-950/60 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                                    : 'bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-indigo-300'
                                }`}
                              >
                                <Pin className="w-3 h-3" />
                                <span>{pinnedMatchIds?.has(m.id) ? 'Pinned' : 'Pin'}</span>
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Confidence Bar */}
                        <div className="w-full h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${st.bar} transition-all duration-300`}
                            style={{ width: `${Math.max(4, m.similarityScore)}%` }}
                          />
                        </div>

                        <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                          {m.comparisonSummary}
                        </p>

                        {(m.matchingFeatures.length > 0 || m.differingFeatures.length > 0) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                            {m.matchingFeatures.length > 0 && (
                              <div className="p-2.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/25 border border-emerald-200/60 dark:border-emerald-900/50 space-y-1">
                                <p className="font-semibold text-emerald-800 dark:text-emerald-300">
                                  Matching Landmarks
                                </p>
                                <ul className="space-y-0.5 text-emerald-900/80 dark:text-emerald-200/80">
                                  {m.matchingFeatures.slice(0, 4).map((f, idx) => (
                                    <li key={idx}>• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            {m.differingFeatures.length > 0 && (
                              <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-900/60 border border-slate-200/80 dark:border-slate-800 space-y-1">
                                <p className="font-semibold text-slate-700 dark:text-slate-200">
                                  Observed Differences
                                </p>
                                <ul className="space-y-0.5 text-slate-600 dark:text-slate-400">
                                  {m.differingFeatures.slice(0, 4).map((f, idx) => (
                                    <li key={idx}>• {f}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>
                        )}

                        {m.reverseSearch && (
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2 text-[11px]">
                            <span className="text-slate-400">Reverse Face OSINT:</span>
                            <div className="flex flex-wrap items-center gap-3">
                              <a
                                href={m.reverseSearch.yandexUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                <span>Yandex</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <a
                                href={m.reverseSearch.googleLensUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                <span>Google Lens</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <a
                                href={m.reverseSearch.bingVisualUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                <span>Bing Visual</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                              <a
                                href={m.reverseSearch.tineyeUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
                              >
                                <span>TinEye</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
