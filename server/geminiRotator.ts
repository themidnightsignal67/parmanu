import dotenv from 'dotenv';
dotenv.config({ override: true, quiet: true });
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import type {
  GeminiIntelligenceSummary,
  InvestigationRecord,
} from '../src/types/investigation.ts';

interface KeySlot {
  slot: number;
  key: string;
  cooldownUntil: number;
  groundingCooldownUntil: number;
  failures: number;
  uses: number;
}

const MAX_ROTATABLE_KEYS = 10;

function loadRotatableKeys(): KeySlot[] {
  const numberedKeys: Array<string | undefined> = [
    process.env.GEMINI_API_KEY,
    process.env.GEMINI_API_KEY_1,
    process.env.GEMINI_API_KEY_2,
    process.env.GEMINI_API_KEY_3,
    process.env.GEMINI_API_KEY_4,
    process.env.GEMINI_API_KEY_5,
    process.env.GEMINI_API_KEY_6,
    process.env.GEMINI_API_KEY_7,
    process.env.GEMINI_API_KEY_8,
    process.env.GEMINI_API_KEY_9,
    process.env.GEMINI_API_KEY_10,
  ];

  const listKeys = process.env.GEMINI_API_KEYS
    ? process.env.GEMINI_API_KEYS.split(/[\s,;]+/).map((k) => k.trim())
    : [];

  const candidates = [...numberedKeys, ...listKeys]
    .map((k) => (k || '').trim())
    .filter((k) => k.length > 0 && !k.startsWith('MY_GEMINI_API_KEY'));

  const unique: string[] = [];
  for (const key of candidates) {
    if (!unique.includes(key) && unique.length < MAX_ROTATABLE_KEYS) {
      unique.push(key);
    }
  }

  return unique.map((key, idx) => ({
    slot: idx + 1,
    key,
    cooldownUntil: 0,
    groundingCooldownUntil: 0,
    failures: 0,
    uses: 0,
  }));
}

let keyPool: KeySlot[] = loadRotatableKeys();
let roundRobinCursor = 0;

function refreshKeyPoolIfNeeded() {
  const fresh = loadRotatableKeys();
  const prevSig = keyPool.map((k) => k.key).join('|');
  const nextSig = fresh.map((k) => k.key).join('|');
  if (prevSig !== nextSig) {
    const existingByKey = new Map(keyPool.map((k) => [k.key, k]));
    keyPool = fresh.map((slot) => {
      const prev = existingByKey.get(slot.key);
      return prev
        ? {
            ...slot,
            cooldownUntil: prev.cooldownUntil,
            groundingCooldownUntil: prev.groundingCooldownUntil,
            failures: prev.failures,
            uses: prev.uses,
          }
        : slot;
    });
  }
}

export function getGeminiRotatorStatus() {
  refreshKeyPoolIfNeeded();
  const now = Date.now();
  return {
    configuredSlots: keyPool.length,
    activeSlot:
      keyPool.length > 0 ? (roundRobinCursor % keyPool.length) + 1 : 0,
    slots: keyPool.map((s) => ({
      slot: s.slot,
      healthy: s.cooldownUntil <= now,
      uses: s.uses,
      failures: s.failures,
    })),
  };
}

function isQuotaOrAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err || '');
  return /429|RESOURCE_EXHAUSTED|quota|rate limit|403|PERMISSION_DENIED|API_KEY_INVALID|API key not valid|401/i.test(
    msg
  );
}

async function runWithRotatableKeys<T>(
  runner: (ai: GoogleGenAI, slot: KeySlot) => Promise<T>,
  options?: { isGrounding?: boolean }
): Promise<{ result?: T; slotUsed: number; poolSize: number; error?: string }> {
  refreshKeyPoolIfNeeded();
  if (keyPool.length === 0) {
    return {
      slotUsed: 0,
      poolSize: 0,
      error: 'No AI API key configured on server.',
    };
  }

  const isGrounding = options?.isGrounding === true;
  const now = Date.now();
  const totalSlots = keyPool.length;

  // Avoid burning repeated search grounding retries when every slot is in grounding cooldown
  if (isGrounding && keyPool.every((s) => s.groundingCooldownUntil > now)) {
    return {
      slotUsed: 0,
      poolSize: totalSlots,
      error: 'Google Search grounding quota currently in cooldown across configured keys.',
    };
  }

  let lastErrorMsg = '';

  for (let attempt = 0; attempt < totalSlots; attempt++) {
    const idx = (roundRobinCursor + attempt) % totalSlots;
    const slot = keyPool[idx];

    const slotCooldown = isGrounding ? slot.groundingCooldownUntil : slot.cooldownUntil;
    if (slotCooldown > now && (isGrounding || attempt < totalSlots - 1)) {
      continue;
    }

    try {
      const ai = new GoogleGenAI({
        apiKey: slot.key,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          },
        },
      });

      const result = await runner(ai, slot);
      slot.uses += 1;
      if (isGrounding) {
        slot.groundingCooldownUntil = 0;
      } else {
        slot.cooldownUntil = 0;
      }
      roundRobinCursor = (idx + 1) % totalSlots;
      return { result, slotUsed: slot.slot, poolSize: totalSlots };
    } catch (err) {
      lastErrorMsg = err instanceof Error ? err.message : String(err);

      if (isGrounding) {
        if (isQuotaOrAuthError(err)) {
          slot.groundingCooldownUntil = Date.now() + 300_000;
        }
      } else {
        slot.failures += 1;
        if (isQuotaOrAuthError(err)) {
          slot.cooldownUntil = Date.now() + 60_000;
        }
      }
      roundRobinCursor = (idx + 1) % totalSlots;
    }
  }

  return {
    slotUsed: 0,
    poolSize: totalSlots,
    error: lastErrorMsg || 'All configured AI key slots failed.',
  };
}

function buildCompactContext(record: InvestigationRecord) {
  return {
    target: record.target,
    targetType: record.targetType,
    summary: record.summary,
    breachedAccounts: record.breachedAccounts.slice(0, 15).map((b) => ({
      platform: b.platform,
      breachName: b.breachName,
      relativeTime: b.relativeTime,
      dataClasses: b.dataClasses,
    })),
    geoMarkers: record.geoMarkers.map((g) => ({
      region: g.region,
      country: g.country,
      source: g.source,
    })),
    findings: record.results
      .filter((r) => r.status === 'found')
      .slice(0, 24)
      .map((r) => ({
        platform: r.platform,
        findingKind: r.findingKind,
        tool: r.tool,
        handle: r.handle,
        accountType: r.accountType,
        firstSeen: r.firstSeen,
        lastSeen: r.lastSeen,
        summary: r.summary,
        artifactsCount: r.artifacts?.length || 0,
      })),
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

async function generateContentResilient(
  ai: GoogleGenAI,
  params: {
    contents: string;
    systemInstruction: string;
    jsonSchema?: boolean;
  }
) {
  const tryCall = async (
    model: string,
    thinkingLevel: ThinkingLevel,
    timeoutMs: number
  ) => {
    const config: Record<string, unknown> = {
      thinkingConfig: { thinkingLevel },
      systemInstruction: params.systemInstruction,
    };
    if (params.jsonSchema) {
      config.responseMimeType = 'application/json';
      config.responseSchema = {
        type: Type.OBJECT,
        properties: {
          executiveBrief: {
            type: Type.STRING,
            description: '2-3 crisp sentences summarizing verified footprint and exposure.',
          },
          riskPosture: {
            type: Type.STRING,
            description: 'Must be one of: Low, Moderate, Elevated.',
          },
          keyTakeaways: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '3 to 4 factual bullet points grounded in the findings.',
          },
          recommendedNextSteps: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '2 to 3 concise defensive or verification recommendations.',
          },
        },
      };
    }
    const response = await withTimeout(
      ai.models.generateContent({
        model,
        contents: params.contents,
        config,
      }),
      timeoutMs,
      model
    );
    return { response, modelUsed: model };
  };

  try {
    return await tryCall('gemini-4-hydrogen', ThinkingLevel.LOW, 6500);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err || '');
    if (/timed out|503|UNAVAILABLE|high demand|overloaded|500|404|NOT_FOUND/i.test(msg)) {
      await new Promise((r) => setTimeout(r, 350));
      // Fast failover to gemini-3.1-flash-lite with ThinkingLevel.MINIMAL
      try {
        return await tryCall('gemini-3.1-flash-lite', ThinkingLevel.MINIMAL, 10000);
      } catch {
        await new Promise((r) => setTimeout(r, 600));
        // Final retry on gemini-4-hydrogen if lite also experienced transient error
        return await tryCall('gemini-4-hydrogen', ThinkingLevel.LOW, 12000);
      }
    }
    throw err;
  }
}

export async function generateInvestigationBrief(
  record: InvestigationRecord
): Promise<GeminiIntelligenceSummary> {
  const contextJson = JSON.stringify(buildCompactContext(record));

  const attempt = await runWithRotatableKeys(async (ai) => {
    const { response, modelUsed } = await generateContentResilient(ai, {
      contents: [
        `Analyze this authorized OSINT investigation record for target "${record.target}" (${record.targetType}).`,
        `Structured JSON Data: ${contextJson}`,
        `Summarize confirmed accounts, any breached or leaked exposures, geographic footprint, and practical next steps. Only cite verified facts in the JSON.`,
      ].join('\n'),
      systemInstruction:
        'You are the Parmanu AI Analyst. Produce clear, calm, strictly factual cybersecurity intelligence briefs grounded solely in the provided structured JSON.',
      jsonSchema: true,
    });

    const cleanedText = (response.text || '{}')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    const parsed = JSON.parse(cleanedText) as {
      executiveBrief?: string;
      riskPosture?: string;
      keyTakeaways?: string[];
      recommendedNextSteps?: string[];
    };

    return { parsed, modelUsed };
  });

  if (!attempt.result) {
    const defaultPosture: 'Low' | 'Moderate' | 'Elevated' =
      record.summary.breached > 0 || record.summary.leaked > 0
        ? 'Elevated'
        : record.summary.registered > 4
        ? 'Moderate'
        : 'Low';

    const hasCleanBrief =
      attempt.poolSize === 0
        ? `Collected ${record.summary.found} verified signals across ${record.summary.total} checks for ${record.target}. Configure a server-side AI API key (up to 10 rotatable slots) for live AI analyst synthesis.`
        : `Analyzed ${record.summary.total + record.summary.notFound + record.summary.notChecked} checks for ${record.target}: ${record.summary.registered} registered account(s), ${record.summary.breached} breach exposure(s), ${record.summary.notFound} verified clean site(s), and ${record.summary.notChecked} auth/OTP-gated portal(s).`;

    const cleanErrMsg =
      attempt.poolSize > 0 && attempt.error
        ? /503|UNAVAILABLE|high demand|overloaded/i.test(attempt.error)
          ? 'AI synthesis temporarily busy; deterministic intelligence summary shown.'
          : 'AI synthesis fell back to deterministic summary.'
        : undefined;

    return {
      executiveBrief: hasCleanBrief,
      riskPosture: defaultPosture,
      keyTakeaways: [
        `${record.summary.registered} registered account(s) and ${record.summary.profilePhotosCount} profile image(s) surfaced.`,
        `${record.summary.breached} breached record(s), ${record.summary.leaked} exposure hit(s), and ${record.summary.notFound} verified clean site(s).`,
        `${record.geoMarkers.length} geographic region signal(s) mapped.`,
      ],
      recommendedNextSteps: [
        'Inspect Registered Accounts, Leaked Results, and Site Audit tabs for full per-website breakdowns.',
        'Click any website card to inspect verification evidence and login/recovery URLs.',
      ],
      keySlotUsed: 0,
      keyPoolSize: attempt.poolSize,
      model: 'gemini-4-hydrogen',
      generatedAt: new Date().toISOString(),
      ...(cleanErrMsg ? { error: cleanErrMsg } : {}),
    };
  }

  const { parsed, modelUsed } = attempt.result;
  const normalizedPosture: 'Low' | 'Moderate' | 'Elevated' =
    parsed.riskPosture === 'Elevated'
      ? 'Elevated'
      : parsed.riskPosture === 'Moderate'
      ? 'Moderate'
      : 'Low';

  return {
    executiveBrief:
      parsed.executiveBrief ||
      `Completed ${record.summary.total} checks for ${record.target} with ${record.summary.found} verified signals.`,
    riskPosture: normalizedPosture,
    keyTakeaways: Array.isArray(parsed.keyTakeaways)
      ? parsed.keyTakeaways.slice(0, 4)
      : [],
    recommendedNextSteps: Array.isArray(parsed.recommendedNextSteps)
      ? parsed.recommendedNextSteps.slice(0, 3)
      : [],
    keySlotUsed: attempt.slotUsed,
    keyPoolSize: attempt.poolSize,
    model: modelUsed,
    generatedAt: new Date().toISOString(),
  };
}

export async function askGeminiAnalyst(
  record: InvestigationRecord,
  question: string
): Promise<{
  answer: string;
  keySlotUsed: number;
  keyPoolSize: number;
}> {
  const contextJson = JSON.stringify(buildCompactContext(record));

  const attempt = await runWithRotatableKeys(async (ai) => {
    const { response } = await generateContentResilient(ai, {
      contents: [
        `Investigation Data for "${record.target}" (${record.targetType}):`,
        contextJson,
        `\nAnalyst Question: ${question}`,
      ].join('\n'),
      systemInstruction:
        'You are Parmanu AI Analyst. Answer concisely in 2-5 sentences using ONLY facts present in the investigation JSON. Never fabricate findings.',
    });
    return (response.text || '').trim();
  });

  if (!attempt.result) {
    const fallback = [
      `Based on collected telemetry for ${record.target} (${record.targetType}):`,
      `${record.summary.found} total matches (${record.summary.registered} registered, ${record.summary.breached} breached, ${record.summary.leaked} leaked).`,
      record.breachedAccounts.length > 0
        ? `Breaches identified: ${record.breachedAccounts.map((b) => b.platform).join(', ')}.`
        : 'No public breaches flagged in this scan.',
    ].join(' ');
    return {
      answer: fallback,
      keySlotUsed: 0,
      keyPoolSize: attempt.poolSize,
    };
  }

  return {
    answer: attempt.result,
    keySlotUsed: attempt.slotUsed,
    keyPoolSize: attempt.poolSize,
  };
}

export interface GroundedWebMatch {
  title: string;
  url: string;
  snippet: string;
  matchedQuery: string;
}

export async function runGeminiGoogleSearchDork(params: {
  target: string;
  targetType: string;
  queries: string[];
  mode?: 'full' | 'phone-fast';
}): Promise<{ hits: GroundedWebMatch[]; active: boolean }> {
  const webQueries = params.queries.slice(0, 5).join('\n');
  const fileQueries = params.queries.slice(1, 7).join('\n') || webQueries;

  const extractHitsFromResponse = (
    response: {
      candidates?: Array<{
        groundingMetadata?: unknown;
      }>;
    },
    fallbackQuery: string
  ): GroundedWebMatch[] => {
    const candidate = response.candidates?.[0];
    const groundingMeta = candidate?.groundingMetadata as
      | {
          webSearchQueries?: string[];
          groundingChunks?: Array<{
            web?: { uri?: string; title?: string };
          }>;
          groundingSupports?: Array<{
            segment?: { text?: string };
            groundingChunkIndices?: number[];
          }>;
        }
      | undefined;

    const chunks = groundingMeta?.groundingChunks || [];
    const supports = groundingMeta?.groundingSupports || [];
    const executedQueries = groundingMeta?.webSearchQueries || [];
    const defaultQuery = executedQueries[0] || fallbackQuery;

    const chunkSnippets = new Map<number, string>();
    for (const sup of supports) {
      const segText = sup.segment?.text?.trim();
      if (!segText) continue;
      for (const idx of sup.groundingChunkIndices || []) {
        if (!chunkSnippets.has(idx)) {
          chunkSnippets.set(idx, segText);
        }
      }
    }

    const hits: GroundedWebMatch[] = [];
    chunks.forEach((chunk, idx) => {
      const uri = chunk.web?.uri?.trim();
      if (!uri || !/^https?:\/\//i.test(uri)) return;
      const title =
        chunk.web?.title?.trim() ||
        (() => {
          try {
            return new URL(uri).hostname.replace(/^www\./, '');
          } catch {
            return 'Indexed Web Result';
          }
        })();
      const snippet = chunkSnippets.get(idx) || '';
      hits.push({
        title,
        url: uri,
        snippet,
        matchedQuery:
          executedQueries[idx % Math.max(1, executedQueries.length)] ||
          defaultQuery,
      });
    });

    return hits;
  };

  const runSinglePass = async (promptText: string, fallbackQuery: string) => {
    return runWithRotatableKeys(
      async (ai) => {
        const callSearchModel = async (model: string, timeoutMs: number) => {
          return withTimeout(
            ai.models.generateContent({
              model,
              contents: promptText,
              config: {
                tools: [{ googleSearch: {} }],
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              },
            }),
            timeoutMs,
            `${model}-search`
          );
        };

        let response;
        try {
          response = await callSearchModel('gemini-4-hydrogen', 8500);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err || '');
          if (/timed out|503|UNAVAILABLE|high demand|overloaded|500|404|NOT_FOUND/i.test(msg)) {
            response = await callSearchModel('gemini-3.1-flash-lite', 9500);
          } else {
            throw err;
          }
        }

        return extractHitsFromResponse(response, fallbackQuery);
      },
      { isGrounding: true }
    );
  };

  const pass1Prompt = [
    `Use Google Search strictly for exact OSINT verification of target "${params.target}" (type: ${params.targetType}).`,
    `Execute ONLY exact quoted searches such as:`,
    webQueries,
    `CRITICAL VERIFICATION RULES:`,
    `1. ONLY cite web pages whose actual indexed content or URL EXPLICITLY contains the exact target "${params.target}" (or exact phone digit sequence).`,
    `2. NEVER include generic directory homepages, SEO lookup spam, "how to look up" articles, or loosely related pages that do not contain the exact target.`,
    `3. For each verified page found, quote the exact short excerpt where "${params.target}" appears. If zero exact matches exist, state that zero exact matches were found.`,
  ].join('\n');

  if (params.mode === 'phone-fast') {
    const attempt = await runSinglePass(pass1Prompt, params.queries[0] || params.target);
    if (!attempt.result) {
      return { hits: [], active: attempt.poolSize > 0 };
    }
    return { hits: attempt.result, active: true };
  }

  const pass2Prompt = [
    `Use Google Search to find ONLY exact public documents (PDF, XLSX, CSV, DOCX, TXT, SQL, JSON), GitHub/Gist/Pastebin pastes, and open archive records that literally contain "${params.target}" (${params.targetType}).`,
    `Queries:`,
    fileQueries,
    `CRITICAL: Never include broad conceptual pages or unrelated documents. Only cite URLs where "${params.target}" literally appears. If none exist, say none found.`,
  ].join('\n');

  const [p1, p2] = await Promise.all([
    runSinglePass(pass1Prompt, params.queries[0] || params.target),
    runSinglePass(pass2Prompt, params.queries[1] || params.target),
  ]);

  const active = (p1.poolSize || p2.poolSize) > 0;
  const seen = new Set<string>();
  const combined: GroundedWebMatch[] = [];
  for (const hit of [...(p1.result || []), ...(p2.result || [])]) {
    const norm = hit.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (!seen.has(norm)) {
      seen.add(norm);
      combined.push(hit);
    }
  }

  return { hits: combined, active };
}

export interface GeminiFacialImageInput {
  id: string;
  label: string;
  mimeType: string;
  base64: string;
}

export interface GeminiFacialAnalysisOutput {
  aiAvailable: boolean;
  model?: string;
  keySlotUsed?: number;
  keyPoolSize?: number;
  error?: string;
  overallSummary?: string;
  referenceAnalysis?: {
    faceDetected: boolean;
    quality: 'High' | 'Medium' | 'Low' | 'No Face';
    description: string;
    facialAttributes: string[];
  };
  matches?: Array<{
    id: string;
    faceDetected: boolean;
    verdict:
      | 'High Confidence Match'
      | 'Probable Match'
      | 'Inconclusive'
      | 'Different Person'
      | 'Not a Face';
    similarityScore: number;
    comparisonSummary: string;
    matchingFeatures: string[];
    differingFeatures: string[];
  }>;
}

export async function analyzeFacesWithGemini(params: {
  target: string;
  reference: GeminiFacialImageInput;
  candidates: GeminiFacialImageInput[];
}): Promise<GeminiFacialAnalysisOutput> {
  if (params.candidates.length === 0 && !params.reference.base64) {
    return {
      aiAvailable: false,
      error: 'No valid image payloads were provided for facial recognition.',
    };
  }

  const attempt = await runWithRotatableKeys(async (ai) => {
    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [
      {
        text: [
          `You are a forensic OSINT visual facial-comparison analyst inspecting authorized profile imagery for target "${params.target}".`,
          `Compare the REFERENCE IMAGE (${params.reference.label}) against each CANDIDATE IMAGE listed below.`,
          `RULES:`,
          `1. First inspect the REFERENCE IMAGE: determine whether a human face is clearly visible, its visual quality (High, Medium, Low, No Face), objective visual traits (hair style/color, facial hair, eyewear, approximate age bracket, head pose, lighting, distinguishing marks), and concise factual description.`,
          `2. Then evaluate EVERY CANDIDATE IMAGE by its exact id against the REFERENCE IMAGE.`,
          `3. If a candidate image is an illustration, company logo, cartoon, blank avatar, or lacks a clear human face, set faceDetected=false, verdict="Not a Face", and similarityScore=0.`,
          `4. If two real human faces are shown, score visual facial geometry similarity from 0 to 100 (bone structure, brow, nose bridge, eye spacing, jawline, ears, hairline, facial marks) and assign verdict: "High Confidence Match" (>=80), "Probable Match" (60-79), "Inconclusive" (40-59), or "Different Person" (<40).`,
          `5. Be strictly conservative and factual. Never invent real-world identities or names not present in labels.`,
          `\nREFERENCE IMAGE (${params.reference.label}):`,
        ].join('\n'),
      },
      {
        inlineData: {
          mimeType: params.reference.mimeType,
          data: params.reference.base64,
        },
      },
    ];

    for (let i = 0; i < params.candidates.length; i++) {
      const cand = params.candidates[i];
      parts.push({
        text: `\nCANDIDATE #${i + 1} — id="${cand.id}" (${cand.label}):`,
      });
      parts.push({
        inlineData: {
          mimeType: cand.mimeType,
          data: cand.base64,
        },
      });
    }

    const schema = {
      type: Type.OBJECT,
      properties: {
        overallSummary: {
          type: Type.STRING,
          description:
            '2-3 factual sentences summarizing cross-platform facial consistency and match confidence.',
        },
        referenceAnalysis: {
          type: Type.OBJECT,
          properties: {
            faceDetected: { type: Type.BOOLEAN },
            quality: {
              type: Type.STRING,
              description: 'One of: High, Medium, Low, No Face',
            },
            description: { type: Type.STRING },
            facialAttributes: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
              description: '4 to 8 objective visual facial traits.',
            },
          },
          required: ['faceDetected', 'quality', 'description', 'facialAttributes'],
        },
        matches: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              faceDetected: { type: Type.BOOLEAN },
              verdict: {
                type: Type.STRING,
                description:
                  'One of: High Confidence Match, Probable Match, Inconclusive, Different Person, Not a Face',
              },
              similarityScore: {
                type: Type.NUMBER,
                description: 'Integer 0-100 visual facial similarity score.',
              },
              comparisonSummary: { type: Type.STRING },
              matchingFeatures: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              differingFeatures: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'id',
              'faceDetected',
              'verdict',
              'similarityScore',
              'comparisonSummary',
              'matchingFeatures',
              'differingFeatures',
            ],
          },
        },
      },
      required: ['overallSummary', 'referenceAnalysis', 'matches'],
    };

    const callVision = async (
      model: string,
      thinkingLevel: ThinkingLevel,
      timeoutMs: number
    ) => {
      const response = await withTimeout(
        ai.models.generateContent({
          model,
          contents: { parts },
          config: {
            thinkingConfig: { thinkingLevel },
            responseMimeType: 'application/json',
            responseSchema: schema,
          },
        }),
        timeoutMs,
        `${model}-vision`
      );
      return { response, modelUsed: model };
    };

    let res;
    try {
      res = await callVision('gemini-4-hydrogen', ThinkingLevel.LOW, 14000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err || '');
      if (/timed out|503|UNAVAILABLE|high demand|overloaded|500|404|NOT_FOUND/i.test(msg)) {
        res = await callVision('gemini-3.1-flash-lite', ThinkingLevel.MINIMAL, 14000);
      } else {
        throw err;
      }
    }

    const cleaned = (res.response.text || '{}')
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '');

    const parsed = JSON.parse(cleaned) as {
      overallSummary?: string;
      referenceAnalysis?: GeminiFacialAnalysisOutput['referenceAnalysis'];
      matches?: GeminiFacialAnalysisOutput['matches'];
    };

    return { parsed, modelUsed: res.modelUsed };
  });

  if (!attempt.result) {
    return {
      aiAvailable: false,
      keySlotUsed: 0,
      keyPoolSize: attempt.poolSize,
      error:
        attempt.poolSize === 0
          ? 'Configure a server-side Gemini API key to enable AI facial geometry comparison.'
          : attempt.error || 'Visual facial analysis request failed.',
    };
  }

  return {
    aiAvailable: true,
    model: attempt.result.modelUsed,
    keySlotUsed: attempt.slotUsed,
    keyPoolSize: attempt.poolSize,
    overallSummary: attempt.result.parsed.overallSummary,
    referenceAnalysis: attempt.result.parsed.referenceAnalysis,
    matches: attempt.result.parsed.matches || [],
  };
}


