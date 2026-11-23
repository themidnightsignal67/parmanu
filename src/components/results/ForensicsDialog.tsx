import { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  Check,
  Copy,
  FileSearch,
  Hash,
  Loader2,
  MapPin,
  Upload,
} from 'lucide-react';
import type { GeoMarker, ProfilePhotoItem } from '@/src/types/investigation';
import { inspectRemoteAssetForensics } from '@/src/lib/api';
import {
  analyzeBufferForensics,
  type ForensicsMetadataResult,
  md5Hex,
} from '@/src/lib/forensics';
import { Dialog } from '@/src/components/ui/Dialog';
import { Button } from '@/src/components/ui/Button';

interface ForensicsDialogProps {
  open: boolean;
  onClose: () => void;
  target?: string;
  targetType?: string;
  profilePhotos?: ProfilePhotoItem[];
  onAddExifGeoMarker?: (marker: GeoMarker) => void;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export function ForensicsDialog({
  open,
  onClose,
  target,
  targetType,
  profilePhotos = [],
  onAddExifGeoMarker,
}: ForensicsDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ForensicsMetadataResult | null>(null);
  const [copiedHash, setCopiedHash] = useState<string | null>(null);

  const gravatarEmailHash = useMemo(() => {
    if (target && targetType === 'email') {
      return md5Hex(target.trim().toLowerCase());
    }
    return null;
  }, [target, targetType]);

  const emitExifGpsMarker = (
    fileName: string,
    gps?: { lat: number; lng: number } | null
  ) => {
    if (!gps || !onAddExifGeoMarker) return;
    onAddExifGeoMarker({
      id: `geo-exif-${gps.lat.toFixed(4)}-${gps.lng.toFixed(4)}`,
      label: `EXIF GPS (${fileName})`,
      region: 'EXIF Photo GPS',
      country: `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`,
      lat: gps.lat,
      lng: gps.lng,
      source: `EXIF Forensics (${fileName})`,
      count: 1,
    });
  };

  const handleLocalFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setAnalyzing(true);
    try {
      const buffer = await file.arrayBuffer();
      const parsed = await analyzeBufferForensics(
        file.name,
        file.type || 'application/octet-stream',
        buffer
      );
      setResult(parsed);
      emitExifGpsMarker(parsed.fileName, parsed.gps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to parse file metadata.');
    } finally {
      setAnalyzing(false);
    }
  };

  const handleInspectPhoto = async (photo: ProfilePhotoItem) => {
    setError(null);
    setAnalyzing(true);
    try {
      const remote = await inspectRemoteAssetForensics(photo.url);
      const buf = base64ToArrayBuffer(remote.sampleBase64);
      const parsed = await analyzeBufferForensics(
        `${photo.platform.toLowerCase().replace(/\s+/g, '-')}-avatar`,
        remote.contentType,
        buf,
        {
          ...(remote.serverHeader ? { server: remote.serverHeader } : {}),
          ...(remote.lastModified ? { 'last-modified': remote.lastModified } : {}),
          ...(remote.etag ? { etag: remote.etag } : {}),
        }
      );
      const merged = {
        ...parsed,
        sizeBytes: remote.sizeBytes,
        sha256: remote.sha256,
        md5: remote.md5,
      };
      setResult(merged);
      emitExifGpsMarker(merged.fileName, merged.gps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to inspect remote image.');
    } finally {
      setAnalyzing(false);
    }
  };

  const copyText = (key: string, val: string) => {
    navigator.clipboard.writeText(val);
    setCopiedHash(key);
    setTimeout(() => setCopiedHash(null), 1400);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Image, Avatar & Document Forensics Lab"
      description="Inspect JPEG EXIF camera/GPS tags, PNG chunks, PDF author metadata, SHA-256 checksums, and Gravatar MD5 hashes."
      maxWidthClass="max-w-2xl"
    >
      <div className="space-y-5">
        {gravatarEmailHash && (
          <div className="p-3.5 rounded-xl bg-indigo-50/70 dark:bg-indigo-950/40 border border-indigo-200/80 dark:border-indigo-900/60 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="space-y-0.5 min-w-0">
              <p className="font-semibold text-indigo-950 dark:text-indigo-200">
                Target Gravatar MD5 Identity Hash
              </p>
              <p className="font-mono text-indigo-700 dark:text-indigo-300 truncate">
                {gravatarEmailHash}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => copyText('gravatar', gravatarEmailHash)}
            >
              {copiedHash === 'gravatar' ? (
                <Check className="w-3.5 h-3.5 text-emerald-600" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>Copy MD5</span>
            </Button>
          </div>
        )}

        {/* Dropzone / Upload */}
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleLocalFile(e.dataTransfer.files?.[0]);
          }}
          className="rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/50 p-6 text-center space-y-3"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,.pdf,.txt,.json"
            onChange={(e) => handleLocalFile(e.target.files?.[0])}
            className="hidden"
          />
          <Upload className="w-6 h-6 text-indigo-600 dark:text-indigo-400 mx-auto" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
              Drop any JPEG, PNG, or PDF file here to inspect locally
            </p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Zero external upload — SHA-256, MD5, EXIF & PDF metadata run right in your browser.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={analyzing}
          >
            <FileSearch className="w-3.5 h-3.5" />
            <span>Choose File</span>
          </Button>
        </div>

        {/* Discovered Investigation Profile Avatars */}
        {profilePhotos.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100">
              Inspect Discovered Profile Avatars ({profilePhotos.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {profilePhotos.slice(0, 6).map((photo) => (
                <button
                  key={photo.id}
                  type="button"
                  onClick={() => handleInspectPhoto(photo)}
                  disabled={analyzing}
                  className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 hover:border-indigo-400 flex items-center gap-3 text-left transition-colors cursor-pointer"
                >
                  <img
                    src={photo.url}
                    alt={photo.platform}
                    referrerPolicy="no-referrer"
                    className="w-9 h-9 rounded-lg object-cover shrink-0 bg-slate-100 dark:bg-slate-800"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-[#0F172A] dark:text-slate-100 truncate">
                      {photo.platform}
                    </p>
                    <p className="text-[11px] text-indigo-600 dark:text-indigo-400 truncate">
                      Compute SHA-256 & EXIF
                    </p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {analyzing && (
          <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200 dark:border-slate-800 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
            <span>Extracting EXIF headers, PDF tags, and cryptographic hashes...</span>
          </div>
        )}

        {error && (
          <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/60 text-xs text-rose-700 dark:text-rose-200">
            {error}
          </div>
        )}

        {result && (
          <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-[#0F172A] dark:text-slate-100">
                  {result.fileName}
                </p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  {result.mimeType} · {(result.sizeBytes / 1024).toFixed(1)} KB
                  {result.dimensions ? ` · ${result.dimensions}` : ''}
                </p>
              </div>
              <a
                href={`https://www.google.com/search?q=${encodeURIComponent(result.sha256)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Search SHA-256 on Google
              </a>
            </div>

            {result.warnings.length > 0 && (
              <div className="space-y-1.5">
                {result.warnings.map((w, idx) => (
                  <div
                    key={idx}
                    className="px-3 py-2 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/60 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2"
                  >
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                    <span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 text-xs">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Hash className="w-3 h-3" />
                    <span>SHA-256 Digest</span>
                  </p>
                  <p className="font-mono font-medium text-[#0F172A] dark:text-slate-100 truncate">
                    {result.sha256}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyText('sha256', result.sha256)}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 cursor-pointer shrink-0"
                >
                  {copiedHash === 'sha256' ? (
                    <Check className="w-3.5 h-3.5 text-emerald-500" />
                  ) : (
                    <Copy className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>

              {result.md5 && (
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-900/70 border border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[11px] text-slate-500 dark:text-slate-400">
                      MD5 Digest
                    </p>
                    <p className="font-mono font-medium text-[#0F172A] dark:text-slate-100 truncate">
                      {result.md5}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyText('md5', result.md5!)}
                    className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-600 cursor-pointer shrink-0"
                  >
                    {copiedHash === 'md5' ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              )}
            </div>

            {(result.cameraMake || result.cameraModel || result.software || result.dateTimeOriginal || result.gps) && (
              <div className="p-3.5 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-[#0E1526] space-y-2 text-xs">
                <p className="font-semibold text-[#0F172A] dark:text-slate-100 flex items-center gap-1.5">
                  <Camera className="w-3.5 h-3.5 text-indigo-600" />
                  <span>Embedded EXIF & Creation Telemetry</span>
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-600 dark:text-slate-300">
                  {result.cameraMake && <p>Make: <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100">{result.cameraMake}</span></p>}
                  {result.cameraModel && <p>Model: <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100">{result.cameraModel}</span></p>}
                  {result.software && <p>Software: <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100">{result.software}</span></p>}
                  {result.dateTimeOriginal && <p>Timestamp: <span className="font-mono font-semibold text-[#0F172A] dark:text-slate-100">{result.dateTimeOriginal}</span></p>}
                </div>
                {result.gps && (
                  <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-emerald-700 dark:text-emerald-300 font-mono">
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      <span>GPS: {result.gps.lat}, {result.gps.lng}</span>
                    </span>
                    {onAddExifGeoMarker && (
                      <span className="text-[11px] font-sans font-semibold text-emerald-600 dark:text-emerald-400">
                        Auto-plotted on Investigation Geo Map
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}

            {(result.pdfMeta || result.pngChunks || result.headers) && (
              <pre className="p-3.5 rounded-xl bg-[#0F172A] text-slate-100 font-mono text-[11px] overflow-x-auto max-h-48">
                {JSON.stringify(
                  {
                    ...(result.pdfMeta ? { pdfMetadata: result.pdfMeta } : {}),
                    ...(result.pngChunks ? { pngChunks: result.pngChunks } : {}),
                    ...(result.headers ? { httpHeaders: result.headers } : {}),
                  },
                  null,
                  2
                )}
              </pre>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
