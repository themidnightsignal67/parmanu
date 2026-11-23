import type { ResultCategory } from '../src/types/investigation.ts';
import {
  EXTRA_BLACKBIRD_TARGETS,
  EXTRA_HOLEHE_TARGETS,
  EXTRA_MAIGRET_TARGETS,
  EXTRA_SHERLOCK_TARGETS,
  buildExtraEmailProbes,
} from './platformExpansion.ts';
import { buildMegaEmailProbes } from './emailCatalogMega.ts';

export interface JsonExtractOutput {
  status: 'found' | 'not_found' | 'not_checked';
  displayName?: string;
  verifiedUsername?: string;
  avatarUrl?: string;
  bio?: string;
  location?: string;
  createdAt?: string;
  id?: string;
  followers?: number;
  url?: string;
  extraFields?: Array<{ label: string; value: string; copyable?: boolean }>;
}

export interface HtmlVerifyConfig {
  /** Case-insensitive substrings indicating profile does not exist even on HTTP 200 */
  notFoundMarkers?: string[];
  /** Positive markers or custom predicate required to confirm HTTP 200 isn't a blank SPA shell */
  foundMarkers?:
    | string[]
    | ((htmlLower: string, rawHtml: string, handleLower: string, finalUrlLower: string) => boolean);
  /** Reject if redirect finalUrl matches any of these substrings (e.g. '/login', '/404') */
  rejectRedirectSubstrings?: string[];
  /** Subdomain-per-user hosts (e.g. *.onrender.com, *.vercel.app, *.netlify.app) */
  isSubdomainHost?: boolean;
  /** Additional HTTP codes treated as not_found */
  extraNotFoundStatuses?: number[];
  /** Custom Accept header override */
  acceptHeader?: string;
}

export interface PlatformSweepTarget {
  platform: string;
  category: ResultCategory;
  urlFn: (h: string) => string;
  apiUrlFn?: (h: string) => string;
  apiMethod?: 'GET' | 'POST';
  apiBodyFn?: (h: string) => string;
  apiHeaders?: Record<string, string>;
  /** Custom JSON response extractor & false-positive filter */
  extractJson?: (data: unknown, handle: string) => JsonExtractOutput;
  /** Additional HTTP status codes on JSON endpoints treated as not_found */
  extraJsonNotFoundStatuses?: number[];
  /** Custom multi-step async email/platform probe */
  customProbeFn?: (targetInput: string) => Promise<JsonExtractOutput & { httpStatus?: number }>;
  /** HTML verification rules for sites scanned via web page */
  htmlCheck?: HtmlVerifyConfig;
  /** True when probe deterministically verifies existence rather than passive endpoint availability */
  isLiveVerification?: boolean;
}

const GENERIC_404_MARKERS = [
  'page not found',
  'this page could not be found',
  'user not found',
  'profile not found',
  'account not found',
  'does not exist',
  "doesn't exist",
  "couldn't find that page",
  "can't find that page",
  '404 not found',
  'error 404',
];

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function asStr(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function asNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

// ---------------------------------------------------------------------------
// 1. MAIGRET CATALOG (50 Platforms): Cloud PaaS, Hosting, AI, Coding & Forges
// ---------------------------------------------------------------------------
export const MAIGRET_TARGETS: PlatformSweepTarget[] = [
  {
    platform: 'Replit',
    category: 'Developer & Code',
    urlFn: (h) => `https://replit.com/@${encodeURIComponent(h)}`,
    customProbeFn: async (h) => {
      const targetUrl = `https://replit.com/@${encodeURIComponent(h)}`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 6000);
      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          redirect: 'manual',
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
          },
        });
        const location = (res.headers.get('location') || '').toLowerCase();
        if (res.status >= 300 && res.status < 400) {
          if (
            location.includes('root-profile') ||
            location.includes(`%40${h.toLowerCase()}`) ||
            location.includes(`@${h.toLowerCase()}`)
          ) {
            return {
              status: 'found',
              httpStatus: res.status,
              displayName: `@${h}`,
              url: targetUrl,
              bio: `Registered Replit profile confirmed via root-profile redirect (HTTP ${res.status}).`,
              extraFields: [
                { label: 'Profile Handle', value: `@${h}`, copyable: true },
                { label: 'Verification Method', value: 'Replit Root-Profile Redirect' },
              ],
            };
          }
          if (location.includes('/404')) {
            return { status: 'not_found', httpStatus: res.status };
          }
          return { status: 'not_checked', httpStatus: res.status };
        }
        if (res.status === 404) {
          return { status: 'not_found', httpStatus: 404 };
        }
        if (res.status >= 200 && res.status < 300) {
          const html = await res.text().catch(() => '');
          const visible = html
            .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
            .toLowerCase();
          if (
            visible.includes('page not found') ||
            visible.includes('this user does not exist') ||
            visible.includes('user not found')
          ) {
            return { status: 'not_found', httpStatus: res.status };
          }
          if (
            html.toLowerCase().includes(`@${h.toLowerCase()}`) ||
            html.toLowerCase().includes(`replit.com/@${h.toLowerCase()}`)
          ) {
            return {
              status: 'found',
              httpStatus: res.status,
              displayName: `@${h}`,
              url: targetUrl,
              bio: `Public Replit profile verified at ${targetUrl}.`,
            };
          }
          return { status: 'not_found', httpStatus: res.status };
        }
        return { status: 'not_checked', httpStatus: res.status };
      } catch {
        return { status: 'not_checked', httpStatus: 0 };
      } finally {
        clearTimeout(timer);
      }
    },
  },
  {
    platform: 'Render',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.onrender.com`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: [
        'not found',
        'service suspended',
        'application failed to respond',
        'render-not-found',
      ],
      foundMarkers: (low, raw) =>
        raw.trim().length > 80 &&
        !low.trim().startsWith('not found') &&
        !low.includes('<title>not found</title>') &&
        !low.includes('<title>render · not found</title>'),
    },
  },
  {
    platform: 'Vercel',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.vercel.app`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: [
        'deployment_not_found',
        'the deployment could not be found on vercel',
        '404: not_found',
        'this page could not be found',
      ],
      foundMarkers: (_low, raw) => raw.trim().length > 100,
    },
  },
  {
    platform: 'Netlify',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.netlify.app`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: [
        'page not found',
        "looks like you've followed a broken link",
        'netlify.com/404',
      ],
      foundMarkers: (_low, raw) => raw.trim().length > 100,
    },
  },
  {
    platform: 'Fly.io',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.fly.dev`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['not found', 'app is not available', '404 page not found'],
      foundMarkers: (_low, raw) => raw.trim().length > 80,
    },
  },
  {
    platform: 'Railway',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.up.railway.app`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: [
        'application failed to respond',
        'the train has not arrived',
        '404 not found',
      ],
      foundMarkers: (_low, raw) => raw.trim().length > 90,
    },
  },
  {
    platform: 'Cloudflare Pages',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.pages.dev`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['nothing is here yet', 'error 1003', '404 not found'],
      foundMarkers: (_low, raw) => raw.trim().length > 90,
    },
  },
  {
    platform: 'GitHub Pages',
    category: 'Developer & Code',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.github.io`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ["there isn't a github pages site here", '404 file not found'],
      foundMarkers: (_low, raw) => raw.trim().length > 80,
    },
  },
  {
    platform: 'GitLab Pages',
    category: 'Developer & Code',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.gitlab.io`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['404 - page not found', 'sign in · gitlab'],
      rejectRedirectSubstrings: ['/users/sign_in'],
      foundMarkers: (_low, raw) => raw.trim().length > 80,
    },
  },
  {
    platform: 'Glitch',
    category: 'Developer & Code',
    urlFn: (h) => `https://glitch.com/@${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.glitch.com/v1/users/by/login?login=${encodeURIComponent(h)}`,
    extractJson: (data, h) => {
      const obj = asObj(data);
      const user = obj ? asObj(obj[h]) || asObj(Object.values(obj)[0]) : null;
      if (!user || (!user.login && !user.id)) return { status: 'not_found' };
      return {
        status: 'found',
        id: String(user.id || ''),
        displayName: asStr(user.name) || asStr(user.login),
        avatarUrl: asStr(user.avatarUrl) || asStr(user.avatarThumbnailUrl),
        bio: asStr(user.description),
        createdAt: asStr(user.createdAt),
      };
    },
  },
  {
    platform: 'DEV Community',
    category: 'Developer & Code',
    urlFn: (h) => `https://dev.to/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://dev.to/api/users/by_username?url=${encodeURIComponent(h)}`,
  },
  {
    platform: 'Hacker News',
    category: 'Developer & Code',
    urlFn: (h) => `https://news.ycombinator.com/user?id=${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://hacker-news.firebaseio.com/v0/user/${encodeURIComponent(h)}.json`,
  },
  {
    platform: 'Hugging Face',
    category: 'Developer & Code',
    urlFn: (h) => `https://huggingface.co/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://huggingface.co/api/users/${encodeURIComponent(h)}/overview`,
  },
  {
    platform: 'Hashnode',
    category: 'Developer & Code',
    urlFn: (h) => `https://hashnode.com/@${encodeURIComponent(h)}`,
    apiUrlFn: () => 'https://gql.hashnode.com',
    apiMethod: 'POST',
    apiHeaders: { 'Content-Type': 'application/json' },
    apiBodyFn: (h) =>
      JSON.stringify({
        query: `query($u: String!) { user(username: $u) { id username name profilePicture location bio { text } followersCount dateJoined } }`,
        variables: { u: h },
      }),
    extractJson: (data) => {
      const user = asObj(asObj(asObj(data)?.data)?.user);
      if (!user || !user.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(user.id),
        displayName: asStr(user.name) || asStr(user.username),
        avatarUrl: asStr(user.profilePicture),
        location: asStr(user.location),
        bio: asStr(asObj(user.bio)?.text),
        followers: asNum(user.followersCount),
        createdAt: asStr(user.dateJoined),
      };
    },
  },
  {
    platform: 'LeetCode',
    category: 'Developer & Code',
    urlFn: (h) => `https://leetcode.com/u/${encodeURIComponent(h)}/`,
    apiUrlFn: () => 'https://leetcode.com/graphql',
    apiMethod: 'POST',
    apiHeaders: {
      'Content-Type': 'application/json',
      Referer: 'https://leetcode.com/',
    },
    apiBodyFn: (h) =>
      JSON.stringify({
        query: `query($u: String!) { matchedUser(username: $u) { username profile { realName userAvatar countryName aboutMe ranking } } }`,
        variables: { u: h },
      }),
    extractJson: (data) => {
      const mu = asObj(asObj(asObj(data)?.data)?.matchedUser);
      if (!mu || !mu.username) return { status: 'not_found' };
      const prof = asObj(mu.profile);
      return {
        status: 'found',
        displayName: asStr(prof?.realName) || asStr(mu.username),
        avatarUrl: asStr(prof?.userAvatar),
        location: asStr(prof?.countryName),
        bio: asStr(prof?.aboutMe),
        extraFields:
          typeof prof?.ranking === 'number'
            ? [{ label: 'Contest Rank', value: `#${prof.ranking}` }]
            : undefined,
      };
    },
  },
  {
    platform: 'Codeforces',
    category: 'Developer & Code',
    urlFn: (h) => `https://codeforces.com/profile/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://codeforces.com/api/user.info?handles=${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.status !== 'OK' || !Array.isArray(obj.result) || obj.result.length === 0) {
        return { status: 'not_found' };
      }
      const u = asObj(obj.result[0]);
      if (!u) return { status: 'not_found' };
      const fullName = [asStr(u.firstName), asStr(u.lastName)].filter(Boolean).join(' ');
      return {
        status: 'found',
        displayName: fullName || asStr(u.handle),
        avatarUrl: asStr(u.titlePhoto) || asStr(u.avatar),
        location: [asStr(u.city), asStr(u.country)].filter(Boolean).join(', ') || undefined,
        createdAt:
          typeof u.registrationTimeSeconds === 'number'
            ? new Date(u.registrationTimeSeconds * 1000).toISOString()
            : undefined,
        extraFields:
          typeof u.rating === 'number'
            ? [{ label: 'CF Rating', value: `${u.rating} (${asStr(u.rank) || 'rated'})` }]
            : undefined,
      };
    },
  },
  {
    platform: 'Kaggle',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.kaggle.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ["we couldn't find that page", 'we couldn’t find that page', '404'],
      rejectRedirectSubstrings: ['/account/login'],
      foundMarkers: (low, _raw, h) =>
        low.includes(h) && (low.includes('og:title') || low.includes('kaggle')),
    },
  },
  {
    platform: 'CodePen',
    category: 'Developer & Code',
    urlFn: (h) => `https://codepen.io/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['404 (not found)', 'page not found', "we couldn't find that pen"],
      foundMarkers: (low, _raw, h) =>
        low.includes(`codepen.io/${h}`) || low.includes(`@${h}`),
    },
  },
  {
    platform: 'CodeSandbox',
    category: 'Developer & Code',
    urlFn: (h) => `https://codesandbox.io/u/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['user not found', 'page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h),
    },
  },
  {
    platform: 'StackBlitz',
    category: 'Developer & Code',
    urlFn: (h) => `https://stackblitz.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'user not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h),
    },
  },
  {
    platform: 'Observable',
    category: 'Developer & Code',
    urlFn: (h) => `https://observablehq.com/@${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://api.observablehq.com/user/@${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || (!obj.login && !obj.id)) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.id),
        displayName: asStr(obj.name) || asStr(obj.login),
        avatarUrl: asStr(obj.avatar_url),
        bio: asStr(obj.bio),
      };
    },
  },
  {
    platform: 'Daily.dev',
    category: 'Developer & Code',
    urlFn: (h) => `https://app.daily.dev/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'profile not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('daily.dev'),
    },
  },
  {
    platform: 'Peerlist',
    category: 'Developer & Code',
    urlFn: (h) => `https://peerlist.io/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'profile does not exist'],
      foundMarkers: (low, _raw, h) =>
        low.includes(h) && (low.includes('peerlist') || low.includes('og:title')),
    },
  },
  {
    platform: 'CodeChef',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.codechef.com/users/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['could not find requested page', 'page not found', 'user does not exist'],
      rejectRedirectSubstrings: ['/login', '/users/'],
      foundMarkers: (low, _raw, h) =>
        low.includes(`users/${h}`) && (low.includes('rating') || low.includes('codechef')),
    },
  },
  {
    platform: 'AtCoder',
    category: 'Developer & Code',
    urlFn: (h) => `https://atcoder.jp/users/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['404 not found', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes(`/users/${h}`),
    },
  },
  {
    platform: 'HackerRank',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.hackerrank.com/profile/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://www.hackerrank.com/rest/contenders/${encodeURIComponent(h)}/profile`,
    extractJson: (data) => {
      const model = asObj(asObj(data)?.model);
      if (!model || !model.username) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(model.name) || asStr(model.username),
        avatarUrl: asStr(model.avatar),
        location: asStr(model.country),
        createdAt: asStr(model.created_at),
      };
    },
  },
  {
    platform: 'Exercism',
    category: 'Developer & Code',
    urlFn: (h) => `https://exercism.org/profiles/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'profile not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('exercism'),
    },
  },
  {
    platform: 'GeeksforGeeks',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.geeksforgeeks.org/user/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['404', 'page not found', 'invalid user', 'user not found'],
      foundMarkers: (low, _raw, h) =>
        low.includes(h) &&
        (low.includes('coding score') ||
          low.includes('problem solved') ||
          low.includes('overall coding score') ||
          low.includes('streak')),
    },
  },
  {
    platform: 'DagsHub',
    category: 'Developer & Code',
    urlFn: (h) => `https://dagshub.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://dagshub.com/api/v1/users/${encodeURIComponent(h)}`,
  },
  {
    platform: 'Weights & Biases',
    category: 'Developer & Code',
    urlFn: (h) => `https://wandb.ai/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'user not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('og:title'),
    },
  },
  {
    platform: 'Civitai',
    category: 'Developer & Code',
    urlFn: (h) => `https://civitai.com/user/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://civitai.com/api/v1/creators?query=${encodeURIComponent(h)}&limit=5`,
    extractJson: (data, h) => {
      const items = asObj(data)?.items;
      if (!Array.isArray(items)) return { status: 'not_found' };
      const match = items
        .map(asObj)
        .find((u) => asStr(u?.username)?.toLowerCase() === h.toLowerCase());
      if (!match) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(match.username),
        url: asStr(match.link) || `https://civitai.com/user/${encodeURIComponent(h)}`,
      };
    },
  },
  {
    platform: 'Replicate',
    category: 'Developer & Code',
    urlFn: (h) => `https://replicate.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h),
    },
  },
  {
    platform: 'GitLab',
    category: 'Developer & Code',
    urlFn: (h) => `https://gitlab.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://gitlab.com/api/v4/users?username=${encodeURIComponent(h)}`,
  },
  {
    platform: 'Bitbucket',
    category: 'Developer & Code',
    urlFn: (h) => `https://bitbucket.org/${encodeURIComponent(h)}/`,
    apiUrlFn: (h) => `https://api.bitbucket.org/2.0/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || (!obj.username && !obj.nickname && !obj.account_id)) {
        return { status: 'not_found' };
      }
      const links = asObj(obj.links);
      const avatarHref = asStr(asObj(links?.avatar)?.href);
      return {
        status: 'found',
        id: asStr(obj.account_id) || asStr(obj.uuid),
        displayName: asStr(obj.display_name) || asStr(obj.nickname) || asStr(obj.username),
        avatarUrl: avatarHref,
        location: asStr(obj.location),
        createdAt: asStr(obj.created_on),
      };
    },
  },
  {
    platform: 'Codeberg',
    category: 'Developer & Code',
    urlFn: (h) => `https://codeberg.org/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://codeberg.org/api/v1/users/${encodeURIComponent(h)}`,
  },
  {
    platform: 'SourceHut',
    category: 'Developer & Code',
    urlFn: (h) => `https://sr.ht/~${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['404 not found', 'page not found', 'no such user'],
      foundMarkers: (low, _raw, h) => low.includes(`~${h}`),
    },
  },
  {
    platform: 'Gitee',
    category: 'Developer & Code',
    urlFn: (h) => `https://gitee.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://gitee.com/api/v5/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.login) return { status: 'not_found' };
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.name) || asStr(obj.login),
        avatarUrl: asStr(obj.avatar_url),
        bio: asStr(obj.bio),
        followers: asNum(obj.followers),
        createdAt: asStr(obj.created_at),
      };
    },
  },
  {
    platform: 'Launchpad',
    category: 'Developer & Code',
    urlFn: (h) => `https://launchpad.net/~${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://api.launchpad.net/1.0/~${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.name) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(obj.display_name) || asStr(obj.name),
        createdAt: asStr(obj.date_created),
        bio: asStr(obj.description),
      };
    },
  },
  {
    platform: 'SourceForge',
    category: 'Developer & Code',
    urlFn: (h) => `https://sourceforge.net/u/${encodeURIComponent(h)}/profile/`,
    htmlCheck: {
      notFoundMarkers: ['whoops, we can’t find that page', "we can't find that page", '404'],
      foundMarkers: (low, _raw, h) => low.includes(`/u/${h}`),
    },
  },
  {
    platform: 'NotABug',
    category: 'Developer & Code',
    urlFn: (h) => `https://notabug.org/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h),
    },
  },
  {
    platform: 'npm Registry',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.npmjs.com/~${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://registry.npmjs.org/-/user/org.couchdb.user:${encodeURIComponent(h)}`,
  },
  {
    platform: 'PyPI',
    category: 'Developer & Code',
    urlFn: (h) => `https://pypi.org/user/${encodeURIComponent(h)}/`,
    customProbeFn: async (h) => {
      const profileUrl = `https://pypi.org/user/${encodeURIComponent(h)}/`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5500);
      try {
        const res = await fetch(profileUrl, {
          redirect: 'follow',
          signal: controller.signal,
          headers: {
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          },
        });
        if (res.status === 404) return { status: 'not_found', httpStatus: 404 };
        const html = await res.text().catch(() => '');
        const low = html.toLowerCase();
        if (
          low.includes('client challenge') ||
          low.includes("making sure you're not a bot") ||
          low.includes('fastly') ||
          (html.length < 4200 && low.includes('enable javascript'))
        ) {
          return {
            status: 'not_checked',
            httpStatus: res.status || 403,
            bio: 'PyPI Fastly bot-challenge active on user profile endpoint.',
          };
        }
        if (
          res.status >= 200 &&
          res.status < 300 &&
          !low.includes("we looked everywhere but couldn't find") &&
          !low.includes('page not found') &&
          low.includes(`/user/${h.toLowerCase()}`)
        ) {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: `@${h}`,
            url: profileUrl,
            bio: `Verified PyPI maintainer profile at ${profileUrl}.`,
          };
        }
        return {
          status: res.status === 200 ? 'not_found' : 'not_checked',
          httpStatus: res.status,
        };
      } catch {
        return { status: 'not_checked', httpStatus: 0 };
      } finally {
        clearTimeout(timer);
      }
    },
  },
  {
    platform: 'Docker Hub',
    category: 'Developer & Code',
    urlFn: (h) => `https://hub.docker.com/u/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://hub.docker.com/v2/users/${encodeURIComponent(h)}/`,
  },
  {
    platform: 'Crates.io',
    category: 'Developer & Code',
    urlFn: (h) => `https://crates.io/users/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://crates.io/api/v1/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const user = asObj(asObj(data)?.user);
      if (!user || !user.login) return { status: 'not_found' };
      return {
        status: 'found',
        id: user.id !== undefined ? String(user.id) : undefined,
        displayName: asStr(user.name) || asStr(user.login),
        avatarUrl: asStr(user.avatar),
        url: asStr(user.url) || `https://crates.io/users/${asStr(user.login)}`,
      };
    },
  },
  {
    platform: 'RubyGems',
    category: 'Developer & Code',
    urlFn: (h) => `https://rubygems.org/profiles/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://rubygems.org/api/v1/profiles/${encodeURIComponent(h)}.json`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || (!obj.handle && !obj.id)) return { status: 'not_found' };
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.handle),
      };
    },
  },
  {
    platform: 'Packagist',
    category: 'Developer & Code',
    urlFn: (h) => `https://packagist.org/users/${encodeURIComponent(h)}/`,
    apiUrlFn: (h) => `https://packagist.org/users/${encodeURIComponent(h)}.json`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(obj.username),
        createdAt: asStr(obj.created),
      };
    },
  },
  {
    platform: 'NuGet',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.nuget.org/profiles/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'user not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('nuget'),
    },
  },
  {
    platform: 'Hex.pm',
    category: 'Developer & Code',
    urlFn: (h) => `https://hex.pm/users/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://hex.pm/api/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(obj.full_name) || asStr(obj.username),
        createdAt: asStr(obj.inserted_at),
      };
    },
  },
  {
    platform: 'StackOverflow',
    category: 'Developer & Code',
    urlFn: (_h) => `https://stackoverflow.com/users?tab=users&filter=all`,
    apiUrlFn: (h) =>
      `https://api.stackexchange.com/2.3/users?order=desc&sort=reputation&inname=${encodeURIComponent(
        h
      )}&site=stackoverflow&pagesize=5`,
    extractJson: (data, h) => {
      const items = asObj(data)?.items;
      if (!Array.isArray(items)) return { status: 'not_found' };
      const exact = items
        .map(asObj)
        .find((u) => asStr(u?.display_name)?.toLowerCase() === h.toLowerCase());
      if (!exact) return { status: 'not_found' };
      return {
        status: 'found',
        id: exact.user_id !== undefined ? String(exact.user_id) : undefined,
        displayName: asStr(exact.display_name),
        avatarUrl: asStr(exact.profile_image),
        location: asStr(exact.location),
        createdAt:
          typeof exact.creation_date === 'number'
            ? new Date(exact.creation_date * 1000).toISOString()
            : undefined,
        url: asStr(exact.link),
        extraFields:
          typeof exact.reputation === 'number'
            ? [{ label: 'Reputation', value: String(exact.reputation) }]
            : undefined,
      };
    },
  },
  {
    platform: 'WakaTime',
    category: 'Developer & Code',
    urlFn: (h) => `https://wakatime.com/@${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://wakatime.com/api/v1/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const u = asObj(asObj(data)?.data);
      if (!u || (!u.username && !u.id)) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(u.id),
        displayName: asStr(u.display_name) || asStr(u.full_name) || asStr(u.username),
        avatarUrl: asStr(u.photo),
        location: asStr(u.location),
        bio: asStr(u.bio),
        createdAt: asStr(u.created_at),
      };
    },
  },
  ...EXTRA_MAIGRET_TARGETS,
];

// ---------------------------------------------------------------------------
// 2. BLACKBIRD CATALOG (50 Platforms): Gaming, Security/CTF, Art, Audio, Anime
// ---------------------------------------------------------------------------
export const BLACKBIRD_TARGETS: PlatformSweepTarget[] = [
  {
    platform: 'CrazyGames',
    category: 'Social & Community',
    urlFn: (h) => `https://www.crazygames.com/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: [
        'user not found',
        'page not found',
        "this user doesn't exist",
        'could not find this user',
        'error 404',
      ],
      rejectRedirectSubstrings: ['/login', '/404'],
      foundMarkers: (low, _raw, h) =>
        low.includes(h) && (low.includes('crazygames') || low.includes('og:title')),
    },
  },
  {
    platform: 'Roblox',
    category: 'Social & Community',
    urlFn: (h) => `https://www.roblox.com/users/profile?username=${encodeURIComponent(h)}`,
    apiUrlFn: () => 'https://users.roblox.com/v1/usernames/users',
    apiMethod: 'POST',
    apiHeaders: { 'Content-Type': 'application/json' },
    apiBodyFn: (h) => JSON.stringify({ usernames: [h], excludeBannedUsers: false }),
    extractJson: (data) => {
      const arr = asObj(data)?.data;
      if (!Array.isArray(arr) || arr.length === 0) return { status: 'not_found' };
      const u = asObj(arr[0]);
      if (!u || !u.id) return { status: 'not_found' };
      return {
        status: 'found',
        id: String(u.id),
        displayName: asStr(u.displayName) || asStr(u.name),
        url: `https://www.roblox.com/users/${u.id}/profile`,
      };
    },
  },
  {
    platform: 'Minecraft (Mojang)',
    category: 'Social & Community',
    urlFn: (h) => `https://namemc.com/profile/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.id || !obj.name) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.id),
        displayName: asStr(obj.name),
        avatarUrl: `https://mc-heads.net/avatar/${asStr(obj.id)}/128`,
      };
    },
  },
  {
    platform: 'Steam',
    category: 'Social & Community',
    urlFn: (h) => `https://steamcommunity.com/id/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: [
        'the specified profile could not be found',
        'steam community :: error',
      ],
      foundMarkers: (low) =>
        low.includes('steam community ::') &&
        !low.includes('the specified profile could not be found'),
    },
  },
  {
    platform: 'Itch.io',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.itch.io`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['invalid url', 'page not found', "couldn't find", 'itch.io/404'],
      foundMarkers: (low) => low.includes('itch.io') && !low.includes('invalid url'),
    },
  },
  {
    platform: 'GameJolt',
    category: 'Social & Community',
    urlFn: (h) => `https://gamejolt.com/@${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://gamejolt.com/site-api/web/profile/overview/@${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const user = asObj(asObj(data)?.payload)?.user;
      const u = asObj(user);
      if (!u || !u.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: u.id !== undefined ? String(u.id) : undefined,
        displayName: asStr(u.display_name) || asStr(u.username),
        avatarUrl: asStr(u.img_avatar),
        followers: asNum(u.follower_count),
      };
    },
  },
  {
    platform: 'Newgrounds',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.newgrounds.com`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['newgrounds - 404', 'not found', 'error 404', 'no such user'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('newgrounds'),
    },
  },
  {
    platform: 'Kongregate',
    category: 'Social & Community',
    urlFn: (h) => `https://www.kongregate.com/accounts/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', "couldn't find that account", '404'],
      foundMarkers: (low, _raw, h) => low.includes(h),
    },
  },
  {
    platform: 'Chess.com',
    category: 'Social & Community',
    urlFn: (h) => `https://www.chess.com/member/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.chess.com/pub/player/${encodeURIComponent(h.toLowerCase())}`,
  },
  {
    platform: 'Lichess',
    category: 'Social & Community',
    urlFn: (h) => `https://lichess.org/@/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://lichess.org/api/user/${encodeURIComponent(h)}`,
  },
  {
    platform: 'Speedrun.com',
    category: 'Social & Community',
    urlFn: (h) => `https://www.speedrun.com/users/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://www.speedrun.com/api/v1/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const u = asObj(asObj(data)?.data);
      if (!u || !u.id) return { status: 'not_found' };
      const names = asObj(u.names);
      const loc = asObj(asObj(u.location)?.country);
      const locNames = asObj(loc?.names);
      return {
        status: 'found',
        id: asStr(u.id),
        displayName: asStr(names?.international) || asStr(names?.japanese),
        location: asStr(locNames?.international),
        createdAt: asStr(u.signup),
        url: asStr(u.weblink),
      };
    },
  },
  {
    platform: 'osu!',
    category: 'Social & Community',
    urlFn: (h) => `https://osu.ppy.sh/users/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['user not found', 'page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('osu!'),
    },
  },
  {
    platform: 'Twitch',
    category: 'Social & Community',
    urlFn: (h) => `https://www.twitch.tv/${encodeURIComponent(h)}`,
    apiUrlFn: () => 'https://gql.twitch.tv/gql',
    apiMethod: 'POST',
    apiHeaders: {
      'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
      'Content-Type': 'application/json',
    },
    apiBodyFn: (h) =>
      JSON.stringify({
        query: `query { user(login: "${h.replace(/[^a-zA-Z0-9_]/g, '')}") { id login displayName description profileImageURL(width: 300) createdAt followers { totalCount } } }`,
      }),
    extractJson: (data) => {
      const u = asObj(asObj(asObj(data)?.data)?.user);
      if (!u || !u.login) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(u.id),
        displayName: asStr(u.displayName) || asStr(u.login),
        avatarUrl: asStr(u.profileImageURL),
        bio: asStr(u.description),
        createdAt: asStr(u.createdAt),
        followers: asNum(asObj(u.followers)?.totalCount),
      };
    },
  },
  {
    platform: 'Kick',
    category: 'Social & Community',
    urlFn: (h) => `https://kick.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://kick.com/api/v2/channels/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || (!obj.slug && !obj.id)) return { status: 'not_found' };
      const user = asObj(obj.user);
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(user?.username) || asStr(obj.slug),
        avatarUrl: asStr(user?.profile_pic),
        bio: asStr(user?.bio),
        followers: asNum(obj.followers_count),
      };
    },
  },
  {
    platform: 'Tetr.io',
    category: 'Social & Community',
    urlFn: (h) => `https://ch.tetr.io/u/${encodeURIComponent(h.toLowerCase())}`,
    apiUrlFn: (h) =>
      `https://ch.tetr.io/api/users/${encodeURIComponent(h.toLowerCase())}`,
    extractJson: (data) => {
      const obj = asObj(data);
      const u = asObj(obj?.data);
      if (!obj?.success || !u || !u.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(u._id),
        displayName: asStr(u.username),
        location: asStr(u.country),
        bio: asStr(u.bio),
        createdAt: asStr(u.ts),
      };
    },
  },
  {
    platform: 'Monkeytype',
    category: 'Social & Community',
    urlFn: (h) => `https://monkeytype.com/profile/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.monkeytype.com/users/${encodeURIComponent(h)}/profile`,
    extractJson: (data) => {
      const d = asObj(asObj(data)?.data);
      if (!d || !d.name) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(d.uid),
        displayName: asStr(d.name),
        createdAt:
          typeof d.addedAt === 'number' ? new Date(d.addedAt).toISOString() : undefined,
      };
    },
  },
  {
    platform: 'BoardGameGeek',
    category: 'Social & Community',
    urlFn: (h) => `https://boardgamegeek.com/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['user not found', '404', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('boardgamegeek'),
    },
  },
  {
    platform: 'Scratch',
    category: 'Developer & Code',
    urlFn: (h) => `https://scratch.mit.edu/users/${encodeURIComponent(h)}/`,
    apiUrlFn: (h) => `https://api.scratch.mit.edu/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      const profile = asObj(obj.profile);
      const imgs = asObj(profile?.images);
      const history = asObj(obj.history);
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.username),
        avatarUrl: asStr(imgs?.['90x90']),
        location: asStr(profile?.country),
        bio: asStr(profile?.bio),
        createdAt: asStr(history?.joined),
      };
    },
  },
  {
    platform: 'Modrinth',
    category: 'Developer & Code',
    urlFn: (h) => `https://modrinth.com/user/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://api.modrinth.com/v2/user/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.id),
        displayName: asStr(obj.name) || asStr(obj.username),
        avatarUrl: asStr(obj.avatar_url),
        bio: asStr(obj.bio),
        createdAt: asStr(obj.created),
      };
    },
  },
  {
    platform: 'CurseForge',
    category: 'Social & Community',
    urlFn: (h) => `https://www.curseforge.com/members/${encodeURIComponent(h)}/projects`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'user not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('curseforge'),
    },
  },
  {
    platform: 'Keybase',
    category: 'Developer & Code',
    urlFn: (h) => `https://keybase.io/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://keybase.io/_/api/1.0/user/lookup.json?username=${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const them = asObj(data)?.them;
      if (!Array.isArray(them) || !them[0] || typeof them[0] !== 'object') {
        return { status: 'not_found' };
      }
      const user = asObj(them[0]);
      if (!user || !user.id) return { status: 'not_found' };
      const profile = asObj(user.profile);
      const basics = asObj(user.basics);
      const primaryPic = asObj(asObj(user.pictures)?.primary);
      return {
        status: 'found',
        id: asStr(user.id),
        displayName: asStr(profile?.full_name) || asStr(basics?.username),
        avatarUrl: asStr(primaryPic?.url),
        location: asStr(profile?.location),
        bio: asStr(profile?.bio),
        createdAt:
          typeof basics?.ctime === 'number'
            ? new Date(basics.ctime * 1000).toISOString()
            : undefined,
      };
    },
  },
  {
    platform: 'HackerOne',
    category: 'Developer & Code',
    urlFn: (h) => `https://hackerone.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'the page you were looking for'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('hackerone'),
    },
  },
  {
    platform: 'Bugcrowd',
    category: 'Developer & Code',
    urlFn: (h) => `https://bugcrowd.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'researcher not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('bugcrowd'),
    },
  },
  {
    platform: 'TryHackMe',
    category: 'Developer & Code',
    urlFn: (h) => `https://tryhackme.com/p/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://tryhackme.com/api/v2/badges/public-profile?username=${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      const d = asObj(obj?.data);
      if (obj?.status === 'error' || !d) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(d.username),
        avatarUrl: asStr(d.avatar),
        location: asStr(d.country),
      };
    },
  },
  {
    platform: 'CTFtime',
    category: 'Developer & Code',
    urlFn: (h) => `https://ctftime.org/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('ctftime'),
    },
  },
  {
    platform: 'Root-Me',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.root-me.org/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['404', 'page not found', "n'existe pas"],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('root-me'),
    },
  },
  {
    platform: 'CryptoHack',
    category: 'Developer & Code',
    urlFn: (h) => `https://cryptohack.org/user/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['user does not exist', '404', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('cryptohack'),
    },
  },
  {
    platform: 'Hackaday.io',
    category: 'Developer & Code',
    urlFn: (h) => `https://hackaday.io/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('hackaday'),
    },
  },
  {
    platform: 'Codewars',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.codewars.com/users/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://www.codewars.com/api/v1/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.success === false || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.id),
        displayName: asStr(obj.name) || asStr(obj.username),
        extraFields:
          typeof obj.honor === 'number'
            ? [{ label: 'Codewars Honor', value: String(obj.honor) }]
            : undefined,
      };
    },
  },
  {
    platform: 'DeviantArt',
    category: 'Social & Community',
    urlFn: (h) => `https://www.deviantart.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'the page you requested could not be found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('deviantart'),
    },
  },
  {
    platform: 'ArtStation',
    category: 'Social & Community',
    urlFn: (h) => `https://www.artstation.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://www.artstation.com/users/${encodeURIComponent(h.toLowerCase())}.json`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.full_name) || asStr(obj.username),
        avatarUrl: asStr(obj.large_avatar_url) || asStr(obj.medium_avatar_url),
        location: asStr(obj.city) || asStr(obj.country),
        bio: asStr(obj.headline),
        followers: asNum(obj.followers_count),
      };
    },
  },
  {
    platform: 'Behance',
    category: 'Social & Community',
    urlFn: (h) => `https://www.behance.net/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['oops! we can’t find that page', "oops! we can't find that page", '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('behance'),
    },
  },
  {
    platform: 'Dribbble',
    category: 'Social & Community',
    urlFn: (h) => `https://dribbble.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['whoops, that page is gone', '404', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('dribbble'),
    },
  },
  {
    platform: 'Unsplash',
    category: 'Social & Community',
    urlFn: (h) => `https://unsplash.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', "hm, the page you were looking for doesn't exist"],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`) && low.includes('unsplash'),
    },
  },
  {
    platform: 'Flickr',
    category: 'Social & Community',
    urlFn: (h) => `https://www.flickr.com/people/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'oops! looks like you followed a bad link', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('flickr'),
    },
  },
  {
    platform: 'Sketchfab',
    category: 'Social & Community',
    urlFn: (h) => `https://sketchfab.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.sketchfab.com/v3/users?username=${encodeURIComponent(h)}`,
    extractJson: (data, h) => {
      const results = asObj(data)?.results;
      if (!Array.isArray(results)) return { status: 'not_found' };
      const exact = results
        .map(asObj)
        .find((u) => asStr(u?.username)?.toLowerCase() === h.toLowerCase());
      if (!exact) return { status: 'not_found' };
      const avatarImgs = asObj(exact.avatar)?.images;
      const avatar = Array.isArray(avatarImgs) ? asStr(asObj(avatarImgs[0])?.url) : undefined;
      return {
        status: 'found',
        id: asStr(exact.uid),
        displayName: asStr(exact.displayName) || asStr(exact.username),
        avatarUrl: avatar,
        url: asStr(exact.profileUrl),
      };
    },
  },
  {
    platform: 'Giphy',
    category: 'Social & Community',
    urlFn: (h) => `https://giphy.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('giphy'),
    },
  },
  {
    platform: 'Tenor',
    category: 'Social & Community',
    urlFn: (h) => `https://tenor.com/users/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'user not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('tenor'),
    },
  },
  {
    platform: 'Pixabay',
    category: 'Social & Community',
    urlFn: (h) => `https://pixabay.com/users/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'user not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('pixabay'),
    },
  },
  {
    platform: 'LottieFiles',
    category: 'Developer & Code',
    urlFn: (h) => `https://lottiefiles.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('lottiefiles'),
    },
  },
  {
    platform: 'SoundCloud',
    category: 'Social & Community',
    urlFn: (h) => `https://soundcloud.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ["we can't find that user", 'we can’t find that user', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('soundcloud'),
    },
  },
  {
    platform: 'Bandcamp',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.bandcamp.com`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['sorry, that something isn’t here', "sorry, that something isn't here", 'not found'],
      foundMarkers: (low) => low.includes('bandcamp'),
    },
  },
  {
    platform: 'Mixcloud',
    category: 'Social & Community',
    urlFn: (h) => `https://www.mixcloud.com/${encodeURIComponent(h)}/`,
    apiUrlFn: (h) => `https://api.mixcloud.com/${encodeURIComponent(h)}/`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.error || !obj.username) return { status: 'not_found' };
      const pics = asObj(obj.pictures);
      return {
        status: 'found',
        displayName: asStr(obj.name) || asStr(obj.username),
        avatarUrl: asStr(pics?.large) || asStr(pics?.medium),
        location: asStr(obj.city) || asStr(obj.country),
        bio: asStr(obj.biog),
        followers: asNum(obj.follower_count),
        createdAt: asStr(obj.created_time),
      };
    },
  },
  {
    platform: 'Vimeo',
    category: 'Social & Community',
    urlFn: (h) => `https://vimeo.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ["sorry, we couldn't find that page", 'sorry, we couldn’t find that page', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('vimeo'),
    },
  },
  {
    platform: 'Dailymotion',
    category: 'Social & Community',
    urlFn: (h) => `https://www.dailymotion.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.dailymotion.com/user/${encodeURIComponent(
        h
      )}?fields=id,username,screenname,avatar_240_url,created_time,followers_total`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.error || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.id),
        displayName: asStr(obj.screenname) || asStr(obj.username),
        avatarUrl: asStr(obj.avatar_240_url),
        followers: asNum(obj.followers_total),
        createdAt:
          typeof obj.created_time === 'number'
            ? new Date(obj.created_time * 1000).toISOString()
            : undefined,
      };
    },
  },
  {
    platform: 'Last.fm',
    category: 'Social & Community',
    urlFn: (h) => `https://www.last.fm/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'user not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`/user/${h}`),
    },
  },
  {
    platform: 'Audiomack',
    category: 'Social & Community',
    urlFn: (h) => `https://audiomack.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('audiomack'),
    },
  },
  {
    platform: 'MyAnimeList',
    category: 'Social & Community',
    urlFn: (h) => `https://myanimelist.net/profile/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://api.jikan.moe/v4/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const d = asObj(asObj(data)?.data);
      if (!d || !d.username) return { status: 'not_found' };
      const imgs = asObj(asObj(d.images)?.jpg);
      return {
        status: 'found',
        id: d.mal_id !== undefined ? String(d.mal_id) : undefined,
        displayName: asStr(d.username),
        avatarUrl: asStr(imgs?.image_url),
        location: asStr(d.location),
        createdAt: asStr(d.joined),
      };
    },
  },
  {
    platform: 'AniList',
    category: 'Social & Community',
    urlFn: (h) => `https://anilist.co/user/${encodeURIComponent(h)}`,
    apiUrlFn: () => 'https://graphql.anilist.co',
    apiMethod: 'POST',
    apiHeaders: { 'Content-Type': 'application/json' },
    apiBodyFn: (h) =>
      JSON.stringify({
        query: `query ($name: String) { User(name: $name) { id name about avatar { large } siteUrl createdAt } }`,
        variables: { name: h },
      }),
    extractJson: (data) => {
      const u = asObj(asObj(asObj(data)?.data)?.User);
      if (!u || !u.name) return { status: 'not_found' };
      return {
        status: 'found',
        id: u.id !== undefined ? String(u.id) : undefined,
        displayName: asStr(u.name),
        avatarUrl: asStr(asObj(u.avatar)?.large),
        bio: asStr(u.about)?.slice(0, 220),
        createdAt:
          typeof u.createdAt === 'number'
            ? new Date(u.createdAt * 1000).toISOString()
            : undefined,
        url: asStr(u.siteUrl),
      };
    },
  },
  {
    platform: 'Letterboxd',
    category: 'Social & Community',
    urlFn: (h) => `https://letterboxd.com/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['sorry, we can’t find the page', "sorry, we can't find the page", '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('letterboxd'),
    },
  },
  ...EXTRA_BLACKBIRD_TARGETS,
];

// ---------------------------------------------------------------------------
// 3. SHERLOCK CATALOG (50 Platforms): Social, Creator, Publishing, Archives, Web
// ---------------------------------------------------------------------------
export const SHERLOCK_TARGETS: PlatformSweepTarget[] = [
  {
    platform: 'Reddit',
    category: 'Social & Community',
    urlFn: (h) => `https://www.reddit.com/user/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://www.reddit.com/user/${encodeURIComponent(h)}/about.json`,
  },
  {
    platform: 'Bluesky',
    category: 'Social & Community',
    urlFn: (h) =>
      `https://bsky.app/profile/${encodeURIComponent(
        h.includes('.') ? h : `${h}.bsky.social`
      )}`,
    apiUrlFn: (h) =>
      `https://public.api.bsky.app/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(
        h.includes('.') ? h : `${h}.bsky.social`
      )}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.error || !obj.handle) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.did),
        displayName: asStr(obj.displayName) || asStr(obj.handle),
        avatarUrl: asStr(obj.avatar),
        bio: asStr(obj.description),
        followers: asNum(obj.followersCount),
        createdAt: asStr(obj.createdAt),
      };
    },
  },
  {
    platform: 'Mastodon.social',
    category: 'Social & Community',
    urlFn: (h) => `https://mastodon.social/@${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://mastodon.social/api/v1/accounts/lookup?acct=${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.error || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.id),
        displayName: asStr(obj.display_name) || asStr(obj.username),
        avatarUrl: asStr(obj.avatar),
        followers: asNum(obj.followers_count),
        createdAt: asStr(obj.created_at),
        url: asStr(obj.url),
      };
    },
  },
  {
    platform: 'YouTube',
    category: 'Social & Community',
    urlFn: (h) => `https://www.youtube.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['404 not found', "this page isn't available", '404. that’s an error'],
      rejectRedirectSubstrings: ['consent.youtube.com/404'],
      foundMarkers: (low, _raw, h) =>
        (low.includes(`youtube.com/@${h}`) || low.includes('channelid')) &&
        low.includes('og:title'),
    },
  },
  {
    platform: 'Telegram',
    category: 'Social & Community',
    urlFn: (h) => `https://t.me/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['tgme_icon_user'],
      foundMarkers: (low) =>
        low.includes('tgme_page_title') && !low.includes('telegram: contact @'),
    },
  },
  {
    platform: 'TikTok',
    category: 'Social & Community',
    urlFn: (h) => `https://www.tiktok.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ["couldn't find this account", 'couldn’t find this account', 'page not available'],
      foundMarkers: (low, _raw, h) =>
        low.includes(`@${h}`) && low.includes('og:title') && !low.includes('tiktok - make your day'),
    },
  },
  {
    platform: 'Instagram',
    category: 'Social & Community',
    urlFn: (h) => `https://www.instagram.com/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ["sorry, this page isn't available", 'page not found'],
      rejectRedirectSubstrings: ['/accounts/login'],
      foundMarkers: (low, _raw, h) =>
        low.includes(`@${h}`) && low.includes('og:title') && !low.includes('login • instagram'),
    },
  },
  {
    platform: 'Threads',
    category: 'Social & Community',
    urlFn: (h) => `https://www.threads.net/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ["sorry, this page isn't available", 'page not found'],
      rejectRedirectSubstrings: ['/login'],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`) && low.includes('og:title'),
    },
  },
  {
    platform: 'Pinterest',
    category: 'Social & Community',
    urlFn: (h) => `https://www.pinterest.com/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['user not found', 'sorry! we couldn’t find that page'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('pinterest'),
    },
  },
  {
    platform: 'Imgur',
    category: 'Social & Community',
    urlFn: (h) => `https://imgur.com/user/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.imgur.com/account/v1/accounts/${encodeURIComponent(
        h
      )}?client_id=546c25a59c58ad7`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.username),
        avatarUrl: asStr(obj.avatar_url),
        bio: asStr(obj.bio),
        createdAt: asStr(obj.created_at),
      };
    },
  },
  {
    platform: 'Patreon',
    category: 'Social & Community',
    urlFn: (h) => `https://www.patreon.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'whoops!', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('patreon'),
    },
  },
  {
    platform: 'BuyMeACoffee',
    category: 'Social & Community',
    urlFn: (h) => `https://buymeacoffee.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', "we couldn't find that page"],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('buy me a coffee'),
    },
  },
  {
    platform: 'Ko-fi',
    category: 'Social & Community',
    urlFn: (h) => `https://ko-fi.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'oh no! that page was not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('ko-fi'),
    },
  },
  {
    platform: 'Gumroad',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.gumroad.com`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['page not found', "couldn't find", '404'],
      foundMarkers: (low) => low.includes('gumroad'),
    },
  },
  {
    platform: 'Linktree',
    category: 'Social & Community',
    urlFn: (h) => `https://linktr.ee/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['the page you’re looking for doesn’t exist', "page you're looking for doesn't exist"],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('linktr.ee'),
    },
  },
  {
    platform: 'Bento.me',
    category: 'Social & Community',
    urlFn: (h) => `https://bento.me/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['this page could not be found', '404', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('bento'),
    },
  },
  {
    platform: 'Carrd',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.carrd.co`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['page not found', 'site not found', '404'],
      foundMarkers: (_low, raw) => raw.trim().length > 100,
    },
  },
  {
    platform: 'About.me',
    category: 'Social & Community',
    urlFn: (h) => `https://about.me/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('about.me'),
    },
  },
  {
    platform: 'Bio.link',
    category: 'Social & Community',
    urlFn: (h) => `https://bio.link/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'claim this link'],
      foundMarkers: (low, _raw, h) => low.includes(h),
    },
  },
  {
    platform: 'Open Collective',
    category: 'Developer & Code',
    urlFn: (h) => `https://opencollective.com/${encodeURIComponent(h)}`,
    apiUrlFn: () => 'https://api.opencollective.com/graphql/v2',
    apiMethod: 'POST',
    apiHeaders: { 'Content-Type': 'application/json' },
    apiBodyFn: (h) =>
      JSON.stringify({
        query: `query($slug: String!) { account(slug: $slug, throwIfMissing: false) { id slug name description imageUrl location { name } createdAt } }`,
        variables: { slug: h.toLowerCase() },
      }),
    extractJson: (data) => {
      const acc = asObj(asObj(asObj(data)?.data)?.account);
      if (!acc || !acc.slug) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(acc.id),
        displayName: asStr(acc.name) || asStr(acc.slug),
        avatarUrl: asStr(acc.imageUrl),
        bio: asStr(acc.description),
        location: asStr(asObj(acc.location)?.name),
        createdAt: asStr(acc.createdAt),
      };
    },
  },
  {
    platform: 'Medium',
    category: 'Social & Community',
    urlFn: (h) => `https://medium.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['out of nothing, something.', 'page not found', '404'],
      foundMarkers: (low, _raw, h) =>
        low.includes(`@${h}`) && low.includes('medium') && !low.includes('out of nothing, something'),
    },
  },
  {
    platform: 'Substack',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.substack.com`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ["this page doesn't exist", 'this page doesn’t exist', 'page not found', '404'],
      foundMarkers: (low) => low.includes('substack') && low.includes('og:title'),
    },
  },
  {
    platform: 'WordPress.com',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.wordpress.com`,
    apiUrlFn: (h) =>
      `https://public-api.wordpress.com/rest/v1.1/sites/${encodeURIComponent(
        h.toLowerCase()
      )}.wordpress.com`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.error || !obj.ID) return { status: 'not_found' };
      return {
        status: 'found',
        id: String(obj.ID),
        displayName: asStr(obj.name),
        bio: asStr(obj.description),
        avatarUrl: asStr(asObj(obj.icon)?.img),
        url: asStr(obj.URL),
      };
    },
  },
  {
    platform: 'Tumblr',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.tumblr.com`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ["there's nothing here.", 'there’s nothing here', 'not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('tumblr'),
    },
  },
  {
    platform: 'Blogger',
    category: 'Social & Community',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.blogspot.com`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['blog not found', 'sorry, the blog you were looking for does not exist'],
      foundMarkers: (low) => low.includes('blogspot') || low.includes('blogger'),
    },
  },
  {
    platform: 'Goodreads',
    category: 'Social & Community',
    urlFn: (h) => `https://www.goodreads.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('goodreads'),
    },
  },
  {
    platform: 'Wattpad',
    category: 'Social & Community',
    urlFn: (h) => `https://www.wattpad.com/user/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://www.wattpad.com/api/v3/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || obj.error_code || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(obj.name) || asStr(obj.username),
        avatarUrl: asStr(obj.avatar),
        bio: asStr(obj.description),
        followers: asNum(obj.numFollowers),
        createdAt: asStr(obj.createDate),
      };
    },
  },
  {
    platform: 'Archive of Our Own',
    category: 'Social & Community',
    urlFn: (h) => `https://archiveofourown.org/users/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['user could not be found', 'error 404', 'page you were looking for'],
      foundMarkers: (low, _raw, h) => low.includes(`/users/${h}`),
    },
  },
  {
    platform: 'SlideShare',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://www.slideshare.net/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', "sorry, we couldn't find"],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('slideshare'),
    },
  },
  {
    platform: 'SpeakerDeck',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://speakerdeck.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('speaker deck'),
    },
  },
  {
    platform: 'Product Hunt',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.producthunt.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', 'we seem to have lost this page', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`) && low.includes('product hunt'),
    },
  },
  {
    platform: 'Lobste.rs',
    category: 'Developer & Code',
    urlFn: (h) => `https://lobste.rs/u/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://lobste.rs/u/${encodeURIComponent(h)}.json`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(obj.username),
        avatarUrl: asStr(obj.avatar_url)
          ? `https://lobste.rs${asStr(obj.avatar_url)}`
          : undefined,
        bio: asStr(obj.about),
        createdAt: asStr(obj.created_at),
      };
    },
  },
  {
    platform: 'Archive.org',
    category: 'Network & Infrastructure',
    urlFn: (h) => `https://archive.org/details/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['cannot find', 'item cannot be found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`),
    },
  },
  {
    platform: 'Pastebin',
    category: 'Developer & Code',
    urlFn: (h) => `https://pastebin.com/u/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['not found (#404)', 'unknown user', 'this page is no longer available'],
      foundMarkers: (low, _raw, h) => low.includes(`/u/${h}`) && low.includes('pastebin'),
    },
  },
  {
    platform: 'Wikipedia',
    category: 'Social & Community',
    urlFn: (h) => `https://en.wikipedia.org/wiki/User:${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://en.wikipedia.org/w/api.php?action=query&list=users&ususers=${encodeURIComponent(
        h
      )}&usprop=registration|editcount|groups&format=json`,
    extractJson: (data) => {
      const users = asObj(asObj(data)?.query)?.users;
      if (!Array.isArray(users) || users.length === 0) return { status: 'not_found' };
      const u = asObj(users[0]);
      if (!u || u.missing !== undefined || !u.userid) return { status: 'not_found' };
      return {
        status: 'found',
        id: String(u.userid),
        displayName: asStr(u.name),
        createdAt: asStr(u.registration),
        extraFields:
          typeof u.editcount === 'number'
            ? [{ label: 'Wiki Edits', value: String(u.editcount) }]
            : undefined,
      };
    },
  },
  {
    platform: 'OpenStreetMap',
    category: 'Network & Infrastructure',
    urlFn: (h) => `https://www.openstreetmap.org/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['does not exist', 'user not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`/user/${h}`),
    },
  },
  {
    platform: 'TradingView',
    category: 'Social & Community',
    urlFn: (h) => `https://www.tradingview.com/u/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ["this isn't the page you're looking for", '404', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes(`/u/${h}`),
    },
  },
  {
    platform: 'StockTwits',
    category: 'Social & Community',
    urlFn: (h) => `https://stocktwits.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.stocktwits.com/api/2/streams/user/${encodeURIComponent(h)}.json`,
    extractJson: (data) => {
      const u = asObj(asObj(data)?.user);
      if (!u || !u.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: u.id !== undefined ? String(u.id) : undefined,
        displayName: asStr(u.name) || asStr(u.username),
        avatarUrl: asStr(u.avatar_url),
        bio: asStr(u.bio),
        followers: asNum(u.followers),
        createdAt: asStr(u.join_date),
      };
    },
  },
  {
    platform: 'Instructables',
    category: 'Social & Community',
    urlFn: (h) => `https://www.instructables.com/member/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('instructables'),
    },
  },
  {
    platform: 'Thingiverse',
    category: 'Social & Community',
    urlFn: (h) => `https://www.thingiverse.com/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['404', 'nothing to see here', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('thingiverse'),
    },
  },
  {
    platform: 'Printables',
    category: 'Social & Community',
    urlFn: (h) => `https://www.printables.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'user not found'],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`),
    },
  },
  {
    platform: 'Pinboard',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://pinboard.in/u:${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['user does not exist', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`u:${h}`),
    },
  },
  {
    platform: 'freeCodeCamp',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.freecodecamp.org/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.freecodecamp.org/api/users/get-public-profile?username=${encodeURIComponent(
        h
      )}`,
    extractJson: (data) => {
      const entities = asObj(asObj(data)?.entities);
      const userMap = asObj(entities?.user);
      const u = userMap ? asObj(Object.values(userMap)[0]) : null;
      if (!u || !u.username) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(u.name) || asStr(u.username),
        avatarUrl: asStr(u.picture),
        location: asStr(u.location),
        bio: asStr(u.about),
      };
    },
  },
  {
    platform: 'Codecademy',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.codecademy.com/profiles/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['this profile does not exist', 'page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('codecademy'),
    },
  },
  {
    platform: 'Odysee',
    category: 'Social & Community',
    urlFn: (h) => `https://odysee.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['channel not found', '404', 'invalid url'],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`) && low.includes('odysee'),
    },
  },
  {
    platform: 'Rumble',
    category: 'Social & Community',
    urlFn: (h) => `https://rumble.com/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('rumble'),
    },
  },
  {
    platform: 'Fandom',
    category: 'Social & Community',
    urlFn: (h) => `https://community.fandom.com/wiki/User:${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['fandom is a bit confused', 'not a registered user', 'user account', 'does not exist'],
      foundMarkers: (low, _raw, h) => low.includes(`user:${h}`),
    },
  },
  {
    platform: 'Trakt',
    category: 'Social & Community',
    urlFn: (h) => `https://trakt.tv/users/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('trakt'),
    },
  },
  {
    platform: 'Slashdot',
    category: 'Developer & Code',
    urlFn: (h) => `https://slashdot.org/~${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['the user you requested does not exist', 'does not exist', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`~${h}`),
    },
  },
  {
    platform: 'Habr',
    category: 'Developer & Code',
    urlFn: (h) => `https://habr.com/en/users/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'страница не найдена'],
      foundMarkers: (low, _raw, h) => low.includes(`/users/${h}`),
    },
  },
  ...EXTRA_SHERLOCK_TARGETS,
];

// ---------------------------------------------------------------------------
// 4. HOLEHE CATALOG (18 Unique Email-Targeted & SaaS Platforms — Email Mode)
// Note: Zero overlap with Maigret/Blackbird/Sherlock platform names!
// ---------------------------------------------------------------------------
export const HOLEHE_EMAIL_TARGETS: PlatformSweepTarget[] = [
  {
    platform: 'Duolingo',
    category: 'Social & Community',
    urlFn: (h) => `https://www.duolingo.com/profile/${encodeURIComponent(h)}`,
    // On email targets, caller replaces `h` appropriately or we support email lookup directly
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('duolingo'),
    },
  },
  {
    platform: 'Disqus',
    category: 'Social & Community',
    urlFn: (h) => `https://disqus.com/by/${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', "we couldn't find that user"],
      foundMarkers: (low, _raw, h) => low.includes(`/by/${h}`),
    },
  },
  {
    platform: 'Notion Sites',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.notion.site`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['this content does not exist', 'page not found', '404'],
      foundMarkers: (low) =>
        (low.includes('og:title') || low.includes('twitter:title')) &&
        !low.includes('<title>notion</title>'),
    },
  },
  {
    platform: 'Deno Deploy',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.deno.dev`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['deployment not found', '404 not found'],
      foundMarkers: (_low, raw) => raw.trim().length > 80,
    },
  },
  {
    platform: 'Surge.sh',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.surge.sh`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['project not found', '404'],
      foundMarkers: (_low, raw) => raw.trim().length > 80,
    },
  },
  {
    platform: 'Koyeb',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.koyeb.app`,
    htmlCheck: {
      isSubdomainHost: true,
      notFoundMarkers: ['not found', 'no healthy upstream', '404'],
      foundMarkers: (_low, raw) => raw.trim().length > 80,
    },
  },
  {
    platform: 'Venmo',
    category: 'Social & Community',
    urlFn: (h) => `https://account.venmo.com/u/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', "we couldn't find that page", '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('venmo'),
    },
  },
  {
    platform: 'Cash App',
    category: 'Social & Community',
    urlFn: (h) => `https://cash.app/$${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'nothing here'],
      foundMarkers: (low, _raw, h) => low.includes(`$${h}`) && low.includes('cash app'),
    },
  },
  {
    platform: 'Pexels',
    category: 'Social & Community',
    urlFn: (h) => `https://www.pexels.com/@${encodeURIComponent(h)}/`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`) && low.includes('pexels'),
    },
  },
  {
    platform: 'VSCO',
    category: 'Social & Community',
    urlFn: (h) => `https://vsco.co/${encodeURIComponent(h)}/gallery`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('vsco'),
    },
  },
  {
    platform: 'Spotify',
    category: 'Social & Community',
    urlFn: (h) => `https://open.spotify.com/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', "couldn't find that user"],
      foundMarkers: (low, _raw, h) => low.includes(`/user/${h}`),
    },
  },
  {
    platform: 'Quora',
    category: 'Social & Community',
    urlFn: (h) => `https://www.quora.com/profile/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'profile does not exist'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('quora'),
    },
  },
  {
    platform: 'Flipboard',
    category: 'Social & Community',
    urlFn: (h) => `https://flipboard.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(`@${h}`) && low.includes('flipboard'),
    },
  },
  {
    platform: 'Untappd',
    category: 'Social & Community',
    urlFn: (h) => `https://untappd.com/user/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'user not found'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('untappd'),
    },
  },
  {
    platform: 'Minds',
    category: 'Social & Community',
    urlFn: (h) => `https://www.minds.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://www.minds.com/api/v1/channel/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const c = asObj(asObj(data)?.channel);
      if (!c || !c.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(c.guid),
        displayName: asStr(c.name) || asStr(c.username),
        bio: asStr(c.briefdescription),
        followers: asNum(c.subscribers_count),
      };
    },
  },
  ...EXTRA_HOLEHE_TARGETS,
];

// Merge legacy SaaS username-profile targets exclusively into Sherlock Username Mode (deduplicated)
const existingUsernamePlatforms = new Set(
  [...MAIGRET_TARGETS, ...BLACKBIRD_TARGETS, ...SHERLOCK_TARGETS].map((t) =>
    t.platform.toLowerCase()
  )
);
for (const target of HOLEHE_EMAIL_TARGETS) {
  const key = target.platform.toLowerCase();
  if (!existingUsernamePlatforms.has(key)) {
    existingUsernamePlatforms.add(key);
    SHERLOCK_TARGETS.push(target);
  }
}

function extractCanonicalRootHost(rawUrl: string): string {
  try {
    const host = new URL(rawUrl).hostname.replace(/^www\./i, '').toLowerCase();
    const parts = host.split('.').filter(Boolean);
    if (parts.length <= 2) return host;
    const secondLevelTlds = new Set([
      'co.uk',
      'org.uk',
      'gov.uk',
      'ac.uk',
      'com.au',
      'net.au',
      'org.au',
      'co.in',
      'net.in',
      'org.in',
      'ac.in',
      'gov.in',
      'co.jp',
      'ne.jp',
      'or.jp',
      'com.br',
      'com.sg',
      'co.kr',
      'co.nz',
      'co.za',
      'com.mx',
      'com.tr',
    ]);
    const lastTwo = parts.slice(-2).join('.');
    if (secondLevelTlds.has(lastTwo) && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return lastTwo;
  } catch {
    return '';
  }
}

export function buildHoleheTargets(emailOrHandle: string): PlatformSweepTarget[] {
  const cleanEmail = emailOrHandle.trim();
  const isEmail = cleanEmail.includes('@');
  if (!isEmail) {
    return [];
  }

  // Strict Email Mode: ONLY real email-anchored probes (never strip prefix / guess username handles)
  // Live-verifying API/registry probes run FIRST, followed by distinct canonical domains (>= 845 unique sites).
  const livePriorityTargets: PlatformSweepTarget[] = [
    {
      platform: 'Duolingo',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.duolingo.com/',
      apiUrlFn: () =>
        `https://www.duolingo.com/2017-06-30/users?email=${encodeURIComponent(cleanEmail)}`,
      extractJson: (data) => {
        const users = asObj(data)?.users;
        if (!Array.isArray(users) || users.length === 0) {
          return { status: 'not_found' };
        }
        const u = asObj(users[0]);
        if (!u) return { status: 'not_found' };
        const username = asStr(u.username);
        const rawPicture = asStr(u.picture);
        const avatarUrl = rawPicture
          ? `${rawPicture.startsWith('//') ? `https:${rawPicture}` : rawPicture}/large`
          : undefined;
        const authProviders = [
          u.hasGoogleId === true ? 'Google OAuth' : null,
          u.hasFacebookId === true ? 'Facebook' : null,
          u.hasAppleId === true ? 'Apple' : null,
        ].filter((v): v is string => Boolean(v));
        return {
          status: 'found',
          id: typeof u.id === 'number' && u.id > 0 ? String(u.id) : undefined,
          displayName: asStr(u.name) || username || cleanEmail,
          verifiedUsername: username,
          avatarUrl,
          url: username
            ? `https://www.duolingo.com/profile/${encodeURIComponent(username)}`
            : 'https://www.duolingo.com/',
          extraFields: [
            ...(authProviders.length > 0
              ? [{ label: 'Linked Auth', value: authProviders.join(', ') }]
              : []),
            ...(typeof u.totalXp === 'number' && u.totalXp > 0
              ? [{ label: 'Duolingo XP', value: String(u.totalXp) }]
              : []),
          ],
        };
      },
    },
    {
      platform: 'ORCID Registry',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () =>
        `https://orcid.org/orcid-search/search?searchQuery=${encodeURIComponent(cleanEmail)}`,
      apiUrlFn: () =>
        `https://pub.orcid.org/v3.0/expanded-search/?q=email:${encodeURIComponent(cleanEmail)}`,
      apiHeaders: { Accept: 'application/json' },
      extractJson: (data) => {
        const obj = asObj(data);
        const num = asNum(obj?.['num-found']);
        const res = obj?.['expanded-result'];
        if (!num || !Array.isArray(res) || res.length === 0) {
          return { status: 'not_found' };
        }
        const first = asObj(res[0]);
        const orcidId = asStr(first?.['orcid-id']);
        const names = [asStr(first?.['given-names']), asStr(first?.['family-names'])]
          .filter(Boolean)
          .join(' ');
        return {
          status: 'found',
          id: orcidId,
          displayName: names || orcidId || cleanEmail,
          url: orcidId ? `https://orcid.org/${orcidId}` : undefined,
        };
      },
    },
    ...buildExtraEmailProbes(cleanEmail),
  ];

  const rawTargets: PlatformSweepTarget[] = [
    ...livePriorityTargets,
    ...buildMegaEmailProbes(cleanEmail),
  ];

  // Deduplicate by normalized slug AND canonical root domain for passive DNS targets,
  // while preserving distinct live-verification API/composite probes that share a homepage host.
  const seenSlugs = new Set<string>();
  const seenPassiveHosts = new Set<string>();
  const uniqueTargets: PlatformSweepTarget[] = [];
  for (const t of rawTargets) {
    const slug = t.platform.toLowerCase().replace(/\W+/g, '-');
    if (seenSlugs.has(slug)) continue;
    const rootHost = extractCanonicalRootHost(t.urlFn(cleanEmail));
    if (!t.isLiveVerification && rootHost && seenPassiveHosts.has(rootHost)) continue;
    seenSlugs.add(slug);
    if (rootHost && !t.isLiveVerification) seenPassiveHosts.add(rootHost);
    uniqueTargets.push(t);
  }
  return uniqueTargets;
}

export { GENERIC_404_MARKERS };
