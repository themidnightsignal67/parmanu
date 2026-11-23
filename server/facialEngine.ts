import crypto from 'node:crypto';
import type {
  FacialAnalysisResponse,
  FacialCandidateInput,
  FacialCandidateMatch,
  FacialReverseSearchLinks,
} from '../src/types/investigation.ts';
import {
  analyzeFacesWithGemini,
  type GeminiFacialImageInput,
} from './geminiRotator.ts';

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

export function isSafeFacialImageUrl(rawUrl: string): URL | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      host === '0.0.0.0' ||
      host === '::1' ||
      host === '[::1]' ||
      /^\[?(fe80|fc00|fd[0-9a-f]{2}):/i.test(host) ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function detectImageMimeFromBytes(buf: Buffer, headerType: string): string | null {
  if (buf.length < 12) return null;
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg';
  }
  // PNG: 89 50 4E 47
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return 'image/png';
  }
  // WEBP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  // GIF: GIF87a / GIF89a
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') {
    return 'image/gif';
  }

  const cleanHeader = headerType.split(';')[0].trim().toLowerCase();
  if (cleanHeader === 'image/jpg') return 'image/jpeg';
  if (ALLOWED_MIME.has(cleanHeader)) return cleanHeader;
  return null;
}

export function buildReverseSearchLinks(imageUrl: string): FacialReverseSearchLinks | undefined {
  if (!isSafeFacialImageUrl(imageUrl)) return undefined;
  const enc = encodeURIComponent(imageUrl);
  return {
    yandexUrl: `https://yandex.com/images/search?rpt=imageview&url=${enc}`,
    googleLensUrl: `https://lens.google.com/uploadbyurl?url=${enc}`,
    bingVisualUrl: `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${enc}`,
    tineyeUrl: `https://tineye.com/search?url=${enc}`,
  };
}

interface DownloadedImage {
  ok: boolean;
  mimeType: string;
  base64: string;
  sha256: string;
  error?: string;
}

async function fetchRemoteAvatarSafely(rawUrl: string): Promise<DownloadedImage> {
  let currentUrl = rawUrl;
  for (let hop = 0; hop < 3; hop++) {
    const parsed = isSafeFacialImageUrl(currentUrl);
    if (!parsed) {
      return {
        ok: false,
        mimeType: '',
        base64: '',
        sha256: '',
        error: 'Blocked unsafe or non-HTTPS URL.',
      };
    }

    try {
      const res = await fetch(parsed.toString(), {
        headers: {
          'User-Agent': 'Parmanu-OSINT/3.1',
          Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.8',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(5500),
      });

      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get('location');
        if (!loc) {
          return { ok: false, mimeType: '', base64: '', sha256: '', error: 'Empty redirect.' };
        }
        currentUrl = new URL(loc, parsed.toString()).toString();
        continue;
      }

      if (!res.ok) {
        return {
          ok: false,
          mimeType: '',
          base64: '',
          sha256: '',
          error: `HTTP ${res.status}`,
        };
      }

      const arr = new Uint8Array(await res.arrayBuffer());
      if (arr.byteLength < 300) {
        return {
          ok: false,
          mimeType: '',
          base64: '',
          sha256: '',
          error: 'Placeholder or empty image response.',
        };
      }
      if (arr.byteLength > MAX_IMAGE_BYTES) {
        return {
          ok: false,
          mimeType: '',
          base64: '',
          sha256: '',
          error: 'Image exceeds 4 MB limit.',
        };
      }

      const buf = Buffer.from(arr);
      const mimeType = detectImageMimeFromBytes(
        buf,
        res.headers.get('content-type') || ''
      );
      if (!mimeType) {
        return {
          ok: false,
          mimeType: '',
          base64: '',
          sha256: '',
          error: 'Unsupported image format (non-raster or SVG).',
        };
      }

      return {
        ok: true,
        mimeType,
        base64: buf.toString('base64'),
        sha256: crypto.createHash('sha256').update(buf).digest('hex'),
      };
    } catch (err) {
      return {
        ok: false,
        mimeType: '',
        base64: '',
        sha256: '',
        error: err instanceof Error ? err.message : 'Fetch failed.',
      };
    }
  }

  return { ok: false, mimeType: '', base64: '', sha256: '', error: 'Too many redirects.' };
}

export async function runFacialRecognitionAnalysis(params: {
  target: string;
  referenceImage?: {
    label?: string;
    mimeType: string;
    base64: string;
  };
  referencePhotoId?: string;
  candidates: FacialCandidateInput[];
}): Promise<FacialAnalysisResponse> {
  const t0 = Date.now();
  const cleanTarget = params.target.trim() || 'Target';
  const candidateList = params.candidates.slice(0, 10);

  // Download all candidate avatars in parallel safely
  const fetchedEntries = await Promise.all(
    candidateList.map(async (c) => ({
      candidate: c,
      asset: await fetchRemoteAvatarSafely(c.url),
    }))
  );

  // Determine the reference image payload
  let refLabel = params.referenceImage?.label?.trim() || 'Uploaded Reference Photo';
  let refSourceUrl: string | undefined;
  let refMime = '';
  let refBase64 = '';
  let refSha256 = '';

  if (params.referenceImage?.base64) {
    const rawBuf = Buffer.from(params.referenceImage.base64, 'base64');
    if (rawBuf.length > MAX_IMAGE_BYTES || rawBuf.length < 250) {
      throw new Error('Uploaded reference image must be between 250 bytes and 4 MB.');
    }
    const detected = detectImageMimeFromBytes(
      rawBuf,
      params.referenceImage.mimeType || ''
    );
    if (!detected) {
      throw new Error('Reference image must be a valid JPEG, PNG, WebP, or GIF.');
    }
    refMime = detected;
    refBase64 = rawBuf.toString('base64');
    refSha256 = crypto.createHash('sha256').update(rawBuf).digest('hex');
  } else if (params.referencePhotoId) {
    const chosen = fetchedEntries.find(
      (e) => e.candidate.id === params.referencePhotoId && e.asset.ok
    );
    if (!chosen) {
      throw new Error('Selected baseline profile avatar could not be fetched.');
    }
    refLabel = `${chosen.candidate.platform}${
      chosen.candidate.handle ? ` (@${chosen.candidate.handle})` : ''
    }`;
    refSourceUrl = chosen.candidate.url;
    refMime = chosen.asset.mimeType;
    refBase64 = chosen.asset.base64;
    refSha256 = chosen.asset.sha256;
  } else {
    const firstValid = fetchedEntries.find((e) => e.asset.ok);
    if (!firstValid) {
      throw new Error(
        'Upload a reference photo or ensure at least one public platform avatar is reachable.'
      );
    }
    refLabel = `${firstValid.candidate.platform}${
      firstValid.candidate.handle ? ` (@${firstValid.candidate.handle})` : ''
    }`;
    refSourceUrl = firstValid.candidate.url;
    refMime = firstValid.asset.mimeType;
    refBase64 = firstValid.asset.base64;
    refSha256 = firstValid.asset.sha256;
  }

  // Prepare Gemini vision candidate inputs (skip exact duplicate image URL of reference unless needed)
  const visionCandidates: GeminiFacialImageInput[] = fetchedEntries
    .filter((e) => e.asset.ok)
    .map((e) => ({
      id: e.candidate.id,
      label: `${e.candidate.platform}${
        e.candidate.handle ? ` (@${e.candidate.handle})` : ''
      }`,
      mimeType: e.asset.mimeType,
      base64: e.asset.base64,
    }));

  const aiResult = await analyzeFacesWithGemini({
    target: cleanTarget,
    reference: {
      id: 'reference',
      label: refLabel,
      mimeType: refMime,
      base64: refBase64,
    },
    candidates: visionCandidates,
  });

  const aiMatchMap = new Map(
    (aiResult.matches || []).map((m) => [m.id, m])
  );

  const matches: FacialCandidateMatch[] = fetchedEntries.map(({ candidate, asset }) => {
    const reverseSearch = buildReverseSearchLinks(candidate.url);
    if (!asset.ok) {
      return {
        id: candidate.id,
        platform: candidate.platform,
        handle: candidate.handle,
        url: candidate.url,
        fetchOk: false,
        faceDetected: false,
        verdict: 'Inconclusive',
        similarityScore: 0,
        comparisonSummary: `Avatar unreachable (${asset.error || 'fetch error'}). Use reverse face search links below.`,
        matchingFeatures: [],
        differingFeatures: [],
        reverseSearch,
      };
    }

    const exactByteMatch = Boolean(refSha256 && asset.sha256 === refSha256);
    const aiMatch = aiMatchMap.get(candidate.id);

    if (exactByteMatch && !aiMatch) {
      return {
        id: candidate.id,
        platform: candidate.platform,
        handle: candidate.handle,
        url: candidate.url,
        fetchOk: true,
        sha256: asset.sha256,
        exactByteMatch: true,
        faceDetected: true,
        verdict: 'High Confidence Match',
        similarityScore: 100,
        comparisonSummary: 'Cryptographic SHA-256 byte-for-byte identical profile image.',
        matchingFeatures: ['Identical SHA-256 image digest'],
        differingFeatures: [],
        reverseSearch,
      };
    }

    if (aiMatch) {
      return {
        id: candidate.id,
        platform: candidate.platform,
        handle: candidate.handle,
        url: candidate.url,
        fetchOk: true,
        sha256: asset.sha256,
        exactByteMatch,
        faceDetected: aiMatch.faceDetected,
        verdict: aiMatch.verdict,
        similarityScore: exactByteMatch
          ? 100
          : Math.max(0, Math.min(100, Math.round(aiMatch.similarityScore || 0))),
        comparisonSummary: exactByteMatch
          ? `Cryptographically identical image (SHA-256 match). ${aiMatch.comparisonSummary}`
          : aiMatch.comparisonSummary,
        matchingFeatures: aiMatch.matchingFeatures || [],
        differingFeatures: aiMatch.differingFeatures || [],
        reverseSearch,
      };
    }

    return {
      id: candidate.id,
      platform: candidate.platform,
      handle: candidate.handle,
      url: candidate.url,
      fetchOk: true,
      sha256: asset.sha256,
      exactByteMatch,
      faceDetected: false,
      verdict: 'Inconclusive',
      similarityScore: exactByteMatch ? 100 : 0,
      comparisonSummary:
        aiResult.error ||
        'AI facial geometry comparison unavailable. SHA-256 digest and reverse image search links ready.',
      matchingFeatures: exactByteMatch ? ['Identical SHA-256 digest'] : [],
      differingFeatures: [],
      reverseSearch,
    };
  });

  // Sort highest similarity matches first
  matches.sort((a, b) => b.similarityScore - a.similarityScore);

  const exactHashCount = matches.filter((m) => m.exactByteMatch).length;
  const highCount = matches.filter(
    (m) => m.verdict === 'High Confidence Match' || m.verdict === 'Probable Match'
  ).length;

  return {
    target: cleanTarget,
    analyzedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    aiAvailable: aiResult.aiAvailable,
    model: aiResult.model,
    keySlotUsed: aiResult.keySlotUsed,
    keyPoolSize: aiResult.keyPoolSize,
    warning: aiResult.error,
    overallSummary:
      aiResult.overallSummary ||
      (matches.length === 0
        ? 'Reference photo analyzed. Upload or select platform avatars to compare faces.'
        : `Evaluated ${matches.length} platform avatar(s): ${highCount} probable/high facial match(es), ${exactHashCount} SHA-256 identical image(s).`),
    reference: {
      label: refLabel,
      sourceUrl: refSourceUrl,
      sha256: refSha256,
      faceDetected: aiResult.referenceAnalysis?.faceDetected ?? true,
      quality: aiResult.referenceAnalysis?.quality ?? 'Medium',
      description:
        aiResult.referenceAnalysis?.description ||
        'Reference facial image hashed and queued for visual comparison.',
      facialAttributes: aiResult.referenceAnalysis?.facialAttributes || [],
    },
    matches,
  };
}
