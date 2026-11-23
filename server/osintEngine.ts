import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import tls from 'node:tls';
import type {
  ArtifactItem,
  BreachedAccountItem,
  GeoMarker,
  InvestigationRecord,
  InvestigationResultItem,
  ProfilePhotoItem,
  TargetType,
  ToolExecutionState,
  ToolHealthItem,
  ToolId,
  TyposquatCandidate,
  UsernamePermutationItem,
} from '../src/types/investigation.ts';
import { runDeepGoogleDorking } from './dorkEngine.ts';
import { runNativeGhuntInvestigation } from './ghuntNative.ts';
import { resolveIndianTelecomSeries } from './indianTelecom.ts';
import {
  BLACKBIRD_TARGETS,
  GENERIC_404_MARKERS,
  MAIGRET_TARGETS,
  SHERLOCK_TARGETS,
  buildHoleheTargets,
  type PlatformSweepTarget,
} from './platformCatalog.ts';
import {
  buildPhoneServiceProbes,
  normalizePhoneTarget,
  runPhoneExposureChecks,
  type CountryCallingMeta,
  type NormalizedPhoneTarget,
} from './phoneCatalog.ts';

const USER_AGENT = 'Parmanu-OSINT/3.1 (+https://parmanu-osint.local)';

export async function inspectToolsHealth(): Promise<ToolHealthItem[]> {
  const toolMessages: Record<ToolId, string> = {
    mailaccess: 'Live-native core: DNS/MX, OpenPGP, Gravatar, GitHub, Slack & breach intelligence (+ opt-in deep dorking)',
    holehe: 'Live-native strict email probes (850+ portals) + Verified-Handle cross-platform correlation',
    maigret: 'Live-native Cloud PaaS, code forge, AI & registry sweep',
    ghunt: 'Live-native Google MX, Unavatar Google, Calendar ICS & contributor telemetry',
    blackbird: 'Live-native gaming, EdTech, audio & security profile sweep',
    sherlock: 'Live-native social, Fediverse, creator & Wikimedia sweep',
    phoneinfoga: 'Live-native phone normalization, TRAI MSC, OVH VoIP (+ opt-in deep Google Dorking)',
    ignorant: 'Live-native zero-SMS pre-OTP account verification & telecom audit (370+ portals)',
  };

  const tools: ToolId[] = [
    'mailaccess',
    'holehe',
    'maigret',
    'ghunt',
    'blackbird',
    'sherlock',
    'phoneinfoga',
    'ignorant',
  ];

  return tools.map((tool) => ({
    tool,
    status: 'ready' as const,
    mode: 'live-native' as const,
    message: toolMessages[tool],
  }));
}

async function fetchJsonSafe<T>(
  url: string,
  timeoutMs = 5500,
  extraHeaders: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...extraHeaders,
      },
    });
    const status = res.status;
    if (!res.ok) return { ok: false, status };
    const data = (await res.json()) as T;
    return { ok: true, status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Request failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHeadOrGetStatus(
  url: string,
  timeoutMs = 5000
): Promise<{
  status: number;
  finalUrl?: string;
  serverHeader?: string;
  headers?: Record<string, string>;
  error?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml,application/json,text/plain',
      },
    });
    const trackedHeaders: Record<string, string> = {};
    for (const key of [
      'strict-transport-security',
      'content-security-policy',
      'x-frame-options',
      'x-content-type-options',
      'referrer-policy',
      'permissions-policy',
      'x-powered-by',
    ]) {
      const val = res.headers.get(key);
      if (val) trackedHeaders[key] = val.slice(0, 220);
    }
    await res.body?.cancel().catch(() => {});
    return {
      status: res.status,
      finalUrl: res.url,
      serverHeader: res.headers.get('server') || undefined,
      headers: trackedHeaders,
    };
  } catch (err) {
    return {
      status: 0,
      error: err instanceof Error ? err.message : 'Timeout',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function probeDirectPublicImageUrl(url: string, timeoutMs = 4000): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'image/*,*/*;q=0.8',
      },
    });
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return undefined;
    }
    const ctype = (res.headers.get('content-type') || '').toLowerCase();
    const len = Number(res.headers.get('content-length') || '0');
    await res.body?.cancel().catch(() => {});
    if (!ctype.startsWith('image/')) return undefined;
    if (len > 0 && len < 150) return undefined;
    return normalizeRemoteImageUrl(res.url || url);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function md5Hex(input: string): string {
  return crypto.createHash('md5').update(input.trim().toLowerCase()).digest('hex');
}

function sha256Hex(input: string): string {
  return crypto.createHash('sha256').update(input.trim().toLowerCase()).digest('hex');
}

function classifyHttpStatus(
  status: number
): 'found' | 'not_found' | 'not_checked' | 'error' {
  if (status >= 200 && status < 300) return 'found';
  if (status === 404 || status === 410) return 'not_found';
  if (status === 0 || status === 403 || status === 429 || status >= 500) return 'not_checked';
  return 'error';
}

function normalizeIsoDate(iso?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

export function formatRelativeTime(iso?: string): string {
  if (!iso) return 'Recently verified';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return 'Active';
  const days = Math.floor(diffMs / 86_400_000);
  if (days < 1) return 'Today';
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

// Known geo coordinate lookup for location strings returned by public profiles
const LOCATION_COORDS: Array<{
  keywords: string[];
  region: string;
  country: string;
  lat: number;
  lng: number;
}> = [
  { keywords: ['san francisco', 'california', 'bay area', 'palo alto', 'mountain view', 'ca'], region: 'California', country: 'United States', lat: 37.77, lng: -122.42 },
  { keywords: ['seattle', 'portland', 'oregon', 'washington'], region: 'Pacific Northwest', country: 'United States', lat: 47.61, lng: -122.33 },
  { keywords: ['new york', 'nyc', 'brooklyn', 'boston', 'east coast'], region: 'New York', country: 'United States', lat: 40.71, lng: -74.01 },
  { keywords: ['austin', 'texas', 'chicago', 'usa', 'united states'], region: 'Central US', country: 'United States', lat: 37.09, lng: -95.71 },
  { keywords: ['toronto', 'vancouver', 'montreal', 'canada'], region: 'Ontario', country: 'Canada', lat: 43.65, lng: -79.38 },
  { keywords: ['london', 'uk', 'united kingdom', 'england', 'manchester'], region: 'London', country: 'United Kingdom', lat: 51.51, lng: -0.13 },
  { keywords: ['berlin', 'munich', 'germany', 'deutschland', 'frankfurt'], region: 'Berlin', country: 'Germany', lat: 52.52, lng: 13.41 },
  { keywords: ['paris', 'france', 'lyon'], region: 'Paris', country: 'France', lat: 48.86, lng: 2.35 },
  { keywords: ['amsterdam', 'netherlands'], region: 'Amsterdam', country: 'Netherlands', lat: 52.37, lng: 4.9 },
  { keywords: ['stockholm', 'sweden', 'helsinki', 'finland', 'oslo', 'norway'], region: 'Nordics', country: 'Northern Europe', lat: 59.33, lng: 18.07 },
  { keywords: ['zurich', 'switzerland'], region: 'Zurich', country: 'Switzerland', lat: 47.37, lng: 8.54 },
  { keywords: ['bengaluru', 'bangalore', 'mumbai', 'delhi', 'new delhi', 'hyderabad', 'india', 'pune', 'chennai', 'kolkata', 'noida', 'gurugram', 'gurgaon', 'ahmedabad', 'jaipur', 'kochi'], region: 'India', country: 'India', lat: 20.59, lng: 78.96 },
  { keywords: ['singapore'], region: 'Singapore', country: 'Singapore', lat: 1.35, lng: 103.82 },
  { keywords: ['tokyo', 'japan', 'osaka'], region: 'Tokyo', country: 'Japan', lat: 35.68, lng: 139.69 },
  { keywords: ['seoul', 'korea'], region: 'Seoul', country: 'South Korea', lat: 37.57, lng: 126.98 },
  { keywords: ['sydney', 'melbourne', 'australia'], region: 'Sydney', country: 'Australia', lat: -33.87, lng: 151.21 },
  { keywords: ['dubai', 'uae'], region: 'Dubai', country: 'UAE', lat: 25.2, lng: 55.27 },
  { keywords: ['sao paulo', 'brazil'], region: 'Sao Paulo', country: 'Brazil', lat: -23.55, lng: -46.63 },
];

function matchLocationToGeo(
  locationText: string | undefined,
  source: string
): GeoMarker | null {
  if (!locationText) return null;
  const low = locationText.toLowerCase();
  const match = LOCATION_COORDS.find((c) =>
    c.keywords.some((kw) => low.includes(kw))
  );
  if (!match) return null;
  return {
    id: `geo-${source.toLowerCase().replace(/\W+/g, '-')}-${match.country.toLowerCase().replace(/\W+/g, '-')}`,
    label: locationText,
    region: match.region,
    country: match.country,
    lat: match.lat,
    lng: match.lng,
    source,
    count: 1,
  };
}

interface GitHubUserApi {
  login: string;
  id: number;
  avatar_url?: string;
  html_url?: string;
  name?: string;
  company?: string;
  blog?: string;
  location?: string;
  email?: string;
  bio?: string;
  type?: string;
  public_repos?: number;
  followers?: number;
  created_at?: string;
  updated_at?: string;
}

interface GitHubRepoApi {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  description?: string;
  language?: string;
  stargazers_count?: number;
  pushed_at?: string;
  created_at?: string;
}

interface GitHubCommitSearchApi {
  total_count: number;
  items: Array<{
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author?: { name?: string; email?: string; date?: string };
      committer?: { name?: string; email?: string; date?: string };
    };
    repository?: { full_name?: string; html_url?: string };
    author?: { login?: string; avatar_url?: string; html_url?: string };
  }>;
}

interface GitHubEventApi {
  id: string;
  type: string;
  repo?: { name?: string };
  created_at?: string;
  payload?: {
    commits?: Array<{
      sha: string;
      message: string;
      author?: { name?: string; email?: string };
    }>;
  };
}

async function runGitHubIntelligence(
  target: string,
  targetType: 'email' | 'username',
  tool: ToolId
): Promise<{
  results: InvestigationResultItem[];
  geo?: GeoMarker | null;
}> {
  const t0 = Date.now();

  if (targetType === 'email') {
    const cleanTargetLower = target.trim().toLowerCase();
    const [
      userSearch,
      commitAuthorSearch,
      commitCommitterSearch,
      issueSearch,
      bioUserSearch,
      unavatarRes,
    ] = await Promise.all([
      fetchJsonSafe<{
        total_count: number;
        items: Array<{ login: string; avatar_url?: string; html_url?: string }>;
      }>(
        `https://api.github.com/search/users?q=${encodeURIComponent(target)}+in:email&per_page=3`
      ),
      fetchJsonSafe<GitHubCommitSearchApi>(
        `https://api.github.com/search/commits?q=author-email:${encodeURIComponent(target)}&sort=author-date&order=desc&per_page=20`,
        6500,
        { Accept: 'application/vnd.github+json' }
      ),
      fetchJsonSafe<GitHubCommitSearchApi>(
        `https://api.github.com/search/commits?q=committer-email:${encodeURIComponent(target)}&sort=committer-date&order=desc&per_page=15`,
        6500,
        { Accept: 'application/vnd.github+json' }
      ),
      fetchJsonSafe<{
        total_count: number;
        items: Array<{
          id: number;
          number: number;
          title: string;
          body?: string;
          html_url: string;
          created_at?: string;
          repository_url?: string;
          user?: { login?: string; avatar_url?: string; html_url?: string };
        }>;
      }>(
        `https://api.github.com/search/issues?q=${encodeURIComponent(`"${target}"`)}&per_page=8`,
        6000,
        { Accept: 'application/vnd.github+json' }
      ),
      fetchJsonSafe<{
        total_count: number;
        items: Array<{ login: string; avatar_url?: string; html_url?: string }>;
      }>(
        `https://api.github.com/search/users?q=${encodeURIComponent(`"${target}"`)}&per_page=3`
      ),
      fetchJsonSafe<{ url?: string }>(
        `https://unavatar.io/${encodeURIComponent(cleanTargetLower)}?json&fallback=false`,
        6500
      ),
    ]);

    const seenShas = new Set<string>();
    const rawCommits = [
      ...(commitAuthorSearch.data?.items || []),
      ...(commitCommitterSearch.data?.items || []),
    ].filter((c) => {
      if (!c?.sha || seenShas.has(c.sha)) return false;
      seenShas.add(c.sha);
      return true;
    });

    const exactEmailCommits = rawCommits.filter((c) => {
      const aEmail = c.commit.author?.email?.trim().toLowerCase();
      const cEmail = c.commit.committer?.email?.trim().toLowerCase();
      return aEmail === cleanTargetLower || cEmail === cleanTargetLower;
    });

    const exactIssues = (issueSearch.data?.items || []).filter((iss) => {
      const hay = `${iss.title || ''} ${iss.body || ''}`.toLowerCase();
      return hay.includes(cleanTargetLower);
    });

    const userSearchLogin = userSearch.data?.items?.[0]?.login;
    const bioSearchLogin = bioUserSearch.data?.items?.[0]?.login;
    const commitLogin = exactEmailCommits.find((c) => c.author?.login)?.author?.login;

    // Reverse GitHub UID resolution when Unavatar resolves an email -> avatars.githubusercontent.com/u/<uid>
    const unavatarUrl = unavatarRes.data?.url || '';
    const unavatarUidMatch = unavatarUrl.match(/avatars\.githubusercontent\.com\/u\/(\d+)/i);
    let unavatarGithubProfile: GitHubUserApi | undefined;
    if (unavatarUidMatch?.[1] && !userSearchLogin && !commitLogin) {
      const uidRes = await fetchJsonSafe<GitHubUserApi>(
        `https://api.github.com/user/${unavatarUidMatch[1]}`,
        6000
      );
      if (uidRes.ok && uidRes.data?.login) {
        unavatarGithubProfile = uidRes.data;
      }
    }

    let matchedLogin =
      userSearchLogin || commitLogin || unavatarGithubProfile?.login || bioSearchLogin;

    let userProfile: GitHubUserApi | undefined;
    let userRepos: GitHubRepoApi[] = [];

    if (matchedLogin) {
      const [profileRes, reposRes] = await Promise.all([
        unavatarGithubProfile && unavatarGithubProfile.login === matchedLogin
          ? Promise.resolve({ ok: true, status: 200, data: unavatarGithubProfile })
          : fetchJsonSafe<GitHubUserApi>(
              `https://api.github.com/users/${encodeURIComponent(matchedLogin)}`
            ),
        fetchJsonSafe<GitHubRepoApi[]>(
          `https://api.github.com/users/${encodeURIComponent(matchedLogin)}/repos?sort=pushed&per_page=10`
        ),
      ]);
      if (profileRes.ok && profileRes.data) {
        const profEmail = profileRes.data.email?.trim().toLowerCase();
        const bioHasExactEmail = Boolean(
          profileRes.data.bio?.toLowerCase().includes(cleanTargetLower) ||
          profileRes.data.blog?.toLowerCase().includes(cleanTargetLower)
        );
        const unavatarVerified = Boolean(
          unavatarGithubProfile && unavatarGithubProfile.login === matchedLogin
        );
        // Reject unverified user search hits unless email matches profile email, bio, exact commits, or Unavatar GitHub UID
        if (
          !commitLogin &&
          !bioHasExactEmail &&
          !unavatarVerified &&
          ((!userSearchLogin && Boolean(bioSearchLogin)) ||
            (profEmail && profEmail !== cleanTargetLower))
        ) {
          matchedLogin = undefined;
        } else {
          userProfile = profileRes.data;
        }
      }
      if (matchedLogin && reposRes.ok && Array.isArray(reposRes.data)) {
        userRepos = reposRes.data;
      }
    }

    const commitItems: ArtifactItem[] = exactEmailCommits.map(
      (c) => {
        const repoName = c.repository?.full_name || 'unknown/repo';
        const firstLine = (c.commit.message || '').split('\n')[0];
        return {
          id: `commit-${c.sha}`,
          type: 'commit',
          title: firstLine || c.sha.slice(0, 7),
          subtitle: `${repoName} · ${c.sha.slice(0, 7)}`,
          repository: repoName,
          sha: c.sha,
          authorName: c.commit.author?.name,
          authorEmail: c.commit.author?.email || c.commit.committer?.email,
          timestamp: normalizeIsoDate(c.commit.author?.date || c.commit.committer?.date),
          url: c.html_url,
          summary: c.commit.message,
          details: {
            sha: c.sha,
            repository: repoName,
            authorName: c.commit.author?.name,
            authorEmail: c.commit.author?.email,
            committerEmail: c.commit.committer?.email,
            date: c.commit.author?.date,
            fullMessage: c.commit.message,
          },
        };
      }
    );

    const issueArtifacts: ArtifactItem[] = exactIssues.map((iss) => {
      const repoSlug =
        iss.repository_url?.replace('https://api.github.com/repos/', '') ||
        'GitHub';
      return {
        id: `gh-issue-${iss.id}`,
        type: 'profile_signal' as const,
        title: iss.title,
        subtitle: `${repoSlug} #${iss.number}${iss.user?.login ? ` · @${iss.user.login}` : ''}`,
        repository: repoSlug,
        timestamp: normalizeIsoDate(iss.created_at),
        url: iss.html_url,
        summary: (iss.body || '').replace(/\s+/g, ' ').trim().slice(0, 200),
        details: {
          issueNumber: iss.number,
          author: iss.user?.login || null,
          repository: repoSlug,
        },
      };
    });

    const repoItems: ArtifactItem[] = userRepos.map((r) => ({
      id: `repo-${r.id}`,
      type: 'repository',
      title: r.full_name,
      subtitle: r.language || 'Repository',
      repository: r.full_name,
      timestamp: normalizeIsoDate(r.pushed_at || r.created_at),
      url: r.html_url,
      summary: r.description || 'Public GitHub repository',
      details: {
        stars: r.stargazers_count ?? 0,
        language: r.language || 'Unknown',
        createdAt: r.created_at,
        pushedAt: r.pushed_at,
      },
    }));

    const hasMatches = Boolean(
      userProfile || commitItems.length > 0 || issueArtifacts.length > 0
    );
    const rateLimited =
      userSearch.status === 403 ||
      userSearch.status === 429 ||
      commitAuthorSearch.status === 403 ||
      commitAuthorSearch.status === 429;

    if (!hasMatches && rateLimited) {
      return {
        results: [
          {
            id: `${tool}-github`,
            platform: 'GitHub',
            category: 'Developer & Code',
            tool,
            status: 'not_checked',
            findingKind: 'registered',
            summary: 'GitHub public search API rate limit reached.',
            durationMs: Date.now() - t0,
          },
        ],
      };
    }

    const commitDates = commitItems
      .map((c) => c.timestamp)
      .filter((d): d is string => Boolean(d))
      .sort();
    const firstSeen =
      normalizeIsoDate(userProfile?.created_at) || commitDates[0];
    const lastSeen =
      commitDates[commitDates.length - 1] ||
      normalizeIsoDate(userProfile?.updated_at);

    const results: InvestigationResultItem[] = [];
    const totalCommitsIndexed =
      exactEmailCommits.length > 0 && exactEmailCommits.length < rawCommits.length
        ? exactEmailCommits.length
        : exactEmailCommits.length > 0
        ? Math.max(
            commitItems.length,
            (commitAuthorSearch.data?.total_count ?? 0) +
              (commitCommitterSearch.data?.total_count ?? 0)
          )
        : 0;
    const ghDisplayFields = [
      userProfile?.id ? { label: 'ID', value: String(userProfile.id), copyable: true } : null,
      (userProfile?.login || matchedLogin)
        ? { label: 'Username', value: String(userProfile?.login || matchedLogin), copyable: true }
        : null,
      userProfile?.name ? { label: 'Name', value: userProfile.name, copyable: true } : null,
      commitItems.length > 0
        ? { label: 'Exposed Email', value: target, kind: 'email' as const, copyable: true }
        : null,
      issueArtifacts.length > 0
        ? { label: 'Issue / PR Citations', value: String(issueArtifacts.length) }
        : null,
      userProfile?.location ? { label: 'Location', value: userProfile.location, copyable: true } : null,
      firstSeen
        ? { label: 'Joined At', value: firstSeen.slice(0, 10), kind: 'date' as const }
        : null,
    ].filter((v): v is NonNullable<typeof v> => Boolean(v));

    results.push({
      id: `${tool}-github`,
      platform: 'GitHub',
      domain: 'github.com',
      category: 'Developer & Code',
      tool,
      status: hasMatches ? 'found' : 'not_found',
      findingKind: 'registered',
      handle:
        userProfile?.login ||
        matchedLogin ||
        (commitItems.length > 0 || issueArtifacts.length > 0 ? target : undefined),
      displayName:
        userProfile?.name ||
        userProfile?.login ||
        matchedLogin ||
        (commitItems.length > 0
          ? commitItems[0].authorName || target
          : issueArtifacts.length > 0
          ? target
          : undefined),
      accountType: userProfile?.type || (hasMatches ? 'Developer Account' : undefined),
      avatarUrl:
        normalizeRemoteImageUrl(
          userProfile?.avatar_url ||
            userSearch.data?.items?.[0]?.avatar_url ||
            exactEmailCommits.find((i) => i.author?.avatar_url)?.author?.avatar_url ||
            (matchedLogin
              ? `https://avatars.githubusercontent.com/${encodeURIComponent(matchedLogin)}?s=256`
              : undefined),
          'https://github.com'
        ),
      firstSeen,
      lastSeen,
      relativeTime: formatRelativeTime(lastSeen || firstSeen),
      linkedInfo: [
        userProfile?.location,
        userProfile?.company,
        commitItems.length > 0 ? `${totalCommitsIndexed} Commits (Expand to inspect)` : undefined,
        issueArtifacts.length > 0 ? `${issueArtifacts.length} Exact Issue/PR Citation(s)` : undefined,
        repoItems.length > 0 ? `${repoItems.length} Public Repos` : undefined,
      ].filter((v): v is string => Boolean(v)),
      displayFields: ghDisplayFields,
      statsLine: hasMatches
        ? `Repos ${userProfile?.public_repos ?? repoItems.length} · Followers ${userProfile?.followers ?? 0} · Commits ${totalCommitsIndexed}${issueArtifacts.length > 0 ? ` · Issues ${issueArtifacts.length}` : ''}`
        : undefined,
      url:
        userProfile?.html_url ||
        (matchedLogin
          ? `https://github.com/${matchedLogin}`
          : commitItems[0]?.url || issueArtifacts[0]?.url),
      summary: hasMatches
        ? `${userProfile?.name || matchedLogin || 'Developer'} · ${totalCommitsIndexed} commit(s), ${userProfile?.public_repos ?? repoItems.length} repos${issueArtifacts.length > 0 ? `, ${issueArtifacts.length} exact issue citation(s)` : ''}`
        : 'No public GitHub account, commit, or issue matches found.',
      durationMs: Date.now() - t0,
      artifacts: [...commitItems, ...issueArtifacts, ...repoItems],
      details: {
        id: userProfile?.id,
        login: userProfile?.login || matchedLogin,
        name: userProfile?.name,
        bio: userProfile?.bio,
        location: userProfile?.location,
        company: userProfile?.company,
        followers: userProfile?.followers,
        publicRepos: userProfile?.public_repos,
        exposedCommitEmail: commitItems.length > 0 ? target : undefined,
        totalCommitsIndexed,
        issueCitationsCount: issueArtifacts.length,
        createdAt: userProfile?.created_at,
        updatedAt: userProfile?.updated_at,
      },
    });

    const normalizedUnavatar = normalizeRemoteImageUrl(unavatarUrl);
    if (
      normalizedUnavatar &&
      (!userProfile?.avatar_url || !normalizedUnavatar.includes('avatars.githubusercontent.com'))
    ) {
      results.push({
        id: `${tool}-unavatar-avatar`,
        platform: 'Public Avatar Index (Unavatar)',
        domain: 'unavatar.io',
        category: 'Email & Domain',
        tool,
        status: 'found',
        findingKind: 'registered',
        handle: cleanTargetLower,
        displayName: cleanTargetLower,
        accountType: 'Cross-Network Public Avatar',
        avatarUrl: normalizedUnavatar,
        relativeTime: 'Active image',
        displayFields: [
          { label: 'Email', value: cleanTargetLower, kind: 'email', copyable: true },
          { label: 'Image Source', value: normalizedUnavatar, kind: 'url', copyable: true },
        ],
        url: normalizedUnavatar,
        summary: `Resolved a verified public profile picture for ${cleanTargetLower} via Unavatar cross-network index.`,
        durationMs: Date.now() - t0,
        details: { email: cleanTargetLower, imageUrl: normalizedUnavatar },
      });
    }

    return {
      results,
      geo: matchLocationToGeo(userProfile?.location, 'GitHub Profile'),
    };
  }

  // Username lookup
  const cleanHandle = target.replace(/^@/, '').trim();
  const profileRes = await fetchJsonSafe<GitHubUserApi>(
    `https://api.github.com/users/${encodeURIComponent(cleanHandle)}`
  );

  if (!profileRes.ok || !profileRes.data) {
    if (profileRes.status !== 404) {
      const htmlFallback = await fetchHtmlProfileSafe(
        `https://github.com/${encodeURIComponent(cleanHandle)}`,
        5000
      );
      if (htmlFallback.status >= 200 && htmlFallback.status < 300) {
        const meta = extractHtmlProfileMeta(htmlFallback.html);
        const profileUrl = `https://github.com/${cleanHandle}`;
        const displayName =
          meta.ogTitle?.replace(/\s*\(@?[^)]+\).*$/, '').trim() ||
          meta.title?.replace(/\s*·\s*GitHub.*$/i, '').trim() ||
          cleanHandle;
        return {
          results: [
            {
              id: `${tool}-github`,
              platform: 'GitHub',
              domain: 'github.com',
              category: 'Developer & Code',
              tool,
              status: 'found',
              findingKind: 'registered',
              handle: cleanHandle,
              displayName,
              accountType: 'Public Profile',
              avatarUrl:
                normalizeRemoteImageUrl(meta.ogImage, profileUrl) ||
                `https://avatars.githubusercontent.com/${encodeURIComponent(cleanHandle)}?s=256`,
              relativeTime: 'Verified profile',
              url: profileUrl,
              displayFields: [
                { label: 'Username', value: cleanHandle, copyable: true },
                ...(displayName !== cleanHandle
                  ? [{ label: 'Name', value: displayName, copyable: true }]
                  : []),
                { label: 'Profile URL', value: profileUrl, kind: 'url', copyable: true },
              ],
              summary:
                meta.ogDesc?.slice(0, 220) ||
                `Verified public GitHub profile @${cleanHandle} (HTML fallback).`,
              durationMs: Date.now() - t0,
              details: {
                login: cleanHandle,
                name: displayName,
                htmlUrl: profileUrl,
                fallbackMode: 'html',
                apiStatus: profileRes.status,
              },
            },
          ],
        };
      }
      if (htmlFallback.status === 404) {
        return {
          results: [
            {
              id: `${tool}-github`,
              platform: 'GitHub',
              domain: 'github.com',
              category: 'Developer & Code',
              tool,
              status: 'not_found',
              findingKind: 'registered',
              handle: cleanHandle,
              summary: `Username @${cleanHandle} not registered on GitHub.`,
              durationMs: Date.now() - t0,
            },
          ],
        };
      }
    }

    const status = classifyHttpStatus(profileRes.status);
    return {
      results: [
        {
          id: `${tool}-github`,
          platform: 'GitHub',
          domain: 'github.com',
          category: 'Developer & Code',
          tool,
          status,
          findingKind: 'registered',
          handle: cleanHandle,
          summary:
            status === 'not_found'
              ? `Username @${cleanHandle} not registered on GitHub.`
              : 'GitHub lookup rate-limited or unavailable.',
          durationMs: Date.now() - t0,
        },
      ],
    };
  }

  const user = profileRes.data;
  const [reposRes, eventsRes] = await Promise.all([
    fetchJsonSafe<GitHubRepoApi[]>(
      `https://api.github.com/users/${encodeURIComponent(cleanHandle)}/repos?sort=pushed&per_page=10`
    ),
    fetchJsonSafe<GitHubEventApi[]>(
      `https://api.github.com/users/${encodeURIComponent(cleanHandle)}/events/public?per_page=15`
    ),
  ]);

  const commitArtifacts: ArtifactItem[] = [];
  if (eventsRes.ok && Array.isArray(eventsRes.data)) {
    for (const ev of eventsRes.data) {
      if (ev.type === 'PushEvent' && ev.payload?.commits) {
        const repoName = ev.repo?.name || 'unknown/repo';
        for (const c of ev.payload.commits) {
          commitArtifacts.push({
            id: `commit-${c.sha}`,
            type: 'commit',
            title: (c.message || '').split('\n')[0] || c.sha.slice(0, 7),
            subtitle: `${repoName} · ${c.sha.slice(0, 7)}`,
            repository: repoName,
            sha: c.sha,
            authorName: c.author?.name,
            authorEmail: c.author?.email,
            timestamp: normalizeIsoDate(ev.created_at),
            url: `https://github.com/${repoName}/commit/${c.sha}`,
            summary: c.message,
            details: {
              sha: c.sha,
              repository: repoName,
              authorName: c.author?.name,
              authorEmail: c.author?.email,
              date: ev.created_at,
              fullMessage: c.message,
            },
          });
        }
      }
    }
  }

  const repoArtifacts: ArtifactItem[] = (
    reposRes.ok && Array.isArray(reposRes.data) ? reposRes.data : []
  ).map((r) => ({
    id: `repo-${r.id}`,
    type: 'repository',
    title: r.full_name,
    subtitle: r.language || 'Repository',
    repository: r.full_name,
    timestamp: normalizeIsoDate(r.pushed_at || r.created_at),
    url: r.html_url,
    summary: r.description || 'Public GitHub repository',
    details: {
      stars: r.stargazers_count ?? 0,
      language: r.language || 'Unknown',
      createdAt: r.created_at,
      pushedAt: r.pushed_at,
    },
  }));

  const firstSeen = normalizeIsoDate(user.created_at);
  const lastSeen = normalizeIsoDate(user.updated_at);

  const leakedEmails = Array.from(
    new Set(
      [
        user.email,
        ...commitArtifacts
          .map((c) => c.authorEmail)
          .filter(
            (e): e is string =>
              Boolean(e) && !e!.endsWith('users.noreply.github.com')
          ),
      ].filter((v): v is string => Boolean(v))
    )
  );

  const ghUserDisplayFields = [
    { label: 'ID', value: String(user.id), copyable: true },
    { label: 'Username', value: user.login, copyable: true },
    user.name ? { label: 'Name', value: user.name, copyable: true } : null,
    leakedEmails[0]
      ? { label: 'Exposed Email', value: leakedEmails[0], kind: 'email' as const, copyable: true }
      : null,
    user.location ? { label: 'Location', value: user.location, copyable: true } : null,
    firstSeen ? { label: 'Joined At', value: firstSeen.slice(0, 10), kind: 'date' as const } : null,
  ].filter((v): v is NonNullable<typeof v> => Boolean(v));

  const results: InvestigationResultItem[] = [
    {
      id: `${tool}-github`,
      platform: 'GitHub',
      domain: 'github.com',
      category: 'Developer & Code',
      tool,
      status: 'found',
      findingKind: 'registered',
      handle: user.login,
      displayName: user.name || user.login,
      accountType: user.type || 'Developer Account',
      avatarUrl: user.avatar_url,
      firstSeen,
      lastSeen,
      relativeTime: formatRelativeTime(lastSeen),
      linkedInfo: [
        user.location,
        user.company,
        leakedEmails[0],
        `${user.public_repos ?? 0} Public Repos`,
        commitArtifacts.length > 0 ? `${commitArtifacts.length} Commits (Expand to inspect)` : undefined,
      ].filter((v): v is string => Boolean(v)),
      displayFields: ghUserDisplayFields,
      statsLine: `Repos ${user.public_repos ?? 0} · Followers ${user.followers ?? 0} · Commits ${commitArtifacts.length}`,
      url: user.html_url || `https://github.com/${user.login}`,
      summary: `${user.name || user.login} · ${user.public_repos ?? 0} repositories · ${commitArtifacts.length} recent push commits`,
      durationMs: Date.now() - t0,
      artifacts: [...commitArtifacts, ...repoArtifacts],
      details: {
        id: user.id,
        login: user.login,
        name: user.name,
        bio: user.bio,
        email: user.email,
        exposedEmails: leakedEmails,
        location: user.location,
        company: user.company,
        blog: user.blog || undefined,
        followers: user.followers,
        publicRepos: user.public_repos,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
      },
    },
  ];

  return {
    results,
    geo: matchLocationToGeo(user.location, 'GitHub Profile'),
  };
}

export async function fetchLiveGitHubCommitDetail(
  repository: string,
  sha: string
): Promise<Record<string, unknown>> {
  const res = await fetchJsonSafe<{
    sha: string;
    html_url: string;
    commit: {
      message: string;
      author?: { name?: string; email?: string; date?: string };
      committer?: { name?: string; email?: string; date?: string };
      verification?: { verified?: boolean; reason?: string };
    };
    stats?: { total?: number; additions?: number; deletions?: number };
    files?: Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      changes: number;
      patch?: string;
    }>;
  }>(
    `https://api.github.com/repos/${repository}/commits/${encodeURIComponent(sha)}`,
    6500,
    { Accept: 'application/vnd.github+json' }
  );

  if (!res.ok || !res.data) {
    return {
      repository,
      sha,
      error: `GitHub commit detail unavailable (HTTP ${res.status}).`,
    };
  }

  return {
    sha: res.data.sha,
    repository,
    url: res.data.html_url,
    message: res.data.commit.message,
    authorName: res.data.commit.author?.name,
    authorEmail: res.data.commit.author?.email,
    authorDate: res.data.commit.author?.date,
    committerName: res.data.commit.committer?.name,
    verified: res.data.commit.verification?.verified ?? false,
    verificationReason: res.data.commit.verification?.reason,
    stats: res.data.stats,
    files: (res.data.files || []).slice(0, 20).map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch ? f.patch.slice(0, 1400) : undefined,
    })),
  };
}

async function runGravatarLookup(
  target: string,
  targetType: 'email' | 'username',
  tool: ToolId
): Promise<{ result: InvestigationResultItem; geo?: GeoMarker | null }> {
  const t0 = Date.now();
  const hash = targetType === 'email' ? md5Hex(target) : undefined;
  const shaHash = targetType === 'email' ? sha256Hex(target) : undefined;
  const cleanHandle = target.replace(/^@/, '').trim();
  const profileUrl = hash
    ? `https://en.gravatar.com/${hash}.json`
    : `https://en.gravatar.com/${encodeURIComponent(cleanHandle)}.json`;

  type GravatarV1Entry = {
    id?: string;
    preferredUsername?: string;
    displayName?: string;
    profileUrl?: string;
    thumbnailUrl?: string;
    photos?: Array<{ value?: string; type?: string }>;
    aboutMe?: string;
    currentLocation?: string;
    job_title?: string;
    company?: string;
    urls?: Array<{ title?: string; value?: string }>;
    accounts?: Array<{
      domain?: string;
      display?: string;
      url?: string;
      username?: string;
      name?: string;
      verified?: boolean;
    }>;
  };

  interface GravatarV3Profile {
    hash?: string;
    display_name?: string;
    profile_url?: string;
    avatar_url?: string;
    description?: string;
    location?: string;
    job_title?: string;
    company?: string;
    verified_accounts?: Array<{
      service_type?: string;
      service_label?: string;
      service_icon?: string;
      url?: string;
      is_hidden?: boolean;
    }>;
    links?: Array<{ label?: string; url?: string }>;
  }

  const [res, v3Res] = await Promise.all([
    fetchJsonSafe<{ entry?: GravatarV1Entry[] }>(profileUrl),
    shaHash
      ? fetchJsonSafe<GravatarV3Profile>(
          `https://api.gravatar.com/v3/profiles/${shaHash}`,
          5000
        )
      : Promise.resolve({ ok: false, status: 0, data: undefined }),
  ]);

  const v3Data = v3Res.ok && v3Res.data?.profile_url ? v3Res.data : undefined;
  let entry: GravatarV1Entry | undefined = res.ok ? res.data?.entry?.[0] : undefined;

  if (!entry && v3Data) {
    const slugMatch = v3Data.profile_url?.match(/gravatar\.com\/([a-zA-Z0-9._-]+)/i)?.[1];
    entry = {
      id: v3Data.hash,
      preferredUsername: slugMatch,
      displayName: v3Data.display_name || slugMatch,
      profileUrl: v3Data.profile_url,
      thumbnailUrl: v3Data.avatar_url,
      aboutMe: v3Data.description,
      currentLocation: v3Data.location,
      job_title: v3Data.job_title,
      company: v3Data.company,
      urls: (v3Data.links || []).map((l) => ({ title: l.label, value: l.url })),
      accounts: (v3Data.verified_accounts || []).map((va) => ({
        domain: va.service_type,
        display: va.service_label,
        name: va.service_label,
        url: va.url,
        verified: true,
      })),
    };
  } else if (entry && v3Data) {
    const slugMatch = v3Data.profile_url?.match(/gravatar\.com\/([a-zA-Z0-9._-]+)/i)?.[1];
    entry = {
      ...entry,
      preferredUsername: entry.preferredUsername || slugMatch,
      displayName: entry.displayName || v3Data.display_name,
      profileUrl: entry.profileUrl || v3Data.profile_url,
      thumbnailUrl: entry.thumbnailUrl || v3Data.avatar_url,
      aboutMe: entry.aboutMe || v3Data.description,
      currentLocation: entry.currentLocation || v3Data.location,
      job_title: entry.job_title || v3Data.job_title,
      company: entry.company || v3Data.company,
      accounts:
        entry.accounts && entry.accounts.length > 0
          ? entry.accounts
          : (v3Data.verified_accounts || []).map((va) => ({
              domain: va.service_type,
              display: va.service_label,
              name: va.service_label,
              url: va.url,
              verified: true,
            })),
    };
  }

  if (entry) {
    const linked = (entry.accounts || [])
      .map((a) =>
        a.name || a.domain
          ? `${a.name || a.domain}${a.username ? ` (${a.username})` : ''}`
          : a.url
      )
      .filter((v): v is string => Boolean(v));

    const rawThumb =
      entry.photos?.find((p) => p.type === 'thumbnail')?.value ||
      entry.photos?.[0]?.value ||
      entry.thumbnailUrl;
    const upgradedThumb = rawThumb
      ? rawThumb.replace(/^http:\/\/([a-z0-9-]+\.)?gravatar\.com\//i, 'https://$1gravatar.com/')
      : undefined;
    const thumbWithSize =
      upgradedThumb && /gravatar\.com\/avatar\//i.test(upgradedThumb) && !/[?&]s=/.test(upgradedThumb)
        ? `${upgradedThumb}${upgradedThumb.includes('?') ? '&' : '?'}s=256`
        : upgradedThumb;
    const avatar =
      normalizeRemoteImageUrl(thumbWithSize) ||
      (hash ? `https://www.gravatar.com/avatar/${hash}?s=256&d=404` : undefined);

    const gravatarArtifacts: ArtifactItem[] = [
      ...(entry.accounts || []).map((acc, idx) => ({
        id: `gravatar-acc-${idx}`,
        type: 'profile_signal' as const,
        title: `${acc.name || acc.domain || 'Linked Account'}${acc.verified ? ' · Verified' : ''}`,
        subtitle: acc.display || acc.username || acc.url || '',
        url: acc.url,
        summary: `Verified Gravatar identity link on ${acc.domain || acc.name || 'external platform'}`,
        details: {
          platform: acc.name || acc.domain,
          username: acc.username,
          display: acc.display,
          verified: Boolean(acc.verified),
          url: acc.url,
        },
      })),
      ...(entry.urls || []).map((u, idx) => ({
        id: `gravatar-url-${idx}`,
        type: 'profile_signal' as const,
        title: u.title || 'Linked Website',
        subtitle: u.value || '',
        url: u.value,
        summary: 'Public website URL listed on Gravatar identity profile',
        details: { title: u.title, url: u.value },
      })),
    ];

    return {
      result: {
        id: `${tool}-gravatar`,
        platform: 'Gravatar',
        domain: 'gravatar.com',
        category: 'Email & Domain',
        tool,
        status: 'found',
        findingKind: 'registered',
        handle: targetType === 'email' ? cleanHandle : (entry.preferredUsername || cleanHandle),
        displayName: entry.displayName || entry.preferredUsername || cleanHandle,
        accountType: 'Global Identity Profile',
        avatarUrl: avatar,
        relativeTime: 'Active identity',
        linkedInfo: [entry.currentLocation, entry.company, entry.job_title, ...linked].filter(
          (v): v is string => Boolean(v)
        ),
        displayFields: [
          entry.id ? { label: 'ID', value: entry.id, copyable: true } : null,
          targetType === 'email'
            ? { label: 'Email', value: cleanHandle, kind: 'email' as const, copyable: true }
            : null,
          entry.preferredUsername
            ? {
                label: targetType === 'email' ? 'Verified Username' : 'Username',
                value: entry.preferredUsername,
                copyable: true,
              }
            : null,
          entry.displayName
            ? { label: 'Display Name', value: entry.displayName, copyable: true }
            : null,
          entry.job_title
            ? { label: 'Role', value: entry.job_title }
            : null,
          entry.company
            ? { label: 'Company', value: entry.company }
            : null,
          entry.currentLocation
            ? { label: 'Location', value: entry.currentLocation, copyable: true }
            : null,
        ].filter((v): v is NonNullable<typeof v> => Boolean(v)),
        statsLine:
          linked.length > 0 ? `Linked Accounts ${linked.length}` : undefined,
        url: entry.profileUrl,
        summary: `${entry.displayName || entry.preferredUsername || 'Gravatar Profile'} · ${linked.length} linked account(s)${entry.aboutMe ? ` · ${entry.aboutMe.slice(0, 90)}` : ''}`,
        durationMs: Date.now() - t0,
        artifacts: gravatarArtifacts.length > 0 ? gravatarArtifacts : undefined,
        details: {
          id: entry.id,
          preferredUsername: entry.preferredUsername,
          displayName: entry.displayName,
          aboutMe: entry.aboutMe,
          jobTitle: entry.job_title,
          company: entry.company,
          location: entry.currentLocation,
          profileUrl: entry.profileUrl,
          linkedAccounts: entry.accounts,
          urls: entry.urls,
        },
      },
      geo: matchLocationToGeo(entry.currentLocation, 'Gravatar Profile'),
    };
  }

  if (!entry && hash && targetType === 'email') {
    const md5AvatarUrl = `https://www.gravatar.com/avatar/${hash}?s=256&d=404`;
    const shaAvatarUrl = shaHash
      ? `https://www.gravatar.com/avatar/${shaHash}?s=256&d=404`
      : undefined;
    const headCheck = await fetchHeadOrGetStatus(md5AvatarUrl, 4000);
    const shaCheck =
      headCheck.status !== 200 && shaAvatarUrl
        ? await fetchHeadOrGetStatus(shaAvatarUrl, 3600)
        : undefined;
    const confirmedAvatar =
      headCheck.status === 200
        ? md5AvatarUrl
        : shaCheck?.status === 200
        ? shaAvatarUrl
        : undefined;
    if (confirmedAvatar) {
      return {
        result: {
          id: `${tool}-gravatar`,
          platform: 'Gravatar',
          domain: 'gravatar.com',
          category: 'Email & Domain',
          tool,
          status: 'found',
          findingKind: 'registered',
          handle: cleanHandle,
          displayName: cleanHandle,
          accountType: 'Gravatar Avatar Image',
          avatarUrl: confirmedAvatar,
          relativeTime: 'Active avatar',
          displayFields: [
            { label: 'Email', value: cleanHandle, kind: 'email', copyable: true },
            { label: 'MD5 Hash', value: hash, copyable: true },
            { label: 'Avatar URL', value: confirmedAvatar, kind: 'url', copyable: true },
          ],
          url: confirmedAvatar,
          summary: `Active Gravatar avatar image confirmed for ${cleanHandle} (MD5 ${hash}).`,
          durationMs: Date.now() - t0,
          details: { md5: hash, avatarUrl: confirmedAvatar, imageOnly: true },
        },
      };
    }
  }

  return {
    result: {
      id: `${tool}-gravatar`,
      platform: 'Gravatar',
      domain: 'gravatar.com',
      category: 'Email & Domain',
      tool,
      status:
        res.status === 404
          ? 'not_found'
          : res.status === 0
          ? 'not_checked'
          : classifyHttpStatus(res.status),
      findingKind: 'registered',
      summary:
        res.status === 404
          ? 'No public Gravatar identity profile linked.'
          : 'Gravatar lookup timed out or was rate-limited.',
      durationMs: Date.now() - t0,
    },
  };
}

const BREACH_DOMAIN_MAP: Record<string, string> = {
  quora: 'quora.com',
  canva: 'canva.com',
  adobe: 'adobe.com',
  linkedin: 'linkedin.com',
  dropbox: 'dropbox.com',
  chegg: 'chegg.com',
  dubsmash: 'dubsmash.com',
  myfitnesspal: 'myfitnesspal.com',
  dailymotion: 'dailymotion.com',
  wattpad: 'wattpad.com',
  mathway: 'mathway.com',
  imgur: 'imgur.com',
  edmodo: 'edmodo.com',
  animoto: 'animoto.com',
  zynga: 'zynga.com',
  zomato: 'zomato.com',
  bigbasket: 'bigbasket.com',
  dominos: 'dominos.co.in',
  dunzo: 'dunzo.com',
  upstox: 'upstox.com',
  airindia: 'airindia.com',
  apollo: 'apollo.io',
  gravatar: 'gravatar.com',
  twitter: 'x.com',
  facebook: 'facebook.com',
  instagram: 'instagram.com',
  deezer: 'deezer.com',
  patreon: 'patreon.com',
  tumblr: 'tumblr.com',
  lastfm: 'last.fm',
  vk: 'vk.com',
  cashcrate: 'cashcrate.com',
  kickstarter: 'kickstarter.com',
  '8tracks': '8tracks.com',
  stockx: 'stockx.com',
  poshmark: 'poshmark.com',
  movieboxpro: 'movieboxpro.app',
  goodreads: 'goodreads.com',
  nitro: 'gonitro.com',
  wattpad2020: 'wattpad.com',
  hautelook: 'hautelook.com',
  myheritage: 'myheritage.com',
  parkmobile: 'parkmobile.io',
  pixlr: 'pixlr.com',
  tokopedia: 'tokopedia.com',
  unacademy: 'unacademy.com',
  vedantu: 'vedantu.com',
  mobikwik: 'mobikwik.com',
  justdial: 'justdial.com',
  zoho: 'zoho.com',
  wix: 'wix.com',
  plex: 'plex.tv',
  replit: 'replit.com',
  render: 'render.com',
  lovable: 'lovable.dev',
  quillbot: 'quillbot.com',
  crazygames: 'crazygames.com',
  chess: 'chess.com',
  notion: 'notion.so',
  figma: 'figma.com',
  atlassian: 'atlassian.com',
  discord: 'discord.com',
  strava: 'strava.com',
  trello: 'trello.com',
  codepen: 'codepen.io',
  eventbrite: 'eventbrite.com',
  paypal: 'paypal.com',
};

function resolveBreachDomain(breachName: string, explicitDomain?: string): string {
  const cleaned = (explicitDomain || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .split('/')[0];
  if (cleaned && cleaned.includes('.')) return cleaned;

  const low = breachName.trim().toLowerCase();
  if (BREACH_DOMAIN_MAP[low]) return BREACH_DOMAIN_MAP[low];

  for (const [key, dom] of Object.entries(BREACH_DOMAIN_MAP)) {
    if (low.includes(key)) return dom;
  }

  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(low)) {
    return low;
  }

  const slug = low.replace(/[^a-z0-9]/g, '');
  return slug ? `${slug}.com` : 'xposedornot.com';
}

async function runPublicBreachLookup(email: string): Promise<{
  breaches: BreachedAccountItem[];
  results: InvestigationResultItem[];
}> {
  const t0 = Date.now();
  const [res, hudsonRes, combRes, leakCheckRes] = await Promise.all([
    fetchJsonSafe<{
      breaches?: string[][];
      ExposedBreaches?: {
        breaches_details?: Array<{
          breach?: string;
          domain?: string;
          industry?: string;
          xposed_date?: string;
          xposed_data?: string;
          details?: string;
        }>;
      };
      Error?: string;
    }>(
      `https://api.xposedornot.com/v1/breach-analytics?email=${encodeURIComponent(email)}`,
      6000
    ),
    fetchJsonSafe<{
      stealers?: Array<{
        total_corporate_services?: number;
        total_user_services?: number;
        date_compromised?: string;
        computer_name?: string;
        operating_system?: string;
        ip?: string;
        malware_path?: string;
        antiviruses?: string[];
      }>;
    }>(
      `https://cavalier.hudsonrock.com/api/json/v2/osint-tools/search-by-email?email=${encodeURIComponent(email)}`,
      5500
    ),
    fetchJsonSafe<{ count?: number; lines?: string[] }>(
      `https://api.proxynova.com/comb?query=${encodeURIComponent(email)}&limit=15`,
      4800
    ),
    fetchJsonSafe<{
      success?: boolean;
      found?: number;
      fields?: string[];
      sources?: Array<{ name?: string; date?: string }>;
      error?: string;
    }>(
      `https://leakcheck.io/api/public?check=${encodeURIComponent(email)}`,
      5500
    ),
  ]);

  const breaches: BreachedAccountItem[] = [];
  const results: InvestigationResultItem[] = [];
  const seenBreachKeys = new Set<string>();
  const normalizeBreachKey = (name: string) =>
    name.trim().toLowerCase().replace(/\W+/g, '');

  const detailsList = res.data?.ExposedBreaches?.breaches_details;
  if (res.ok && Array.isArray(detailsList) && detailsList.length > 0) {
    detailsList.forEach((b, idx) => {
      const name = b.breach || b.domain || `Exposure #${idx + 1}`;
      const domain = resolveBreachDomain(name, b.domain);
      const rawXposed = b.xposed_date?.trim();
      const rawDate = rawXposed
        ? /^\d{4}$/.test(rawXposed)
          ? `${rawXposed}-01-01`
          : /^\d{4}-\d{2}$/.test(rawXposed)
          ? `${rawXposed}-01`
          : rawXposed
        : undefined;
      const iso = normalizeIsoDate(rawDate);
      const dataClasses = (b.xposed_data || '')
        .split(/[;,]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const hasPass = dataClasses.some((d) =>
        /password|hash|token|secret/i.test(d)
      );
      const breachItem: BreachedAccountItem = {
        id: `breach-${name.toLowerCase().replace(/\W+/g, '-')}-${idx}`,
        platform: name,
        breachName: name,
        domain,
        relativeTime: iso ? formatRelativeTime(iso) : b.xposed_date || 'Indexed',
        date: iso || b.xposed_date,
        dataClasses,
        tool: 'mailaccess',
        severity: hasPass ? 'high' : 'medium',
        summary: b.details || `Public breach exposure recorded (${b.industry || 'Online Service'}).`,
        resultId: `mailaccess-breach-${idx}`,
      };
      seenBreachKeys.add(normalizeBreachKey(name));
      breaches.push(breachItem);
      results.push({
        id: `mailaccess-breach-${idx}`,
        platform: breachItem.platform,
        domain: breachItem.domain,
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'breached',
        handle: email,
        displayName: breachItem.breachName,
        accountType: 'Breached Service Record',
        firstSeen: breachItem.date,
        lastSeen: breachItem.date,
        relativeTime: breachItem.relativeTime,
        linkedInfo: breachItem.dataClasses.slice(0, 4),
        displayFields: [
          { label: 'Email', value: email, kind: 'email', copyable: true },
          { label: 'Source Domain', value: breachItem.domain || breachItem.platform, copyable: true },
          { label: 'Exposed Data', value: breachItem.dataClasses.slice(0, 3).join(', ') || 'Email record' },
          { label: 'Breach Date', value: breachItem.date ? breachItem.date.slice(0, 10) : breachItem.relativeTime, kind: 'date' },
        ],
        url: breachItem.domain ? `https://${breachItem.domain}` : undefined,
        summary: `${breachItem.breachName} · Exposed: ${breachItem.dataClasses.slice(0, 3).join(', ') || 'Email record'}`,
        durationMs: Date.now() - t0,
        details: {
          breachName: breachItem.breachName,
          domain: breachItem.domain,
          email,
          severity: breachItem.severity,
          date: breachItem.date,
          dataClasses: breachItem.dataClasses,
          details: breachItem.summary,
        },
      });
    });
  } else {
    // Fallback check via XposedOrNot check-email endpoint if breach-analytics omitted details
    const basicRes = await fetchJsonSafe<{
      breaches?: string[][];
      Error?: string;
    }>(
      `https://api.xposedornot.com/v1/check-email/${encodeURIComponent(email)}`,
      5000
    );

    const rawNames = Array.isArray(basicRes.data?.breaches?.[0])
      ? basicRes.data.breaches[0]
      : [];
    if (basicRes.ok && rawNames.length > 0) {
      rawNames.slice(0, 40).forEach((name, idx) => {
        const domain = resolveBreachDomain(name);
        const breachItem: BreachedAccountItem = {
          id: `breach-${name.toLowerCase().replace(/\W+/g, '-')}-${idx}`,
          platform: name,
          breachName: name,
          domain,
          relativeTime: 'Indexed breach',
          dataClasses: ['Email record'],
          tool: 'mailaccess',
          severity: 'medium',
          summary: `Public breach index match recorded on ${name}.`,
          resultId: `mailaccess-breach-${idx}`,
        };
        seenBreachKeys.add(normalizeBreachKey(name));
        breaches.push(breachItem);
        results.push({
          id: `mailaccess-breach-${idx}`,
          platform: breachItem.platform,
          domain: breachItem.domain,
          category: 'Breach & Exposure',
          tool: 'mailaccess',
          status: 'found',
          findingKind: 'breached',
          handle: email,
          displayName: breachItem.breachName,
          accountType: 'Breached Service Record',
          relativeTime: breachItem.relativeTime,
          linkedInfo: breachItem.dataClasses,
          displayFields: [
            { label: 'Email', value: email, kind: 'email', copyable: true },
            { label: 'Source Domain', value: breachItem.domain || breachItem.platform, copyable: true },
            { label: 'Status', value: 'Breach Indexed' },
          ],
          url: breachItem.domain ? `https://${breachItem.domain}` : undefined,
          summary: `${breachItem.breachName} · Public breach exposure confirmed`,
          durationMs: Date.now() - t0,
          details: { breachName: breachItem.breachName, domain: breachItem.domain, email, source: 'XposedOrNot' },
        });
      });
    }
  }

  // LeakCheck Public API Breach Index (unauthenticated zero-FP exact email check, deduplicated & capped)
  if (
    leakCheckRes.ok &&
    leakCheckRes.data?.success &&
    Array.isArray(leakCheckRes.data.sources) &&
    leakCheckRes.data.sources.length > 0
  ) {
    const exposedFields = Array.isArray(leakCheckRes.data.fields)
      ? leakCheckRes.data.fields.map((f) => String(f).trim()).filter(Boolean)
      : ['Email record'];
    const hasPass = exposedFields.some((f) => /password|hash|token|secret/i.test(f));
    let addedLeakCheck = 0;

    for (let idx = 0; idx < leakCheckRes.data.sources.length && addedLeakCheck < 60; idx++) {
      const src = leakCheckRes.data.sources[idx];
      const name = (src?.name || '').trim();
      if (!name) continue;
      const key = normalizeBreachKey(name);
      if (!key || seenBreachKeys.has(key)) continue;
      seenBreachKeys.add(key);

      const domain = resolveBreachDomain(name);
      const rawDate = src?.date?.trim();
      const normDate = rawDate
        ? /^\d{4}$/.test(rawDate)
          ? `${rawDate}-01-01`
          : /^\d{4}-\d{2}$/.test(rawDate)
          ? `${rawDate}-01`
          : rawDate
        : undefined;
      const iso = normalizeIsoDate(normDate);
      const slug = name.toLowerCase().replace(/\W+/g, '-').slice(0, 32) || String(idx);
      const resultId = `mailaccess-leakcheck-${slug}-${idx}`;

      const breachItem: BreachedAccountItem = {
        id: `breach-leakcheck-${slug}-${idx}`,
        platform: name,
        breachName: name,
        domain,
        relativeTime: iso ? formatRelativeTime(iso) : rawDate || 'Indexed breach',
        date: iso || rawDate,
        dataClasses: exposedFields.length > 0 ? exposedFields : ['Email record'],
        tool: 'mailaccess',
        severity: hasPass ? 'high' : 'medium',
        summary: `LeakCheck verified public breach exposure referencing ${email} (${name}).`,
        resultId,
      };
      breaches.push(breachItem);
      results.push({
        id: resultId,
        platform: breachItem.platform,
        domain: breachItem.domain,
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'breached',
        handle: email,
        displayName: breachItem.breachName,
        accountType: 'Breached Service Record',
        firstSeen: breachItem.date,
        lastSeen: breachItem.date,
        relativeTime: breachItem.relativeTime,
        linkedInfo: breachItem.dataClasses.slice(0, 4),
        displayFields: [
          { label: 'Email', value: email, kind: 'email', copyable: true },
          { label: 'Source Domain', value: breachItem.domain || breachItem.platform, copyable: true },
          { label: 'Exposed Data', value: breachItem.dataClasses.slice(0, 3).join(', ') || 'Email record' },
          ...(breachItem.date
            ? [{ label: 'Breach Date', value: breachItem.date.slice(0, 10), kind: 'date' as const }]
            : []),
        ],
        url: breachItem.domain ? `https://${breachItem.domain}` : undefined,
        summary: `${breachItem.breachName} · LeakCheck confirmed exposure (${breachItem.dataClasses.slice(0, 3).join(', ') || 'Email'})`,
        durationMs: Date.now() - t0,
        details: {
          breachName: breachItem.breachName,
          domain: breachItem.domain,
          email,
          severity: breachItem.severity,
          date: breachItem.date,
          dataClasses: breachItem.dataClasses,
          totalLeakCheckRecords: leakCheckRes.data.found,
          source: 'LeakCheck Public API',
        },
      });
      addedLeakCheck += 1;
    }
  }

  // HudsonRock Cavalier Infostealer Log Check (strict email lookup)
  const stealers = hudsonRes.ok && Array.isArray(hudsonRes.data?.stealers)
    ? hudsonRes.data.stealers
    : [];
  if (stealers.length > 0) {
    stealers.slice(0, 8).forEach((s, idx) => {
      const isoDate = normalizeIsoDate(s.date_compromised);
      const resultId = `mailaccess-hudsonrock-${idx}`;
      const breachItem: BreachedAccountItem = {
        id: `breach-hudsonrock-${idx}`,
        platform: 'HudsonRock Infostealer Intel',
        breachName: `Infostealer Log (${s.operating_system || 'Host'})`,
        domain: 'hudsonrock.com',
        relativeTime: isoDate ? formatRelativeTime(isoDate) : 'Infostealer Index',
        date: isoDate || s.date_compromised,
        dataClasses: [
          'Infostealer Log',
          ...(s.operating_system ? [s.operating_system] : []),
          ...(typeof s.total_user_services === 'number'
            ? [`${s.total_user_services} User Services`]
            : []),
        ],
        tool: 'mailaccess',
        severity: 'high',
        summary: `HudsonRock Cavalier detected infostealer compromise referencing ${email}.`,
        resultId,
      };
      breaches.push(breachItem);
      results.push({
        id: resultId,
        platform: 'HudsonRock Infostealer Intel',
        domain: 'hudsonrock.com',
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: email,
        displayName: breachItem.breachName,
        accountType: 'Infostealer Telemetry',
        firstSeen: breachItem.date,
        lastSeen: breachItem.date,
        relativeTime: breachItem.relativeTime,
        linkedInfo: breachItem.dataClasses,
        displayFields: [
          { label: 'Email', value: email, kind: 'email', copyable: true },
          ...(s.computer_name ? [{ label: 'Compromised Host', value: s.computer_name, copyable: true }] : []),
          ...(s.operating_system ? [{ label: 'OS', value: s.operating_system }] : []),
          ...(breachItem.date
            ? [{ label: 'Compromised At', value: breachItem.date.slice(0, 10), kind: 'date' as const }]
            : []),
        ],
        url: 'https://www.hudsonrock.com/threat-intelligence-cybercrime-tools',
        summary: breachItem.summary,
        durationMs: Date.now() - t0,
        details: { ...s, email, source: 'HudsonRock Cavalier' },
      });
    });
  }

  // ProxyNova COMB Credential Compilation Check (strict exact email: prefix match; never expose plaintext secrets)
  const cleanEmailLower = email.trim().toLowerCase();
  const exactCombMatches =
    combRes.ok && Array.isArray(combRes.data?.lines)
      ? combRes.data.lines.filter((line) =>
          typeof line === 'string' && line.toLowerCase().startsWith(`${cleanEmailLower}:`)
        )
      : [];
  if (exactCombMatches.length > 0) {
    const resultId = 'mailaccess-comb-breach';
    const breachItem: BreachedAccountItem = {
      id: 'breach-proxynova-comb',
      platform: 'COMB Credential Compilation',
      breachName: 'COMB (Compilation of Many Breaches)',
      domain: 'proxynova.com',
      relativeTime: 'Historical Dump',
      date: '2021-02-02T00:00:00.000Z',
      dataClasses: ['Email address', 'Password exposure (redacted)'],
      tool: 'mailaccess',
      severity: 'high',
      summary: `Exact email match indexed across ${exactCombMatches.length} historical COMB leak record(s) (passwords redacted).`,
      resultId,
    };
    breaches.push(breachItem);
    results.push({
      id: resultId,
      platform: breachItem.platform,
      domain: breachItem.domain,
      category: 'Breach & Exposure',
      tool: 'mailaccess',
      status: 'found',
      findingKind: 'breached',
      handle: email,
      displayName: breachItem.breachName,
      accountType: 'Breached Credential Record',
      firstSeen: breachItem.date,
      lastSeen: breachItem.date,
      relativeTime: breachItem.relativeTime,
      linkedInfo: [`${exactCombMatches.length} Exact Record(s)`, 'Credential Exposure'],
      displayFields: [
        { label: 'Email', value: email, kind: 'email', copyable: true },
        { label: 'Dataset', value: 'COMB (3.2B Compilation)' },
        { label: 'Exact Records', value: String(exactCombMatches.length) },
      ],
      url: 'https://www.proxynova.com/tools/comb/',
      summary: breachItem.summary,
      durationMs: Date.now() - t0,
      details: {
        email,
        exactRecordCount: exactCombMatches.length,
        source: 'ProxyNova COMB',
        passwordsRedacted: true,
      },
    });
  }

  return { breaches, results };
}

interface ThreatIntelSummary {
  feedsChecked: string[];
  urlhausHits: number;
  urlhausUrls: string[];
  urlhausBlacklists: string[];
  threatfoxHits: number;
  threatfoxMalware: string[];
  ransomwareHits: number;
  ransomwareVictims: Array<{ victim?: string; group?: string; published?: string }>;
  feodoHits: number;
  feodoEntries: Array<{ port?: number; status?: string; malware?: string; lastOnline?: string }>;
  otxPulses: number;
  otxPulseNames: string[];
  totalHits: number;
}

interface FeodoIpEntry {
  ip_address?: string;
  port?: number;
  status?: string;
  hostname?: string | null;
  as_number?: number;
  as_name?: string;
  country?: string;
  first_seen?: string;
  last_online?: string;
  malware?: string;
}

let feodoCache: { fetchedAt: number; byIp: Map<string, FeodoIpEntry[]> } | null = null;
const FEODO_CACHE_TTL_MS = 10 * 60 * 1000;

async function lookupFeodoTracker(ip: string): Promise<FeodoIpEntry[]> {
  const now = Date.now();
  if (feodoCache && now - feodoCache.fetchedAt < FEODO_CACHE_TTL_MS) {
    return feodoCache.byIp.get(ip) || [];
  }
  try {
    const res = await fetchJsonSafe<FeodoIpEntry[]>(
      'https://feodotracker.abuse.ch/downloads/ipblocklist_recommended.json',
      3500
    );
    if (!res.ok || !Array.isArray(res.data)) {
      return feodoCache?.byIp.get(ip) || [];
    }
    const byIp = new Map<string, FeodoIpEntry[]>();
    for (const entry of res.data) {
      const addr = entry.ip_address?.trim();
      if (!addr) continue;
      const list = byIp.get(addr) || [];
      list.push(entry);
      byIp.set(addr, list);
    }
    feodoCache = { fetchedAt: now, byIp };
    return byIp.get(ip) || [];
  } catch {
    return [];
  }
}

async function runLiveThreatIntelChecks(
  indicator: string,
  kind: 'domain' | 'ip'
): Promise<{
  summary: ThreatIntelSummary;
  resultItem: InvestigationResultItem;
}> {
  const t0 = Date.now();
  const clean = indicator.trim().toLowerCase();

  const urlhausPromise = (async () => {
    try {
      const body = new URLSearchParams({ host: clean });
      const res = await fetch('https://urlhaus-api.abuse.ch/v1/host/', {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
        signal: AbortSignal.timeout(3200),
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        query_status?: string;
        urls_online?: number;
        url_count?: number;
        blacklists?: Record<string, string>;
        urls?: Array<{ url?: string; threat?: string; url_status?: string; tags?: string[] }>;
      };
    } catch {
      return null;
    }
  })();

  const threatfoxPromise = (async () => {
    try {
      const res = await fetch('https://threatfox-api.abuse.ch/api/v1/', {
        method: 'POST',
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: 'search_ioc', search_term: clean }),
        signal: AbortSignal.timeout(3200),
      });
      if (!res.ok) return null;
      return (await res.json()) as {
        query_status?: string;
        data?: Array<{
          ioc?: string;
          threat_type?: string;
          malware_printable?: string;
          confidence_level?: number;
        }>;
      };
    } catch {
      return null;
    }
  })();

  const ransomwarePromise = (async () => {
    if (kind !== 'domain') return null;
    try {
      const rootLabel = clean.split('.')[0];
      const queryTerm = rootLabel && rootLabel.length >= 4 ? clean : clean;
      const res = await fetchJsonSafe<
        Array<{
          victim?: string;
          group?: string;
          published?: string;
          website?: string;
        }>
      >(
        `https://api.ransomware.live/v2/searchvictims/${encodeURIComponent(queryTerm)}`,
        3200
      );
      if (!res.ok || !Array.isArray(res.data)) return [];
      return res.data.filter((v) => {
        const w = (v.website || '').toLowerCase();
        const vic = (v.victim || '').toLowerCase();
        return w.includes(clean) || vic.includes(clean);
      });
    } catch {
      return null;
    }
  })();

  const feodoPromise =
    kind === 'ip' ? lookupFeodoTracker(clean) : Promise.resolve<FeodoIpEntry[]>([]);

  const otxPromise = (async () => {
    try {
      const section = kind === 'ip' ? 'IPv4' : 'domain';
      const res = await fetchJsonSafe<{
        pulse_info?: {
          count?: number;
          pulses?: Array<{ name?: string; tags?: string[] }>;
        };
        validation?: Array<{ source?: string; message?: string; name?: string }>;
      }>(
        `https://otx.alienvault.com/api/v1/indicators/${section}/${encodeURIComponent(clean)}/general`,
        3200
      );
      if (!res.ok || !res.data) return null;
      return res.data;
    } catch {
      return null;
    }
  })();

  const [urlhaus, threatfox, ransomware, feodoList, otx] = await Promise.all([
    urlhausPromise,
    threatfoxPromise,
    ransomwarePromise,
    feodoPromise,
    otxPromise,
  ]);

  const urlhausList =
    urlhaus?.query_status === 'ok' && Array.isArray(urlhaus.urls)
      ? urlhaus.urls
      : [];
  const urlhausBlacklists = Object.entries(urlhaus?.blacklists || {})
    .filter(([, val]) => val && val !== 'not listed')
    .map(([k, v]) => `${k}: ${v}`);

  const threatfoxList =
    threatfox?.query_status === 'ok' && Array.isArray(threatfox.data)
      ? threatfox.data
      : [];
  const threatfoxMalware = Array.from(
    new Set(
      threatfoxList
        .map((d) => d.malware_printable || d.threat_type)
        .filter((v): v is string => Boolean(v))
    )
  ).slice(0, 6);

  const ransomwareList = Array.isArray(ransomware) ? ransomware.slice(0, 6) : [];
  const feodoEntries = feodoList.slice(0, 5).map((e) => ({
    port: e.port,
    status: e.status,
    malware: e.malware,
    lastOnline: e.last_online,
  }));

  const isOtxWhitelisted = Boolean(
    otx?.validation?.some((v) =>
      /whitelist|false.?positive|majestic|cisco|akamai|cloudflare/i.test(
        `${v.source || ''} ${v.name || ''} ${v.message || ''}`
      )
    )
  );
  const rawOtxCount = Number(otx?.pulse_info?.count || 0);
  const otxPulses = isOtxWhitelisted ? 0 : rawOtxCount;
  const otxPulseNames =
    otxPulses > 0 && Array.isArray(otx?.pulse_info?.pulses)
      ? otx.pulse_info.pulses
          .map((p) => p.name)
          .filter((v): v is string => Boolean(v))
          .slice(0, 5)
      : [];

  const totalHits =
    urlhausList.length +
    urlhausBlacklists.length +
    threatfoxList.length +
    ransomwareList.length +
    feodoEntries.length +
    (otxPulses > 0 ? otxPulses : 0);

  const feedsChecked =
    kind === 'domain'
      ? [
          'Abuse.ch URLhaus',
          'Abuse.ch ThreatFox',
          'Ransomware.live',
          'AlienVault OTX',
        ]
      : [
          'Abuse.ch URLhaus',
          'Abuse.ch ThreatFox',
          'Feodo Tracker',
          'AlienVault OTX',
        ];

  const summary: ThreatIntelSummary = {
    feedsChecked,
    urlhausHits: urlhausList.length,
    urlhausUrls: urlhausList
      .map((u) => u.url)
      .filter((v): v is string => Boolean(v))
      .slice(0, 6),
    urlhausBlacklists,
    threatfoxHits: threatfoxList.length,
    threatfoxMalware,
    ransomwareHits: ransomwareList.length,
    ransomwareVictims: ransomwareList.map((v) => ({
      victim: v.victim,
      group: v.group,
      published: v.published,
    })),
    feodoHits: feodoEntries.length,
    feodoEntries,
    otxPulses,
    otxPulseNames,
    totalHits,
  };

  const feodoMalware = Array.from(
    new Set(feodoEntries.map((e) => e.malware).filter((v): v is string => Boolean(v)))
  );
  const combinedMalware = Array.from(new Set([...threatfoxMalware, ...feodoMalware]));

  const resultItem: InvestigationResultItem = {
    id: `mailaccess-threat-intel-${kind}`,
    platform: 'Threat-Intel Malware & IOC Feeds',
    domain: 'urlhaus.abuse.ch',
    category: totalHits > 0 ? 'Breach & Exposure' : 'Network & Infrastructure',
    tool: 'mailaccess',
    status: totalHits > 0 ? 'found' : 'not_found',
    findingKind: totalHits > 0 ? 'leaked' : 'infrastructure',
    handle: clean,
    displayName:
      totalHits > 0
        ? `${totalHits} Live Threat-Intel Match(es)`
        : 'Clean Across Public Threat Feeds',
    accountType: feedsChecked.join(' · '),
    relativeTime: totalHits > 0 ? 'Active IOC match' : 'Verified clean',
    linkedInfo: [
      `URLhaus: ${urlhausList.length} URL(s)`,
      `ThreatFox: ${threatfoxList.length} IOC(s)`,
      ...(kind === 'domain'
        ? [`Ransomware.live: ${ransomwareList.length} claim(s)`]
        : [`Feodo Tracker C2: ${feodoEntries.length} match(es)`]),
      `AlienVault OTX: ${otxPulses} pulse(s)`,
      ...urlhausBlacklists,
    ],
    displayFields:
      totalHits > 0
        ? [
            { label: 'Indicator', value: clean, copyable: true },
            { label: 'URLhaus URLs', value: String(urlhausList.length) },
            { label: 'ThreatFox IOCs', value: String(threatfoxList.length) },
            ...(kind === 'domain'
              ? [{ label: 'Ransomware Claims', value: String(ransomwareList.length) }]
              : [{ label: 'Feodo C2 Hits', value: String(feodoEntries.length) }]),
            { label: 'AlienVault OTX Pulses', value: String(otxPulses) },
            ...(combinedMalware[0]
              ? [{ label: 'Malware Family', value: combinedMalware.join(', ') }]
              : []),
            ...(otxPulseNames[0]
              ? [{ label: 'OTX Pulses', value: otxPulseNames.slice(0, 3).join(' · ') }]
              : []),
          ]
        : undefined,
    statsLine:
      totalHits > 0
        ? `URLhaus ${urlhausList.length} · ThreatFox ${threatfoxList.length} · ${
            kind === 'domain'
              ? `Ransomware ${ransomwareList.length}`
              : `Feodo C2 ${feodoEntries.length}`
          } · OTX ${otxPulses}`
        : undefined,
    url: `https://urlhaus.abuse.ch/browse.php?search=${encodeURIComponent(clean)}`,
    summary:
      totalHits > 0
        ? `Flagged in live public threat intelligence feeds (${totalHits} total IOC/pulse/blacklist signal(s)).`
        : `No malicious URLs, ThreatFox IOCs, Feodo C2s, OTX threat pulses, or ransomware claims matched ${clean}.`,
    durationMs: Date.now() - t0,
    details: { ...summary, indicator: clean, kind },
  };

  return { summary, resultItem };
}

async function runIpLookup(ip: string): Promise<{
  results: InvestigationResultItem[];
  geo?: GeoMarker | null;
}> {
  const t0 = Date.now();
  const [geoRes, ptrHosts, threatRes] = await Promise.all([
    fetchJsonSafe<{
      success?: boolean;
      ip?: string;
      type?: string;
      continent?: string;
      country?: string;
      region?: string;
      city?: string;
      latitude?: number;
      longitude?: number;
      connection?: { asn?: number; org?: string; isp?: string; domain?: string };
    }>(`https://ipwho.is/${encodeURIComponent(ip)}`, 5500),
    dns.reverse(ip).catch(() => []),
    runLiveThreatIntelChecks(ip, 'ip'),
  ]);

  if (!geoRes.ok || !geoRes.data || geoRes.data.success === false) {
    return {
      results: [
        {
          id: 'mailaccess-ip-lookup',
          platform: `IP Intelligence (${ip})`,
          category: 'Network & Infrastructure',
          tool: 'mailaccess',
          status: ptrHosts.length > 0 ? 'found' : 'not_found',
          findingKind: 'infrastructure',
          handle: ip,
          accountType: 'IPv4 / IPv6 Endpoint',
          linkedInfo: ptrHosts.slice(0, 2),
          summary:
            ptrHosts.length > 0
              ? `Reverse PTR resolved: ${ptrHosts[0]}`
              : 'No public IP geolocation metadata resolved.',
          durationMs: Date.now() - t0,
          details: { ip, ptrHosts, threatIntel: threatRes.summary },
        },
        threatRes.resultItem,
      ],
    };
  }

  const d = geoRes.data;
  const geo: GeoMarker | null =
    typeof d.latitude === 'number' && typeof d.longitude === 'number'
      ? {
          id: `geo-ip-${ip}`,
          label: [d.city, d.region, d.country].filter(Boolean).join(', '),
          region: d.city || d.region || 'Network Node',
          country: d.country || 'Unknown',
          lat: d.latitude,
          lng: d.longitude,
          source: 'IP Geolocation',
          count: 1,
        }
      : null;

  return {
    results: [
      {
        id: 'mailaccess-ip-lookup',
        platform: `IP Node (${d.connection?.isp || d.country || ip})`,
        domain: d.connection?.domain || undefined,
        category: 'Network & Infrastructure',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'infrastructure',
        handle: ip,
        displayName: d.connection?.org || d.connection?.isp || ip,
        accountType: d.connection?.asn
          ? `ASN ${d.connection.asn}`
          : 'Network Endpoint',
        relativeTime: 'Live telemetry',
        linkedInfo: [
          [d.city, d.country].filter(Boolean).join(', '),
          d.connection?.domain,
          ptrHosts[0] ? `PTR: ${ptrHosts[0]}` : undefined,
          threatRes.summary.totalHits > 0
            ? `Threat Feeds: ${threatRes.summary.totalHits} IOC(s)`
            : 'Threat Feeds: Clean',
        ].filter((v): v is string => Boolean(v)),
        displayFields: [
          { label: 'IP Address', value: ip, copyable: true },
          d.connection?.asn ? { label: 'ASN', value: `AS${d.connection.asn}`, copyable: true } : null,
          (d.connection?.org || d.connection?.isp)
            ? { label: 'ISP / Org', value: String(d.connection?.org || d.connection?.isp), copyable: true }
            : null,
          d.country ? { label: 'Location', value: [d.city, d.region, d.country].filter(Boolean).join(', ') } : null,
          {
            label: 'Threat Feeds',
            value:
              threatRes.summary.totalHits > 0
                ? `${threatRes.summary.totalHits} IOC Hit(s)`
                : 'Clean (URLhaus / ThreatFox)',
          },
          ptrHosts[0] ? { label: 'PTR Host', value: ptrHosts[0], copyable: true } : null,
        ].filter((v): v is NonNullable<typeof v> => Boolean(v)),
        summary: `${[d.city, d.region, d.country].filter(Boolean).join(', ')} · ${d.connection?.org || d.connection?.isp || 'Public Host'}`,
        durationMs: Date.now() - t0,
        details: {
          ip,
          type: d.type,
          city: d.city,
          region: d.region,
          country: d.country,
          asn: d.connection?.asn,
          isp: d.connection?.isp,
          org: d.connection?.org,
          domain: d.connection?.domain,
          ptrHosts,
          threatIntel: threatRes.summary,
        },
      },
      threatRes.resultItem,
    ],
    geo,
  };
}

async function inspectTlsCertificate(domain: string): Promise<{
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  subjectAltNames?: string[];
} | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: domain,
        port: 443,
        servername: domain,
        rejectUnauthorized: false,
      },
      () => {
        try {
          const cert = socket.getPeerCertificate();
          socket.end();
          if (!cert || Object.keys(cert).length === 0) {
            resolve(null);
            return;
          }
          const issuerObj = cert.issuer as Record<string, string> | undefined;
          const issuer = issuerObj?.O || issuerObj?.CN || undefined;
          resolve({
            issuer,
            validFrom: normalizeIsoDate(cert.valid_from),
            validTo: normalizeIsoDate(cert.valid_to),
            subjectAltNames: cert.subjectaltname
              ? cert.subjectaltname
                  .split(',')
                  .map((s) => s.trim().replace(/^DNS:/, ''))
                  .slice(0, 6)
              : undefined,
          });
        } catch {
          socket.end();
          resolve(null);
        }
      }
    );
    socket.setTimeout(3200, () => {
      socket.destroy();
      resolve(null);
    });
    socket.on('error', () => resolve(null));
  });
}

async function discoverCrtShSubdomains(domain: string): Promise<string[]> {
  const res = await fetchJsonSafe<Array<{ name_value?: string }>>(
    `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`,
    5200
  );
  if (!res.ok || !Array.isArray(res.data)) return [];
  const subs = new Set<string>();
  for (const row of res.data.slice(0, 250)) {
    const lines = String(row.name_value || '').split('\n');
    for (const line of lines) {
      const cleaned = line.trim().toLowerCase().replace(/^\*\./, '');
      if (
        cleaned &&
        cleaned !== domain &&
        cleaned.endsWith(`.${domain}`) &&
        /^[a-z0-9.-]+$/.test(cleaned)
      ) {
        subs.add(cleaned);
        if (subs.size >= 30) break;
      }
    }
    if (subs.size >= 30) break;
  }
  return Array.from(subs).sort();
}

async function probeDkimSelectors(domain: string): Promise<string[]> {
  const selectors = ['google', 'selector1', 'selector2', 'default', 'k1', 's1'];
  const hits = await Promise.all(
    selectors.map(async (sel) => {
      const recs = await dns.resolveTxt(`${sel}._domainkey.${domain}`).catch(() => []);
      const joined = recs.flat().join('');
      return joined.toLowerCase().includes('v=dkim1') || joined.includes('p=') ? sel : null;
    })
  );
  return hits.filter((v): v is string => Boolean(v));
}

function buildTyposquatCandidates(
  cleanDomain: string
): Array<{ domain: string; reason: string }> {
  const parts = cleanDomain.split('.');
  if (parts.length < 2) return [];
  const label = parts[0];
  const tld = parts.slice(1).join('.');
  const out: Array<{ domain: string; reason: string }> = [];
  const seen = new Set<string>([cleanDomain]);

  const add = (domain: string, reason: string) => {
    const d = domain.toLowerCase();
    if (!seen.has(d) && /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) {
      seen.add(d);
      out.push({ domain: d, reason });
    }
  };

  for (const swapTld of ['co', 'net', 'org', 'io', 'in']) {
    if (swapTld !== tld) add(`${label}.${swapTld}`, `TLD swap (.${swapTld})`);
  }

  for (const suffix of ['login', 'support', 'auth', 'verify']) {
    add(`${label}-${suffix}.${tld}`, `Impersonation (-${suffix})`);
  }

  if (label.length >= 4) {
    // Omitted middle char
    const mid = Math.floor(label.length / 2);
    add(`${label.slice(0, mid)}${label.slice(mid + 1)}.${tld}`, 'Omitted character');
    // Adjacent transposition
    const chars = label.split('');
    [chars[mid - 1], chars[mid]] = [chars[mid], chars[mid - 1]];
    add(`${chars.join('')}.${tld}`, 'Transposed characters');
  }

  // Homoglyph / lookalike substitution
  if (label.includes('l')) add(`${label.replace('l', '1')}.${tld}`, 'Homoglyph (l -> 1)');
  if (label.includes('o')) add(`${label.replace('o', '0')}.${tld}`, 'Homoglyph (o -> 0)');
  if (label.includes('m')) add(`${label.replace('m', 'rn')}.${tld}`, 'Lookalike (m -> rn)');

  return out.slice(0, 12);
}

async function runTyposquatRadar(
  cleanDomain: string
): Promise<TyposquatCandidate[]> {
  const candidates = buildTyposquatCandidates(cleanDomain);
  if (candidates.length === 0) return [];

  return Promise.all(
    candidates.map(async (c) => {
      const timeoutPromise = new Promise<{ ipv4: string[]; hasMx: boolean }>((resolve) =>
        setTimeout(() => resolve({ ipv4: [], hasMx: false }), 2200)
      );
      const probePromise = (async () => {
        const [a, mx] = await Promise.all([
          dns.resolve4(c.domain).catch(() => []),
          dns.resolveMx(c.domain).catch(() => []),
        ]);
        return { ipv4: a.slice(0, 3), hasMx: mx.length > 0 };
      })();
      const res = await Promise.race([probePromise, timeoutPromise]);
      return {
        domain: c.domain,
        reason: c.reason,
        resolved: res.ipv4.length > 0 || res.hasMx,
        ipv4: res.ipv4,
        hasMx: res.hasMx,
      };
    })
  );
}

async function runDomainLookup(domain: string): Promise<{
  results: InvestigationResultItem[];
  geo?: GeoMarker | null;
}> {
  const t0 = Date.now();
  const cleanDomain = domain.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();

  const [
    aRecords,
    aaaaRecords,
    mxRecords,
    txtRecords,
    dmarcRecords,
    nsRecords,
    rdapRes,
    httpHead,
    tlsInfo,
    subdomains,
    dkimSelectors,
    securityTxtRes,
    robotsTxtRes,
    typosquats,
    threatIntel,
  ] = await Promise.all([
    dns.resolve4(cleanDomain).catch(() => []),
    dns.resolve6(cleanDomain).catch(() => []),
    dns.resolveMx(cleanDomain).catch(() => []),
    dns.resolveTxt(cleanDomain).catch(() => []),
    dns.resolveTxt(`_dmarc.${cleanDomain}`).catch(() => []),
    dns.resolveNs(cleanDomain).catch(() => []),
    fetchJsonSafe<{
      ldhName?: string;
      events?: Array<{ eventAction?: string; eventDate?: string }>;
      entities?: Array<{ vcardArray?: unknown[] }>;
    }>(`https://rdap.org/domain/${encodeURIComponent(cleanDomain)}`, 5000),
    fetchHeadOrGetStatus(`https://${cleanDomain}`, 4500),
    inspectTlsCertificate(cleanDomain),
    discoverCrtShSubdomains(cleanDomain),
    probeDkimSelectors(cleanDomain),
    fetchHeadOrGetStatus(`https://${cleanDomain}/.well-known/security.txt`, 3500),
    fetchHeadOrGetStatus(`https://${cleanDomain}/robots.txt`, 3500),
    runTyposquatRadar(cleanDomain),
    runLiveThreatIntelChecks(cleanDomain, 'domain'),
  ]);

  const sortedMx = [...mxRecords].sort((a, b) => a.priority - b.priority);
  const spf = txtRecords
    .flat()
    .find((t) => t.toLowerCase().startsWith('v=spf1'));
  const dmarc = dmarcRecords
    .flat()
    .find((t) => t.toLowerCase().startsWith('v=dmarc1'));

  const headers = httpHead.headers || {};
  const headerChecks = [
    { key: 'strict-transport-security', label: 'HSTS', present: Boolean(headers['strict-transport-security']) },
    { key: 'content-security-policy', label: 'CSP', present: Boolean(headers['content-security-policy']) },
    { key: 'x-frame-options', label: 'X-Frame-Options', present: Boolean(headers['x-frame-options']) },
    { key: 'x-content-type-options', label: 'X-Content-Type-Options', present: Boolean(headers['x-content-type-options']) },
    { key: 'referrer-policy', label: 'Referrer-Policy', present: Boolean(headers['referrer-policy']) },
    { key: 'permissions-policy', label: 'Permissions-Policy', present: Boolean(headers['permissions-policy']) },
  ];

  const securityTxtFound = securityTxtRes.status >= 200 && securityTxtRes.status < 300;
  const robotsTxtFound = robotsTxtRes.status >= 200 && robotsTxtRes.status < 300;

  let postureScore = 0;
  if (tlsInfo) postureScore += 20;
  if (spf) postureScore += 15;
  if (dmarc) {
    postureScore += /p=(reject|quarantine)/i.test(dmarc) ? 20 : 12;
  }
  if (dkimSelectors.length > 0) postureScore += 10;
  postureScore += headerChecks.filter((h) => h.present).length * 5; // up to 30
  if (securityTxtFound) postureScore += 5;

  const securityGrade =
    postureScore >= 90
      ? 'A+'
      : postureScore >= 80
      ? 'A'
      : postureScore >= 65
      ? 'B'
      : postureScore >= 50
      ? 'C'
      : postureScore >= 35
      ? 'D'
      : 'F';

  const regEvent = rdapRes.data?.events?.find(
    (e) => e.eventAction === 'registration'
  )?.eventDate;
  const updEvent = rdapRes.data?.events?.find(
    (e) => e.eventAction === 'last changed' || e.eventAction === 'last update of RDAP database'
  )?.eventDate;

  let geo: GeoMarker | null = null;
  if (aRecords[0]) {
    const ipInfo = await fetchJsonSafe<{
      success?: boolean;
      city?: string;
      region?: string;
      country?: string;
      latitude?: number;
      longitude?: number;
    }>(`https://ipwho.is/${encodeURIComponent(aRecords[0])}`, 4000);
    if (
      ipInfo.ok &&
      ipInfo.data?.success !== false &&
      typeof ipInfo.data?.latitude === 'number' &&
      typeof ipInfo.data?.longitude === 'number'
    ) {
      geo = {
        id: `geo-domain-${cleanDomain}`,
        label: [ipInfo.data.city, ipInfo.data.country].filter(Boolean).join(', '),
        region: ipInfo.data.city || ipInfo.data.region || 'Edge Host',
        country: ipInfo.data.country || 'Unknown',
        lat: ipInfo.data.latitude,
        lng: ipInfo.data.longitude,
        source: `Primary Host (${aRecords[0]})`,
        count: 1,
      };
    }
  }

  const dnsArtifacts: ArtifactItem[] = [
    ...aRecords.map((ip, i) => ({
      id: `a-${i}`,
      type: 'dns_record' as const,
      title: `A → ${ip}`,
      subtitle: cleanDomain,
      summary: 'IPv4 Address Record',
      details: { type: 'A', address: ip },
    })),
    ...aaaaRecords.slice(0, 4).map((ip, i) => ({
      id: `aaaa-${i}`,
      type: 'dns_record' as const,
      title: `AAAA → ${ip}`,
      subtitle: cleanDomain,
      summary: 'IPv6 Address Record',
      details: { type: 'AAAA', address: ip },
    })),
    ...sortedMx.map((mx, i) => ({
      id: `mx-${i}`,
      type: 'dns_record' as const,
      title: `MX ${mx.priority} → ${mx.exchange}`,
      subtitle: cleanDomain,
      summary: 'Mail Exchanger Record',
      details: { type: 'MX', priority: mx.priority, exchange: mx.exchange },
    })),
    ...(tlsInfo
      ? [
          {
            id: 'tls-cert',
            type: 'dns_record' as const,
            title: `TLS Certificate (${tlsInfo.issuer || 'Verified HTTPS'})`,
            subtitle: tlsInfo.validTo ? `Expires ${tlsInfo.validTo.slice(0, 10)}` : cleanDomain,
            timestamp: tlsInfo.validFrom,
            summary: `Issued by ${tlsInfo.issuer || 'Public CA'} · SANs: ${(tlsInfo.subjectAltNames || []).join(', ')}`,
            details: tlsInfo as Record<string, unknown>,
          },
        ]
      : []),
    ...(spf
      ? [
          {
            id: 'txt-spf',
            type: 'dns_record' as const,
            title: 'SPF Policy',
            subtitle: cleanDomain,
            summary: spf,
            details: { type: 'TXT/SPF', record: spf },
          },
        ]
      : []),
    ...(dmarc
      ? [
          {
            id: 'txt-dmarc',
            type: 'dns_record' as const,
            title: 'DMARC Enforcement',
            subtitle: `_dmarc.${cleanDomain}`,
            summary: dmarc,
            details: { type: 'TXT/DMARC', record: dmarc },
          },
        ]
      : []),
    ...(dkimSelectors.length > 0
      ? [
          {
            id: 'txt-dkim',
            type: 'dns_record' as const,
            title: `DKIM Keys (${dkimSelectors.join(', ')})`,
            subtitle: cleanDomain,
            summary: `Active DKIM selector(s): ${dkimSelectors.join(', ')}`,
            details: { type: 'TXT/DKIM', selectors: dkimSelectors },
          },
        ]
      : []),
    {
      id: 'http-security-headers',
      type: 'dns_record' as const,
      title: `Attack Surface Posture: Grade ${securityGrade} (${postureScore}/100)`,
      subtitle: `${headerChecks.filter((h) => h.present).length}/6 Web Security Headers`,
      summary: `HSTS: ${headers['strict-transport-security'] ? 'Yes' : 'No'} · CSP: ${headers['content-security-policy'] ? 'Yes' : 'No'} · security.txt: ${securityTxtFound ? 'Present' : 'Missing'}`,
      details: {
        securityGrade,
        postureScore,
        headerChecks,
        rawHeaders: headers,
        securityTxtFound,
        robotsTxtFound,
      },
    },
    ...subdomains.slice(0, 12).map((sub, i) => ({
      id: `sub-${i}`,
      type: 'dns_record' as const,
      title: `Subdomain: ${sub}`,
      subtitle: 'Certificate Transparency (crt.sh)',
      url: `https://${sub}`,
      summary: `Discovered in crt.sh Certificate Transparency logs`,
      details: { type: 'CT_SUBDOMAIN', host: sub },
    })),
  ];

  const foundAny = aRecords.length > 0 || sortedMx.length > 0 || nsRecords.length > 0;
  const resolvedTyposquats = typosquats.filter((t) => t.resolved);

  const extraDomainResults: InvestigationResultItem[] = [threatIntel.resultItem];
  if (resolvedTyposquats.length > 0) {
    extraDomainResults.push({
      id: 'mailaccess-typosquat-radar',
      platform: 'Typosquat & Lookalike Radar',
      domain: cleanDomain,
      category: 'Network & Infrastructure',
      tool: 'mailaccess',
      status: 'found',
      findingKind: 'infrastructure',
      handle: cleanDomain,
      displayName: `${resolvedTyposquats.length} Active Lookalike Domain(s)`,
      accountType: `${typosquats.length} Variants Probed`,
      relativeTime: 'Live DNS check',
      linkedInfo: resolvedTyposquats.slice(0, 4).map((t) => `${t.domain} (${t.reason})`),
      displayFields: [
        { label: 'Target Domain', value: cleanDomain, copyable: true },
        { label: 'Active Lookalikes', value: String(resolvedTyposquats.length) },
        { label: 'Top Variant', value: resolvedTyposquats[0].domain, copyable: true },
        { label: 'Variant IP', value: resolvedTyposquats[0].ipv4[0] || 'MX Only', copyable: true },
      ],
      statsLine: `${resolvedTyposquats.length}/${typosquats.length} lookalike domains resolve in DNS`,
      url: `https://${resolvedTyposquats[0].domain}`,
      summary: `Resolved ${resolvedTyposquats.length} active lookalike/typosquat domain(s) matching ${cleanDomain}: ${resolvedTyposquats.slice(0, 3).map((t) => t.domain).join(', ')}`,
      durationMs: Date.now() - t0,
      details: {
        targetDomain: cleanDomain,
        resolvedCount: resolvedTyposquats.length,
        typosquats,
      },
    });
  }

  return {
    results: [
      {
        id: 'mailaccess-domain-dns',
        platform: `Domain Infrastructure (${cleanDomain})`,
        domain: cleanDomain,
        category: 'Email & Domain',
        tool: 'mailaccess',
        status: foundAny ? 'found' : 'not_found',
        findingKind: 'infrastructure',
        handle: cleanDomain,
        displayName: cleanDomain,
        accountType: tlsInfo?.issuer
          ? `Grade ${securityGrade} · HTTPS (${tlsInfo.issuer})`
          : `Grade ${securityGrade} · DNS Zone`,
        firstSeen: normalizeIsoDate(regEvent),
        lastSeen: normalizeIsoDate(updEvent),
        relativeTime: formatRelativeTime(updEvent || regEvent),
        linkedInfo: [
          `Security Grade ${securityGrade} (${postureScore}/100)`,
          aRecords[0] ? `IP: ${aRecords[0]}` : undefined,
          subdomains.length > 0 ? `${subdomains.length} Subdomain(s) via crt.sh` : undefined,
          resolvedTyposquats.length > 0
            ? `${resolvedTyposquats.length} Active Typosquat(s)`
            : 'No Active Typosquats',
          threatIntel.summary.totalHits > 0
            ? `Threat Feeds: ${threatIntel.summary.totalHits} IOC(s)`
            : 'Threat Feeds: Clean',
          spf ? 'SPF Active' : 'No SPF',
          dmarc ? 'DMARC Active' : 'No DMARC',
        ].filter((v): v is string => Boolean(v)),
        displayFields: [
          { label: 'Domain', value: cleanDomain, copyable: true },
          { label: 'Attack Surface Grade', value: `${securityGrade} (${postureScore}/100)` },
          aRecords[0] ? { label: 'Primary IPv4', value: aRecords[0], copyable: true } : null,
          { label: 'Subdomains (crt.sh)', value: String(subdomains.length) },
          { label: 'Active Lookalikes', value: `${resolvedTyposquats.length}/${typosquats.length}` },
          {
            label: 'Threat Feeds',
            value:
              threatIntel.summary.totalHits > 0
                ? `${threatIntel.summary.totalHits} Hit(s)`
                : 'Clean',
          },
          { label: 'SPF Policy', value: spf ? 'Yes' : 'No', kind: 'boolean' as const },
          { label: 'DMARC Policy', value: dmarc ? 'Yes' : 'No', kind: 'boolean' as const },
          { label: 'security.txt', value: securityTxtFound ? 'Yes' : 'No', kind: 'boolean' as const },
        ].filter((v): v is NonNullable<typeof v> => Boolean(v)),
        statsLine: `Grade ${securityGrade} · A ${aRecords.length} · MX ${sortedMx.length} · Subdomains ${subdomains.length}`,
        url: `https://${cleanDomain}`,
        summary: foundAny
          ? `Security Grade ${securityGrade} (${postureScore}/100) · ${subdomains.length} CT subdomains · ${resolvedTyposquats.length} active lookalikes · ${headerChecks.filter((h) => h.present).length}/6 HTTP security headers`
          : `No active public DNS records resolved for ${cleanDomain}`,
        durationMs: Date.now() - t0,
        artifacts: dnsArtifacts,
        details: {
          domain: cleanDomain,
          securityGrade,
          postureScore,
          headerChecks,
          httpSecurityHeaders: headers,
          securityTxtFound,
          robotsTxtFound,
          dkimSelectors,
          subdomains,
          typosquats,
          threatIntel: threatIntel.summary,
          aRecords,
          aaaaRecords,
          mxRecords: sortedMx,
          nsRecords,
          spf: spf || null,
          dmarc: dmarc || null,
          tls: tlsInfo,
          httpStatus: httpHead.status,
          serverHeader: httpHead.serverHeader,
        },
      },
      ...extraDomainResults,
    ],
    geo,
  };
}

async function runOpenPgpLookup(email: string): Promise<InvestigationResultItem> {
  const t0 = Date.now();
  const url = `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(email)}`;
  const check = await fetchHeadOrGetStatus(url, 5500);
  const found = check.status === 200;
  const timedOutOrUnavailable =
    check.status === 0 || check.status === 429 || check.status >= 500;
  const status: InvestigationResultItem['status'] = found
    ? 'found'
    : check.status === 404
    ? 'not_found'
    : timedOutOrUnavailable
    ? 'not_checked'
    : classifyHttpStatus(check.status);
  return {
    id: 'mailaccess-openpgp',
    platform: 'OpenPGP Keyserver',
    domain: 'keys.openpgp.org',
    category: 'Email & Domain',
    tool: 'mailaccess',
    status,
    findingKind: 'registered',
    handle: email,
    displayName: email,
    accountType: 'Cryptographic PGP Key',
    relativeTime: found ? 'Published key' : undefined,
    linkedInfo: found ? ['keys.openpgp.org VKS Verified'] : undefined,
    displayFields: found
      ? [
          { label: 'Email', value: email, kind: 'email' as const, copyable: true },
          { label: 'Registry', value: 'keys.openpgp.org' },
          { label: 'PGP Key Published', value: 'Yes', kind: 'boolean' as const },
        ]
      : undefined,
    url: found ? url : undefined,
    summary: found
      ? 'Verified public OpenPGP encryption key indexed for this email address.'
      : timedOutOrUnavailable
      ? 'OpenPGP keyserver lookup timed out or temporarily unavailable.'
      : 'No public OpenPGP key registered on keys.openpgp.org.',
    durationMs: Date.now() - t0,
    details: { httpStatus: check.status, endpoint: url, email },
  };
}

async function runHackerNewsEmailLookup(
  email: string
): Promise<InvestigationResultItem> {
  const t0 = Date.now();
  const cleanLower = email.trim().toLowerCase();
  const apiUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${email}"`)}&hitsPerPage=10`;
  const res = await fetchJsonSafe<{
    hits?: Array<{
      objectID?: string;
      author?: string;
      title?: string;
      story_title?: string;
      comment_text?: string;
      story_text?: string;
      url?: string;
      created_at?: string;
    }>;
  }>(apiUrl, 5000);

  const exactHits =
    res.ok && Array.isArray(res.data?.hits)
      ? res.data.hits.filter((hit) =>
          JSON.stringify(hit).toLowerCase().includes(cleanLower)
        )
      : [];

  if (exactHits.length > 0) {
    const first = exactHits[0];
    const authors = Array.from(
      new Set(exactHits.map((h) => h.author).filter((a): a is string => Boolean(a)))
    );
    const firstUrl = first?.objectID
      ? `https://news.ycombinator.com/item?id=${first.objectID}`
      : `https://hn.algolia.com/?q=${encodeURIComponent(`"${email}"`)}`;
    return {
      id: 'mailaccess-hackernews-email',
      platform: 'Hacker News (Algolia)',
      domain: 'news.ycombinator.com',
      category: 'Developer & Code',
      tool: 'mailaccess',
      status: 'found',
      findingKind: 'registered',
      handle: authors[0] || email,
      displayName: authors[0] ? `HN: ${authors[0]}` : email,
      accountType: 'Public Email Citation',
      firstSeen: normalizeIsoDate(first?.created_at),
      relativeTime: formatRelativeTime(first?.created_at),
      linkedInfo: [
        `${exactHits.length} Exact Citation(s)`,
        ...(authors[0] ? [`Author: ${authors[0]}`] : []),
      ],
      displayFields: [
        { label: 'Email', value: email, kind: 'email', copyable: true },
        { label: 'Exact HN Mentions', value: String(exactHits.length) },
        ...(authors.length > 0
          ? [{ label: 'HN Author(s)', value: authors.slice(0, 3).join(', '), copyable: true }]
          : []),
      ],
      url: firstUrl,
      summary: `Exact email cited in ${exactHits.length} public Hacker News post/comment(s).`,
      durationMs: Date.now() - t0,
      artifacts: exactHits.slice(0, 6).map((h, i) => ({
        id: `hn-hit-${h.objectID || i}`,
        type: 'profile_signal' as const,
        title: h.title || h.story_title || `Hacker News Item #${h.objectID || i + 1}`,
        subtitle: h.author ? `@${h.author}` : 'Hacker News',
        url: h.objectID
          ? `https://news.ycombinator.com/item?id=${h.objectID}`
          : h.url,
        summary: (h.comment_text || h.story_text || '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 180),
        timestamp: normalizeIsoDate(h.created_at),
        details: { objectID: h.objectID || null, author: h.author || null },
      })),
      details: { email, matchCount: exactHits.length, authors },
    };
  }

  return {
    id: 'mailaccess-hackernews-email',
    platform: 'Hacker News (Algolia)',
    domain: 'news.ycombinator.com',
    category: 'Developer & Code',
    tool: 'mailaccess',
    status: res.ok ? 'not_found' : 'not_checked',
    findingKind: 'registered',
    handle: email,
    displayName: email,
    summary: res.ok
      ? `No exact ${email} mentions indexed on Hacker News.`
      : 'Hacker News Algolia lookup inconclusive.',
    durationMs: Date.now() - t0,
    details: { httpStatus: res.status, email },
  };
}

async function runMailAccessEmailModule(
  email: string,
  onSubResult?: (items: InvestigationResultItem[], breaches?: BreachedAccountItem[], geo?: GeoMarker | null) => void,
  enableGoogleDorking = false
): Promise<{
  results: InvestigationResultItem[];
  breaches: BreachedAccountItem[];
  geoMarkers: GeoMarker[];
}> {
  const results: InvestigationResultItem[] = [];
  const geoMarkers: GeoMarker[] = [];
  const domain = email.split('@')[1]?.toLowerCase() || '';

  const t0 = Date.now();
  const [mxRecords, txtRecords, dmarcRecords, bimiRecords, rdapRes] = await Promise.all([
    dns.resolveMx(domain).catch(() => []),
    dns.resolveTxt(domain).catch(() => []),
    dns.resolveTxt(`_dmarc.${domain}`).catch(() => []),
    dns.resolveTxt(`default._bimi.${domain}`).catch(() => []),
    fetchJsonSafe<{ events?: Array<{ eventAction?: string; eventDate?: string }> }>(
      `https://rdap.org/domain/${encodeURIComponent(domain)}`,
      4200
    ),
  ]);

  const sortedMx = [...mxRecords].sort((a, b) => a.priority - b.priority);
  const primaryMx = sortedMx[0]?.exchange?.toLowerCase() || '';
  const spf = txtRecords
    .flat()
    .find((t) => t.toLowerCase().startsWith('v=spf1'));
  const dmarc = dmarcRecords
    .flat()
    .find((t) => t.toLowerCase().startsWith('v=dmarc1'));
  const bimi = bimiRecords
    .flat()
    .find((t) => t.toLowerCase().startsWith('v=bimi1'));
  const domainRegistered = normalizeIsoDate(
    rdapRes.data?.events?.find((e) => e.eventAction === 'registration')?.eventDate
  );

  let provider = 'Custom Mail Host';
  if (primaryMx.includes('google') || primaryMx.includes('gmail')) {
    provider = 'Google Workspace / Gmail';
  } else if (primaryMx.includes('outlook') || primaryMx.includes('protection.outlook')) {
    provider = 'Microsoft 365';
  } else if (primaryMx.includes('proton')) {
    provider = 'Proton Mail';
  } else if (primaryMx.includes('icloud')) {
    provider = 'Apple iCloud Mail';
  } else if (primaryMx.includes('yahoodns')) {
    provider = 'Yahoo Mail';
  } else if (primaryMx.includes('zoho')) {
    provider = 'Zoho Mail';
  } else if (primaryMx.includes('fastmail')) {
    provider = 'Fastmail';
  }

  const dnsItem: InvestigationResultItem = {
    id: 'mailaccess-dns',
    platform: `Mail Domain (${domain})`,
    domain,
    category: 'Email & Domain',
    tool: 'mailaccess',
    status: sortedMx.length > 0 ? 'found' : 'not_found',
    findingKind: 'infrastructure',
    handle: domain,
    displayName: provider,
    accountType: provider,
    firstSeen: domainRegistered,
    relativeTime: 'Active DNS',
    linkedInfo: [
      sortedMx.length > 0 ? `${sortedMx.length} MX Record(s)` : 'No MX',
      spf ? 'SPF Valid' : 'No SPF',
      dmarc ? 'DMARC Present' : 'No DMARC',
      bimi ? 'BIMI Verified' : undefined,
    ].filter((v): v is string => Boolean(v)),
    displayFields: [
      { label: 'Domain', value: domain, copyable: true },
      { label: 'Mail Provider', value: provider },
      primaryMx ? { label: 'Primary MX', value: primaryMx, copyable: true } : null,
      { label: 'SPF', value: spf ? 'Yes' : 'No', kind: 'boolean' as const },
      { label: 'DMARC', value: dmarc ? 'Yes' : 'No', kind: 'boolean' as const },
    ].filter((v): v is NonNullable<typeof v> => Boolean(v)),
    statsLine: `MX ${sortedMx.length} · BIMI ${bimi ? 'Yes' : 'No'}`,
    url: `https://${domain}`,
    summary:
      sortedMx.length > 0
        ? `${provider} · Primary MX: ${primaryMx}`
        : `No active MX exchangers resolved for ${domain}`,
    durationMs: Date.now() - t0,
    artifacts: sortedMx.map((mx, i) => ({
      id: `mx-${i}`,
      type: 'dns_record',
      title: `MX ${mx.priority} → ${mx.exchange}`,
      subtitle: provider,
      summary: `Mail exchanger priority ${mx.priority}`,
      details: { type: 'MX', priority: mx.priority, exchange: mx.exchange },
    })),
    details: { domain, provider, primaryMx, mxRecords: sortedMx, spf, dmarc, bimi, domainRegistered },
  };
  results.push(dnsItem);
  onSubResult?.([dnsItem]);

  let breaches: BreachedAccountItem[] = [];
  const isCustomDomain =
    domain &&
    ![
      'gmail.com',
      'googlemail.com',
      'yahoo.com',
      'yahoo.co.in',
      'yahoo.co.uk',
      'yahoo.in',
      'outlook.com',
      'outlook.in',
      'hotmail.com',
      'hotmail.co.uk',
      'hotmail.in',
      'live.com',
      'live.in',
      'icloud.com',
      'me.com',
      'mac.com',
      'proton.me',
      'protonmail.com',
      'protonmail.ch',
      'pm.me',
      'tuta.io',
      'tutanota.com',
      'gmx.com',
      'gmx.net',
      'zoho.com',
      'zoho.in',
      'zohomail.com',
      'zohomail.in',
      'rediffmail.com',
      'rediff.com',
      'aol.com',
      'mail.com',
      'mail.ru',
      'yandex.com',
      'yandex.ru',
      'qq.com',
      '163.com',
      'fastmail.com',
      'hey.com',
      'duck.com',
    ].includes(domain);

  const slackWorkspacePromise = (async (): Promise<void> => {
    if (!isCustomDomain) return;
    const tSlack = Date.now();
    const label = domain.split('.')[0]?.toLowerCase() || '';
    if (label.length < 2) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch('https://slack.com/api/auth.findTeam', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'User-Agent': USER_AGENT,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: `domain=${encodeURIComponent(label)}`,
      }).finally(() => clearTimeout(timer));
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        team_id?: string;
        url?: string;
        sso?: boolean;
        error?: string;
      } | null;

      if (data?.ok && data.team_id) {
        const slackUrl = data.url || `https://${label}.slack.com/`;
        const slackItem: InvestigationResultItem = {
          id: 'mailaccess-slack-workspace',
          platform: `Slack Workspace (${label})`,
          domain: 'slack.com',
          category: 'Productivity & Cloud',
          tool: 'mailaccess',
          status: 'found',
          findingKind: 'infrastructure',
          handle: `${label}.slack.com`,
          displayName: `${label}.slack.com`,
          accountType: data.sso ? 'Enterprise SSO Workspace' : 'Active Slack Workspace',
          displayFields: [
            { label: 'Workspace URL', value: slackUrl, kind: 'url', copyable: true },
            { label: 'Team ID', value: data.team_id, copyable: true },
            ...(typeof data.sso === 'boolean'
              ? [{ label: 'SSO Enforced', value: data.sso ? 'Yes' : 'No', kind: 'boolean' as const }]
              : []),
          ],
          url: slackUrl,
          summary: `Active Slack workspace confirmed for domain "${domain}" (${slackUrl}, Team ID ${data.team_id}).`,
          durationMs: Date.now() - tSlack,
          details: { domain, label, ...data },
        };
        results.push(slackItem);
        onSubResult?.([slackItem]);
      } else {
        const slackMiss: InvestigationResultItem = {
          id: 'mailaccess-slack-workspace',
          platform: `Slack Workspace (${label})`,
          domain: 'slack.com',
          category: 'Productivity & Cloud',
          tool: 'mailaccess',
          status: data?.error === 'team_not_found' ? 'not_found' : 'not_checked',
          findingKind: 'infrastructure',
          handle: `${label}.slack.com`,
          summary:
            data?.error === 'team_not_found'
              ? `No Slack workspace registered on ${label}.slack.com.`
              : `Slack workspace lookup inconclusive (${data?.error || `HTTP ${res.status}`}).`,
          durationMs: Date.now() - tSlack,
        };
        results.push(slackMiss);
        onSubResult?.([slackMiss]);
      }
    } catch {
      // non-fatal
    }
  })();

  const emailDorkPromise = enableGoogleDorking
    ? (async (): Promise<void> => {
        const tDork = Date.now();
        try {
          const dorkReport = await runDeepGoogleDorking({
            target: email,
            targetType: 'email',
            mode: 'full',
          });
      const dorkArtifacts: ArtifactItem[] = [
        ...dorkReport.hits.slice(0, 30).map((hit) => ({
          id: `email-dork-hit-${hit.id}`,
          type: 'profile_signal' as const,
          title: `[${hit.fileType}] ${hit.title}`,
          subtitle: `${hit.category} · ${hit.domain} (${hit.sourceEngine})`,
          url: hit.url,
          timestamp: hit.timestamp,
          summary: hit.snippet.slice(0, 300),
          details: {
            category: hit.category,
            fileType: hit.fileType,
            domain: hit.domain,
            sourceEngine: hit.sourceEngine,
            matchedQuery: hit.matchedQuery,
          },
        })),
        ...dorkReport.queries.map((q) => ({
          id: `email-dork-q-${q.id}`,
          type: 'profile_signal' as const,
          title: `Google Dork: ${q.title}`,
          subtitle: `${q.category} · ${q.description}`,
          url: q.googleUrl,
          summary: q.query,
          details: { dorkQuery: q.query, category: q.category },
        })),
      ];

      const hasExposedFilesOrCode =
        dorkReport.summary.filesAndDocs > 0 || dorkReport.summary.codeAndPastes > 0;
      const topFormats = Array.from(new Set(dorkReport.hits.map((h) => h.fileType))).slice(0, 5);

      const dorkItem: InvestigationResultItem =
        dorkReport.hits.length > 0
          ? {
              id: 'mailaccess-live-web-dorks',
              platform: 'Deep Web, Code & Document Index',
              domain: dorkReport.hits[0]?.domain || 'google.com',
              category: 'Breach & Exposure',
              tool: 'mailaccess',
              status: 'found',
              findingKind: hasExposedFilesOrCode ? 'leaked' : 'registered',
              handle: email,
              displayName: `${dorkReport.hits.length} Public Web/Code Match${
                dorkReport.hits.length === 1 ? '' : 'es'
              }`,
              accountType: `Formats: ${topFormats.join(', ')}`,
              relativeTime: `${dorkReport.summary.codeAndPastes} code · ${dorkReport.summary.filesAndDocs} doc(s)`,
              linkedInfo: [
                `${dorkReport.summary.filesAndDocs} Files & Docs`,
                `${dorkReport.summary.codeAndPastes} Code & Pastes`,
                `${dorkReport.summary.websitesAndMentions} Websites`,
                `${dorkReport.summary.archivesAndRecords} Archives`,
              ],
              displayFields: [
                { label: 'Email', value: email, kind: 'email', copyable: true },
                { label: 'Live Matches', value: String(dorkReport.hits.length) },
                { label: 'Code & Pastes', value: String(dorkReport.summary.codeAndPastes) },
                { label: 'Files & Documents', value: String(dorkReport.summary.filesAndDocs) },
                { label: 'Top Source Domain', value: dorkReport.hits[0]?.domain || '—' },
              ],
              statsLine: `${dorkReport.hits.length} live matches · ${dorkReport.enginesQueried.join(', ')}`,
              url: dorkReport.hits[0]?.url || dorkReport.queries[0]?.googleUrl,
              summary: `Surfaced ${dorkReport.hits.length} verified public citation(s) (${dorkReport.summary.codeAndPastes} code/pastes, ${dorkReport.summary.filesAndDocs} files/docs, ${dorkReport.summary.websitesAndMentions} websites) mentioning ${email}.`,
              durationMs: Date.now() - tDork,
              artifacts: dorkArtifacts,
              details: { dorkReport },
            }
          : {
              id: 'mailaccess-live-web-dorks',
              platform: 'Deep Web, Code & Document Index',
              domain: 'google.com',
              category: 'Breach & Exposure',
              tool: 'mailaccess',
              status: 'not_found',
              findingKind: 'leaked',
              handle: email,
              displayName: 'No Public Web/Code Citations',
              relativeTime: `${dorkReport.queries.length} dorks queried`,
              url: dorkReport.queries[0]?.googleUrl,
              summary: `No public web pages, source repositories, PDFs, or spreadsheets surfaced for ${email} across ${dorkReport.enginesQueried.length} live search engines.`,
              durationMs: Date.now() - tDork,
              artifacts: dorkArtifacts,
              details: { dorkReport },
            };

      results.push(dorkItem);
      onSubResult?.([dorkItem]);
    } catch {
      // non-fatal
    }
  })()
    : Promise.resolve();

  await Promise.all([
    runGravatarLookup(email, 'email', 'mailaccess').then((gravRes) => {
      results.push(gravRes.result);
      if (gravRes.geo) geoMarkers.push(gravRes.geo);
      onSubResult?.([gravRes.result], undefined, gravRes.geo);
    }),
    runGitHubIntelligence(email, 'email', 'mailaccess').then((ghRes) => {
      results.push(...ghRes.results);
      if (ghRes.geo) geoMarkers.push(ghRes.geo);
      onSubResult?.(ghRes.results, undefined, ghRes.geo);
    }),
    runPublicBreachLookup(email).then((bRes) => {
      breaches = bRes.breaches;
      results.push(...bRes.results);
      onSubResult?.(bRes.results, bRes.breaches);
    }),
    runOpenPgpLookup(email).then((pgpRes) => {
      results.push(pgpRes);
      onSubResult?.([pgpRes]);
    }),
    runHackerNewsEmailLookup(email).then((hnRes) => {
      results.push(hnRes);
      onSubResult?.([hnRes]);
    }),
    isCustomDomain
      ? runLiveThreatIntelChecks(domain, 'domain').then((ti) => {
          results.push(ti.resultItem);
          onSubResult?.([ti.resultItem]);
        })
      : Promise.resolve(),
    slackWorkspacePromise,
    emailDorkPromise,
  ]);

  // Ensure email investigations always surface verified direct avatars (Gravatar/GitHub/Unavatar) when available
  const cleanEmailLower = email.trim().toLowerCase();
  const hasAnyEmailAvatar = results.some((r) => r.status === 'found' && Boolean(r.avatarUrl));
  if (!hasAnyEmailAvatar && cleanEmailLower.includes('@')) {
    const tAv = Date.now();
    const enc = encodeURIComponent(cleanEmailLower);
    const emailHash = md5Hex(cleanEmailLower);
    const emailSha = sha256Hex(cleanEmailLower);
    const [unavJson, unavDirect, gravDirect, gravShaDirect, ghSearchRes] = await Promise.all([
      fetchJsonSafe<{ url?: string }>(`https://unavatar.io/${enc}?json&fallback=false`, 4000),
      probeDirectPublicImageUrl(`https://unavatar.io/${enc}?fallback=false`, 4000),
      probeDirectPublicImageUrl(`https://www.gravatar.com/avatar/${emailHash}?s=256&d=404`, 3500),
      probeDirectPublicImageUrl(`https://www.gravatar.com/avatar/${emailSha}?s=256&d=404`, 3500),
      fetchJsonSafe<{ items?: Array<{ avatar_url?: string; login?: string }> }>(
        `https://api.github.com/search/users?q=${encodeURIComponent(`${cleanEmailLower} in:email`)}&per_page=2`,
        3800,
        { Accept: 'application/vnd.github+json' }
      ),
    ]);
    const ghSearchAvatar = normalizeRemoteImageUrl(ghSearchRes.data?.items?.[0]?.avatar_url);
    const resolvedEmailAvatar =
      normalizeRemoteImageUrl(unavJson.data?.url) ||
      unavDirect ||
      gravDirect ||
      gravShaDirect ||
      ghSearchAvatar;
    if (resolvedEmailAvatar) {
      const sourceLabel =
        ghSearchAvatar && resolvedEmailAvatar === ghSearchAvatar
          ? 'GitHub Email Profile'
          : (gravDirect && resolvedEmailAvatar === gravDirect) ||
            (gravShaDirect && resolvedEmailAvatar === gravShaDirect)
          ? 'Gravatar Avatar'
          : 'Public Avatar Index (Unavatar)';
      const avItem: InvestigationResultItem = {
        id: 'mailaccess-unavatar-email',
        platform: sourceLabel,
        domain:
          sourceLabel === 'GitHub Email Profile'
            ? 'github.com'
            : sourceLabel === 'Gravatar Avatar'
            ? 'gravatar.com'
            : 'unavatar.io',
        category: 'Email & Domain',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'registered',
        handle: cleanEmailLower,
        displayName: ghSearchRes.data?.items?.[0]?.login || cleanEmailLower,
        accountType: 'Public Email Avatar',
        avatarUrl: resolvedEmailAvatar,
        relativeTime: 'Active image',
        displayFields: [
          { label: 'Email', value: cleanEmailLower, kind: 'email', copyable: true },
          { label: 'Image Source', value: resolvedEmailAvatar, kind: 'url', copyable: true },
        ],
        url: resolvedEmailAvatar,
        summary: `Resolved verified public profile image for ${cleanEmailLower}.`,
        durationMs: Date.now() - tAv,
        details: { email: cleanEmailLower, imageUrl: resolvedEmailAvatar },
      };
      results.push(avItem);
      onSubResult?.([avItem]);
    }
  }

  return { results, breaches, geoMarkers };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  let nextIdx = 0;
  const count = Math.max(1, Math.min(concurrency, items.length));

  await Promise.all(
    Array.from({ length: count }, async () => {
      while (true) {
        const idx = nextIdx++;
        if (idx >= items.length) break;
        results[idx] = await worker(items[idx], idx);
      }
    })
  );
  return results;
}

function decodeHtmlMeta(val?: string): string | undefined {
  if (!val) return undefined;
  return val
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    })
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\u003[dD]/g, '=')
    .replace(/\\u003[aA]/g, ':')
    .replace(/\\x2[fF]/gi, '/')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRemoteImageUrl(raw?: string, baseUrl?: string): string | undefined {
  if (!raw || typeof raw !== 'string') return undefined;
  let cleaned = (decodeHtmlMeta(raw) || '').replace(/\\\//g, '/').trim();
  if (!cleaned || cleaned.startsWith('data:') || cleaned.startsWith('blob:')) return undefined;
  if (cleaned.startsWith('//')) {
    cleaned = `https:${cleaned}`;
  } else if (cleaned.startsWith('/') && baseUrl) {
    try {
      cleaned = new URL(cleaned, baseUrl).toString();
    } catch {
      return undefined;
    }
  } else if (!/^https?:\/\//i.test(cleaned) && baseUrl) {
    try {
      cleaned = new URL(cleaned, baseUrl).toString();
    } catch {
      return undefined;
    }
  }
  if (!/^https?:\/\//i.test(cleaned)) return undefined;
  if (
    /opengraph\.githubassets\.com|static\.whatsapp\.net|api\.unavatar\.io\/favicon|\/favicon\.(?:ico|svg|png)|apple-touch-icon|1x1\.|spacer\.gif|default_profile_normal|sticky\/default_profile_images|user-default-pictures|t_logo\.png|wa_logo|rsrc\.php/i.test(
      cleaned
    )
  ) {
    return undefined;
  }
  return cleaned;
}

function extractHtmlProfileMeta(html: string, baseUrl?: string): {
  title?: string;
  ogTitle?: string;
  ogImage?: string;
  ogDesc?: string;
} {
  const headSlice = html.slice(0, 120000);
  const titleM = headSlice.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const ogTitleM =
    headSlice.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    headSlice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i);
  const ogImageM =
    headSlice.match(/<meta[^>]+(?:property|name)=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i) ||
    headSlice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image:secure_url["']/i) ||
    headSlice.match(/<meta[^>]+(?:property|name)=["']og:image:url["'][^>]+content=["']([^"']+)["']/i) ||
    headSlice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image:url["']/i) ||
    headSlice.match(/<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    headSlice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:image["']/i) ||
    headSlice.match(/<meta[^>]+(?:property|name)=["']twitter:image(?::src)?["'][^>]+content=["']([^"']+)["']/i) ||
    headSlice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']twitter:image(?::src)?["']/i) ||
    headSlice.match(/<img[^>]+itemprop=["']image["'][^>]+src=["']([^"']+)["']/i) ||
    headSlice.match(/<img[^>]+src=["']([^"']+)["'][^>]+itemprop=["']image["']/i) ||
    headSlice.match(/<link[^>]+rel=["']image_src["'][^>]+href=["']([^"']+)["']/i) ||
    headSlice.match(/"(?:avatarUrl|avatar_url|profile_pic_url_hd|profile_pic_url)"\s*:\s*"(https?:[^"]+)"/i);
  const ogDescM =
    headSlice.match(/<meta[^>]+(?:property|name)=["'](?:og:description|description)["'][^>]+content=["']([^"']+)["']/i) ||
    headSlice.match(/<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:description|description)["']/i);

  const ogImage = normalizeRemoteImageUrl(ogImageM?.[1], baseUrl);
  return {
    title: decodeHtmlMeta(titleM?.[1]),
    ogTitle: decodeHtmlMeta(ogTitleM?.[1]),
    ogImage,
    ogDesc: decodeHtmlMeta(ogDescM?.[1]),
  };
}

async function fetchJsonTargetSafe<T>(
  url: string,
  timeoutMs = 3800,
  method: 'GET' | 'POST' = 'GET',
  body?: string,
  extraHeaders: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; data?: T; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/json',
        ...extraHeaders,
      },
      ...(method === 'POST' && body ? { body } : {}),
    });
    const status = res.status;
    if (!res.ok) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, status };
    }
    const data = (await res.json()) as T;
    return { ok: true, status, data };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      error: err instanceof Error ? err.message : 'Request failed',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchHtmlProfileSafe(
  url: string,
  timeoutMs = 3800,
  acceptHeader?: string
): Promise<{
  status: number;
  finalUrl: string;
  html: string;
  isDnsMissing: boolean;
  error?: string;
}> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        Accept:
          acceptHeader ||
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    let html = '';
    if (res.status >= 200 && res.status < 400) {
      const reader = res.body?.getReader();
      if (reader) {
        const decoder = new TextDecoder('utf-8', { fatal: false });
        let bytes = 0;
        const MAX_BYTES = 75_000;
        while (bytes < MAX_BYTES) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          bytes += value.byteLength;
          html += decoder.decode(value, { stream: true });
        }
        try {
          await reader.cancel();
        } catch {
          // ignore stream cancel cleanup
        }
      }
    }
    return {
      status: res.status,
      finalUrl: res.url || url,
      html,
      isDnsMissing: false,
    };
  } catch (err) {
    const msg =
      err instanceof Error
        ? `${err.message} ${
            (err as { cause?: { code?: string; message?: string } }).cause?.code || ''
          } ${(err as { cause?: { message?: string } }).cause?.message || ''}`
        : '';
    const isDnsMissing = /ENOTFOUND|EAI_AGAIN|NXDOMAIN|ERR_NAME_NOT_RESOLVED/i.test(msg);
    return {
      status: 0,
      finalUrl: url,
      html: '',
      isDnsMissing,
      error: err instanceof Error ? err.message : 'Timeout',
    };
  } finally {
    clearTimeout(timer);
  }
}

async function runPublicHandleSweep(
  handle: string,
  tool: ToolId,
  targets: PlatformSweepTarget[],
  onItem?: (item: InvestigationResultItem, geo?: GeoMarker | null) => void
): Promise<{ results: InvestigationResultItem[]; geoMarkers: GeoMarker[] }> {
  const clean = handle.replace(/^@/, '').trim();
  const cleanLower = clean.toLowerCase();
  const isEmailTarget = clean.includes('@');
  const isPhoneTarget = !isEmailTarget && /^\+\d{7,15}$/.test(clean);
  const geoMarkers: GeoMarker[] = [];

  const runTargetProbe = async (
    target: PlatformSweepTarget
  ): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const publicUrl = target.urlFn(clean);
    const domainHost = (() => {
      try {
        return new URL(publicUrl).hostname.replace(/^www\./, '');
      } catch {
        return undefined;
      }
    })();

    if (target.customProbeFn) {
      let probed: Awaited<ReturnType<NonNullable<PlatformSweepTarget['customProbeFn']>>>;
      try {
        probed = await target.customProbeFn(clean);
      } catch {
        probed = { status: 'not_checked', httpStatus: 0 };
      }

      const geo =
        probed.status === 'found'
          ? matchLocationToGeo(probed.location, target.platform)
          : null;
      if (geo) geoMarkers.push(geo);

      const resolvedUrl = probed.url || publicUrl;
      const rawFields = [
        probed.id ? { label: 'ID', value: probed.id, copyable: true } : null,
        isEmailTarget
          ? { label: 'Email', value: clean, kind: 'email' as const, copyable: true }
          : isPhoneTarget
          ? { label: 'Phone', value: clean, kind: 'phone' as const, copyable: true }
          : { label: 'Username', value: clean, copyable: true },
        isEmailTarget && probed.verifiedUsername
          ? { label: 'Verified Username', value: probed.verifiedUsername, copyable: true }
          : null,
        probed.displayName && probed.displayName !== clean
          ? { label: 'Name', value: probed.displayName, copyable: true }
          : null,
        probed.location
          ? { label: 'Location', value: probed.location, copyable: true }
          : null,
        probed.createdAt
          ? {
              label: 'Joined At',
              value: probed.createdAt.slice(0, 10),
              kind: 'date' as const,
            }
          : null,
        ...(probed.extraFields || []),
      ].filter((v): v is NonNullable<typeof v> => Boolean(v));
      const seenFieldLabels = new Set<string>();
      const fields = rawFields.filter((f) => {
        const key = f.label.trim().toLowerCase();
        if (seenFieldLabels.has(key)) return false;
        seenFieldLabels.add(key);
        return true;
      });

      const obj: InvestigationResultItem = {
        id: `${tool}-${target.platform.toLowerCase().replace(/\W+/g, '-')}`,
        platform: target.platform,
        domain: domainHost,
        category: target.category,
        tool,
        status: probed.status,
        findingKind: 'registered' as const,
        handle: clean,
        displayName: probed.displayName || clean,
        accountType:
          probed.status === 'found'
            ? isEmailTarget
              ? 'Email-Verified Account'
              : isPhoneTarget
              ? 'Phone-Verified Account'
              : 'Public Account'
            : undefined,
        avatarUrl: probed.avatarUrl,
        firstSeen: probed.createdAt,
        relativeTime:
          probed.status === 'found'
            ? probed.createdAt
              ? formatRelativeTime(probed.createdAt)
              : 'Verified match'
            : probed.status === 'not_found'
            ? 'Not registered'
            : isPhoneTarget
            ? 'OTP / Auth gated'
            : undefined,
        linkedInfo: probed.location ? [probed.location] : undefined,
        displayFields:
          probed.status === 'found'
            ? fields
            : isPhoneTarget
            ? fields.slice(0, 4)
            : undefined,
        statsLine:
          probed.status === 'found' && typeof probed.followers === 'number'
            ? `Followers ${probed.followers}`
            : undefined,
        url:
          probed.status === 'found'
            ? resolvedUrl
            : isPhoneTarget
            ? resolvedUrl
            : undefined,
        summary:
          probed.status === 'found'
            ? probed.bio
              ? probed.bio.slice(0, 220)
              : isEmailTarget
              ? `Verified ${target.platform} registration for ${clean}`
              : isPhoneTarget
              ? `Registered ${target.platform} account confirmed for ${clean}`
              : `Verified public profile at ${resolvedUrl}`
            : probed.status === 'not_found'
            ? probed.bio
              ? probed.bio.slice(0, 220)
              : isEmailTarget || isPhoneTarget
              ? `No ${clean} account registered on ${target.platform}.`
              : `No @${clean} account registered.`
            : probed.bio
            ? probed.bio.slice(0, 220)
            : probed.httpStatus
            ? `Login/WAF gated or anti-enumeration response (HTTP ${probed.httpStatus}).`
            : 'Endpoint login-gated or verification inconclusive.',
        durationMs: Date.now() - t0,
        details:
          probed.status === 'found'
            ? { resolvedUrl, ...probed }
            : { httpStatus: probed.httpStatus, resolvedUrl },
      };
      onItem?.(obj, geo);
      return obj;
    }

    if (target.apiUrlFn) {
      const apiUrl = target.apiUrlFn(clean);
      const res = await fetchJsonTargetSafe<unknown>(
        apiUrl,
        6500,
        target.apiMethod || 'GET',
        target.apiBodyFn ? target.apiBodyFn(clean) : undefined,
        target.apiHeaders || {}
      );

      if (target.extractJson) {
        if (!res.ok) {
          const st = target.extraJsonNotFoundStatuses?.includes(res.status)
            ? 'not_found'
            : classifyHttpStatus(res.status);
          const failObj: InvestigationResultItem = {
            id: `${tool}-${target.platform.toLowerCase().replace(/\W+/g, '-')}`,
            platform: target.platform,
            domain: domainHost,
            category: target.category,
            tool,
            status: st,
            findingKind: 'registered' as const,
            handle: clean,
            displayName: clean,
            summary:
              st === 'not_found'
                ? isEmailTarget
                  ? `No ${clean} account registered.`
                  : `No @${clean} account registered.`
                : `Upstream rate limit or verification gate (HTTP ${res.status || 'timeout'}).`,
            durationMs: Date.now() - t0,
            details: { httpStatus: res.status },
          };
          onItem?.(failObj, null);
          return failObj;
        }

        const extracted = target.extractJson(res.data, clean);
        const geo =
          extracted.status === 'found'
            ? matchLocationToGeo(extracted.location, target.platform)
            : null;
        if (geo) geoMarkers.push(geo);

        const resolvedUrl = extracted.url || publicUrl;
        const fields = [
          extracted.id ? { label: 'ID', value: extracted.id, copyable: true } : null,
          isEmailTarget
            ? { label: 'Email', value: clean, kind: 'email' as const, copyable: true }
            : { label: 'Username', value: clean, copyable: true },
          isEmailTarget && extracted.verifiedUsername
            ? { label: 'Verified Username', value: extracted.verifiedUsername, copyable: true }
            : null,
          extracted.displayName && extracted.displayName !== clean
            ? { label: 'Name', value: extracted.displayName, copyable: true }
            : null,
          extracted.location
            ? { label: 'Location', value: extracted.location, copyable: true }
            : null,
          extracted.createdAt
            ? {
                label: 'Joined At',
                value: extracted.createdAt.slice(0, 10),
                kind: 'date' as const,
              }
            : null,
          ...(extracted.extraFields || []),
        ].filter((v): v is NonNullable<typeof v> => Boolean(v));

        const obj: InvestigationResultItem = {
          id: `${tool}-${target.platform.toLowerCase().replace(/\W+/g, '-')}`,
          platform: target.platform,
          domain: domainHost,
          category: target.category,
          tool,
          status: extracted.status,
          findingKind: 'registered' as const,
          handle: clean,
          displayName: extracted.displayName || clean,
          accountType:
            extracted.status === 'found'
              ? isEmailTarget
                ? 'Email-Verified Account'
                : 'Public Account'
              : undefined,
          avatarUrl: extracted.avatarUrl,
          firstSeen: extracted.createdAt,
          relativeTime:
            extracted.status === 'found'
              ? formatRelativeTime(extracted.createdAt)
              : undefined,
          linkedInfo: extracted.location ? [extracted.location] : undefined,
          displayFields: extracted.status === 'found' ? fields : undefined,
          statsLine:
            extracted.status === 'found' && typeof extracted.followers === 'number'
              ? `Followers ${extracted.followers}`
              : undefined,
          url: extracted.status === 'found' ? resolvedUrl : undefined,
          summary:
            extracted.status === 'found'
              ? extracted.bio
                ? extracted.bio.slice(0, 220)
                : isEmailTarget
                ? `Verified ${target.platform} registration for ${clean}`
                : `Verified public profile at ${resolvedUrl}`
              : extracted.status === 'not_found'
              ? isEmailTarget
                ? `No ${clean} account registered.`
                : `No @${clean} account registered.`
              : `Upstream verification inconclusive (HTTP ${res.status}).`,
          durationMs: Date.now() - t0,
          details:
            extracted.status === 'found'
              ? { apiUrl, resolvedUrl, ...extracted }
              : { httpStatus: res.status },
        };
        onItem?.(obj, geo);
        return obj;
      }

      // Generic JSON handler for standard APIs (DEV.to, HN, HuggingFace, GitLab, Codeberg, Keybase, Reddit, etc.)
      let record: Record<string, unknown> | undefined;
      let resolvedStatus: 'found' | 'not_found' | 'not_checked' | 'error' = res.ok
        ? 'found'
        : classifyHttpStatus(res.status);

      if (res.ok && res.data) {
        if (Array.isArray(res.data)) {
          if (res.data.length === 0 || !res.data[0] || typeof res.data[0] !== 'object') {
            resolvedStatus = 'not_found';
          } else {
            record = res.data[0] as Record<string, unknown>;
          }
        } else if (typeof res.data === 'object') {
          const obj = res.data as Record<string, unknown>;
          if (Array.isArray(obj.them)) {
            if (obj.them.length === 0 || !obj.them[0] || typeof obj.them[0] !== 'object') {
              resolvedStatus = 'not_found';
            } else {
              record = obj.them[0] as Record<string, unknown>;
            }
          } else if (obj.data && typeof obj.data === 'object') {
            record = obj.data as Record<string, unknown>;
          } else {
            record = obj;
          }
        }
      } else if (res.ok && !res.data) {
        resolvedStatus = 'not_found';
      }

      const pictures = record?.pictures as Record<string, { url?: string }> | undefined;
      const nestedUser = (record?.user || record?.owner) as Record<string, unknown> | undefined;
      const profileObj = record?.profile as Record<string, unknown> | undefined;
      const avatarCandidate =
        (typeof record?.avatar_url === 'string' && record.avatar_url) ||
        (typeof record?.avatarUrl === 'string' && record.avatarUrl) ||
        (typeof record?.avatar_large === 'string' && record.avatar_large) ||
        (typeof record?.avatar_hd === 'string' && record.avatar_hd) ||
        (typeof record?.avatar === 'string' && record.avatar) ||
        (typeof record?.profile_pic_url_hd === 'string' && record.profile_pic_url_hd) ||
        (typeof record?.profile_pic_url === 'string' && record.profile_pic_url) ||
        (typeof record?.profile_photo_url === 'string' && record.profile_photo_url) ||
        (typeof record?.profile_image_url === 'string' && record.profile_image_url) ||
        (typeof record?.profileImageUrl === 'string' && record.profileImageUrl) ||
        (typeof record?.profile_image === 'string' && record.profile_image) ||
        (typeof record?.photo_url === 'string' && record.photo_url) ||
        (typeof record?.photoUrl === 'string' && record.photoUrl) ||
        (typeof record?.photo === 'string' && record.photo) ||
        (typeof record?.image_url === 'string' && record.image_url) ||
        (typeof record?.imageUrl === 'string' && record.imageUrl) ||
        (typeof record?.image === 'string' && record.image) ||
        (typeof record?.picture === 'string' && record.picture) ||
        (typeof record?.thumbnail_url === 'string' && record.thumbnail_url) ||
        (typeof record?.icon_img === 'string' && record.icon_img.split('?')[0]) ||
        (typeof nestedUser?.avatar_url === 'string' && nestedUser.avatar_url) ||
        (typeof nestedUser?.profile_image_url === 'string' && nestedUser.profile_image_url) ||
        (typeof nestedUser?.profile_pic_url === 'string' && nestedUser.profile_pic_url) ||
        (typeof profileObj?.avatar_url === 'string' && profileObj.avatar_url) ||
        (typeof profileObj?.avatar === 'string' && profileObj.avatar) ||
        pictures?.primary?.url ||
        undefined;
      const avatarRaw = normalizeRemoteImageUrl(avatarCandidate, publicUrl);

      const displayName =
        (typeof record?.fullname === 'string' && record.fullname) ||
        (typeof record?.name === 'string' && record.name) ||
        (typeof profileObj?.full_name === 'string' && profileObj.full_name) ||
        (typeof record?.username === 'string' && record.username) ||
        (typeof record?.id === 'string' && record.id) ||
        clean;

      let createdAt: string | undefined;
      if (typeof record?.created_at === 'string') {
        createdAt = normalizeIsoDate(record.created_at);
      } else if (typeof record?.createdAt === 'string') {
        createdAt = normalizeIsoDate(record.createdAt);
      } else if (typeof record?.created === 'string') {
        createdAt = normalizeIsoDate(record.created);
      } else if (typeof record?.joined_at === 'string') {
        createdAt = normalizeIsoDate(record.joined_at);
      } else if (typeof record?.createdAt === 'number') {
        createdAt = new Date(record.createdAt).toISOString();
      } else if (typeof record?.created_utc === 'number') {
        createdAt = new Date(record.created_utc * 1000).toISOString();
      } else if (typeof record?.created === 'number') {
        createdAt = new Date(record.created * 1000).toISOString();
      } else if (typeof record?.joined === 'number') {
        createdAt = new Date(record.joined * 1000).toISOString();
      }

      const loc =
        (typeof record?.location === 'string' && record.location) ||
        (typeof profileObj?.location === 'string' && profileObj.location) ||
        undefined;
      const geo =
        resolvedStatus === 'found'
          ? matchLocationToGeo(loc, target.platform)
          : null;
      if (geo) geoMarkers.push(geo);
      const rawId =
        (typeof record?.id === 'string' && record.id) ||
        (typeof record?.id === 'number' && String(record.id)) ||
        (typeof record?.player_id === 'number' && String(record.player_id)) ||
        (typeof record?.uid === 'string' && record.uid) ||
        undefined;

      const stateStr =
        (typeof record?.state === 'string' && record.state) ||
        (typeof record?.status === 'string' && record.status) ||
        (typeof record?.title === 'string' && record.title) ||
        undefined;

      const followerNum =
        typeof record?.followers === 'number'
          ? record.followers
          : typeof record?.numFollowers === 'number'
          ? record.numFollowers
          : undefined;
      const karmaNum =
        typeof record?.total_karma === 'number'
          ? record.total_karma
          : typeof record?.karma === 'number'
          ? record.karma
          : undefined;

      const dynamicFields = [
        rawId ? { label: 'ID', value: rawId, copyable: true } : null,
        isEmailTarget
          ? { label: 'Email', value: clean, kind: 'email' as const, copyable: true }
          : { label: 'Username', value: clean, copyable: true },
        displayName && displayName !== clean
          ? { label: 'Name', value: displayName, copyable: true }
          : null,
        stateStr ? { label: 'Account Status', value: stateStr } : null,
        loc ? { label: 'Location', value: loc, copyable: true } : null,
        createdAt
          ? { label: 'Joined At', value: createdAt.slice(0, 10), kind: 'date' as const }
          : null,
      ].filter((v): v is NonNullable<typeof v> => Boolean(v));

      const statsParts = [
        typeof karmaNum === 'number' ? `Karma ${karmaNum}` : null,
        typeof followerNum === 'number' ? `Followers ${followerNum}` : null,
        typeof record?.numModels === 'number' ? `Models ${record.numModels}` : null,
      ].filter((v): v is string => Boolean(v));

      const itemObj: InvestigationResultItem = {
        id: `${tool}-${target.platform.toLowerCase().replace(/\W+/g, '-')}`,
        platform: target.platform,
        domain: domainHost,
        category: target.category,
        tool,
        status: resolvedStatus,
        findingKind: 'registered' as const,
        handle: clean,
        displayName,
        accountType: isEmailTarget ? 'Email-Verified Account' : 'Public Account',
        avatarUrl: avatarRaw,
        firstSeen: createdAt,
        relativeTime: formatRelativeTime(createdAt),
        linkedInfo: loc ? [loc] : undefined,
        displayFields: resolvedStatus === 'found' ? dynamicFields : undefined,
        statsLine:
          resolvedStatus === 'found' && statsParts.length > 0
            ? statsParts.join(' · ')
            : undefined,
        url: resolvedStatus === 'found' ? publicUrl : undefined,
        summary:
          resolvedStatus === 'found'
            ? `Verified public profile at ${publicUrl}`
            : resolvedStatus === 'not_found'
            ? isEmailTarget
              ? `No ${clean} account registered.`
              : `No @${clean} account registered.`
            : `Upstream rate limit or verification gate (HTTP ${res.status || 'timeout'}).`,
        durationMs: Date.now() - t0,
        details: resolvedStatus === 'found' ? record : { httpStatus: res.status },
      };
      onItem?.(itemObj, geo);
      return itemObj;
    }

    // Verified HTML / Endpoint check (prevents HTTP 200 SPA false positives)
    const htmlCheck = target.htmlCheck;
    const check = await fetchHtmlProfileSafe(
      publicUrl,
      4500,
      htmlCheck?.acceptHeader
    );

    let status: 'found' | 'not_found' | 'not_checked' | 'error';
    if (check.isDnsMissing && htmlCheck?.isSubdomainHost) {
      status = 'not_found';
    } else if (htmlCheck?.extraNotFoundStatuses?.includes(check.status)) {
      status = 'not_found';
    } else if (check.status === 202 && check.html.trim().length < 120) {
      status = 'not_checked';
    } else if (check.status >= 200 && check.status < 300) {
      const htmlLower = check.html.toLowerCase();
      const finalLower = check.finalUrl.toLowerCase();

      const rejectedRedirect = htmlCheck?.rejectRedirectSubstrings?.some((sub) =>
        finalLower.includes(sub.toLowerCase())
      );

      const cfBlocked =
        htmlLower.includes('just a moment...') ||
        htmlLower.includes('cf-browser-verification') ||
        htmlLower.includes('attention required! | cloudflare') ||
        htmlLower.includes('enable javascript and cookies to continue');

      const visibleHtmlLower = check.html
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
        .toLowerCase();

      const explicitJsonMarkers = new Set([
        '"status":404',
        '"statuscode":404',
        '"error":"not_found"',
        'error.not_found',
      ]);

      const allNotFoundMarkers = [
        ...(htmlCheck?.notFoundMarkers || []),
        ...GENERIC_404_MARKERS,
      ];
      const hitNotFound = allNotFoundMarkers.some((m) => {
        const needle = m.toLowerCase();
        return explicitJsonMarkers.has(needle)
          ? htmlLower.includes(needle)
          : visibleHtmlLower.includes(needle);
      });

      let matchedPositive = true;
      if (htmlCheck?.foundMarkers) {
        if (typeof htmlCheck.foundMarkers === 'function') {
          matchedPositive = htmlCheck.foundMarkers(
            htmlLower,
            check.html,
            cleanLower,
            finalLower
          );
        } else {
          matchedPositive = htmlCheck.foundMarkers.some((m) =>
            htmlLower.includes(m.toLowerCase())
          );
        }
      }

      if (cfBlocked) {
        status = 'not_checked';
      } else if (rejectedRedirect || hitNotFound || !matchedPositive) {
        status = 'not_found';
      } else {
        status = 'found';
      }
    } else {
      status = classifyHttpStatus(check.status);
    }

    const meta =
      status === 'found'
        ? extractHtmlProfileMeta(check.html, check.finalUrl || publicUrl)
        : {};
    const resolvedTitle = meta.ogTitle || meta.title;
    const displayName =
      resolvedTitle && resolvedTitle.length < 90 ? resolvedTitle : clean;

    const fallbackObj: InvestigationResultItem = {
      id: `${tool}-${target.platform.toLowerCase().replace(/\W+/g, '-')}`,
      platform: target.platform,
      domain: domainHost,
      category: target.category,
      tool,
      status,
      findingKind: 'registered' as const,
      handle: clean,
      displayName,
      accountType: status === 'found' ? 'Public Profile' : undefined,
      avatarUrl: status === 'found' ? meta.ogImage : undefined,
      relativeTime: status === 'found' ? 'Active endpoint' : undefined,
      displayFields:
        status === 'found'
          ? [
              isEmailTarget
                ? { label: 'Email', value: clean, kind: 'email' as const, copyable: true }
                : { label: 'Username', value: clean, copyable: true },
              { label: 'Endpoint Status', value: `HTTP ${check.status}` },
              ...(resolvedTitle && resolvedTitle !== clean
                ? [{ label: 'Page Title', value: resolvedTitle, copyable: true }]
                : []),
              { label: 'Public Profile', value: 'Yes', kind: 'boolean' as const },
            ]
          : undefined,
      url: status === 'found' ? check.finalUrl || publicUrl : undefined,
      summary:
        status === 'found'
          ? meta.ogDesc
            ? meta.ogDesc.slice(0, 200)
            : `Verified public profile endpoint (HTTP ${check.status})`
          : status === 'not_found'
          ? 'Not registered on this platform.'
          : `Bot gate or inconclusive check (HTTP ${check.status || 'timeout'}).`,
      durationMs: Date.now() - t0,
      details: {
        httpStatus: check.status,
        checkedUrl: publicUrl,
        finalUrl: check.finalUrl,
        ...(meta.title ? { pageTitle: meta.title } : {}),
      },
    };
    onItem?.(fallbackObj);
    return fallbackObj;
  };

  let results: InvestigationResultItem[];
  if (targets.length > 200) {
    const httpAndLiveTargets = targets.filter(
      (t) =>
        t.isLiveVerification ||
        Boolean(t.apiUrlFn) ||
        Boolean(t.htmlCheck) ||
        !t.customProbeFn
    );
    const passiveDnsTargets = targets.filter(
      (t) =>
        !(
          t.isLiveVerification ||
          Boolean(t.apiUrlFn) ||
          Boolean(t.htmlCheck) ||
          !t.customProbeFn
        )
    );
    const liveResults = await mapWithConcurrency(httpAndLiveTargets, 8, runTargetProbe);
    const bulkResults = await mapWithConcurrency(passiveDnsTargets, 120, runTargetProbe);
    results = [...liveResults, ...bulkResults];
  } else {
    results = await mapWithConcurrency(targets, 8, runTargetProbe);
  }

  return { results, geoMarkers };
}

const COUNTRY_CALLING_MAP: CountryCallingMeta[] = [
  { prefix: '971', iso2: 'AE', country: 'United Arab Emirates (+971)', region: 'Middle East', lat: 25.2, lng: 55.27 },
  { prefix: '966', iso2: 'SA', country: 'Saudi Arabia (+966)', region: 'Middle East', lat: 24.71, lng: 46.67 },
  { prefix: '880', iso2: 'BD', country: 'Bangladesh (+880)', region: 'South Asia', lat: 23.81, lng: 90.41 },
  { prefix: '977', iso2: 'NP', country: 'Nepal (+977)', region: 'South Asia', lat: 27.71, lng: 85.32 },
  { prefix: '852', iso2: 'HK', country: 'Hong Kong (+852)', region: 'East Asia', lat: 22.32, lng: 114.17 },
  { prefix: '353', iso2: 'IE', country: 'Ireland (+353)', region: 'Western Europe', lat: 53.35, lng: -6.26 },
  { prefix: '351', iso2: 'PT', country: 'Portugal (+351)', region: 'Western Europe', lat: 38.72, lng: -9.14 },
  { prefix: '358', iso2: 'FI', country: 'Finland (+358)', region: 'Nordics', lat: 60.17, lng: 24.94 },
  { prefix: '91', iso2: 'IN', country: 'India (+91)', region: 'India / South Asia', lat: 20.59, lng: 78.96 },
  { prefix: '92', iso2: 'PK', country: 'Pakistan (+92)', region: 'South Asia', lat: 33.68, lng: 73.04 },
  { prefix: '94', iso2: 'LK', country: 'Sri Lanka (+94)', region: 'South Asia', lat: 6.93, lng: 79.86 },
  { prefix: '65', iso2: 'SG', country: 'Singapore (+65)', region: 'Southeast Asia', lat: 1.35, lng: 103.82 },
  { prefix: '60', iso2: 'MY', country: 'Malaysia (+60)', region: 'Southeast Asia', lat: 3.14, lng: 101.69 },
  { prefix: '62', iso2: 'ID', country: 'Indonesia (+62)', region: 'Southeast Asia', lat: -6.2, lng: 106.85 },
  { prefix: '66', iso2: 'TH', country: 'Thailand (+66)', region: 'Southeast Asia', lat: 13.76, lng: 100.5 },
  { prefix: '84', iso2: 'VN', country: 'Vietnam (+84)', region: 'Southeast Asia', lat: 21.03, lng: 105.85 },
  { prefix: '63', iso2: 'PH', country: 'Philippines (+63)', region: 'Southeast Asia', lat: 14.6, lng: 120.98 },
  { prefix: '81', iso2: 'JP', country: 'Japan (+81)', region: 'East Asia', lat: 35.68, lng: 139.69 },
  { prefix: '82', iso2: 'KR', country: 'South Korea (+82)', region: 'East Asia', lat: 37.57, lng: 126.98 },
  { prefix: '86', iso2: 'CN', country: 'China (+86)', region: 'East Asia', lat: 39.9, lng: 116.4 },
  { prefix: '61', iso2: 'AU', country: 'Australia (+61)', region: 'Oceania', lat: -33.87, lng: 151.21 },
  { prefix: '64', iso2: 'NZ', country: 'New Zealand (+64)', region: 'Oceania', lat: -36.85, lng: 174.76 },
  { prefix: '44', iso2: 'GB', country: 'United Kingdom (+44)', region: 'United Kingdom', lat: 51.51, lng: -0.13 },
  { prefix: '49', iso2: 'DE', country: 'Germany (+49)', region: 'Central Europe', lat: 52.52, lng: 13.41 },
  { prefix: '33', iso2: 'FR', country: 'France (+33)', region: 'Western Europe', lat: 48.86, lng: 2.35 },
  { prefix: '39', iso2: 'IT', country: 'Italy (+39)', region: 'Southern Europe', lat: 41.9, lng: 12.5 },
  { prefix: '34', iso2: 'ES', country: 'Spain (+34)', region: 'Southern Europe', lat: 40.42, lng: -3.7 },
  { prefix: '31', iso2: 'NL', country: 'Netherlands (+31)', region: 'Western Europe', lat: 52.37, lng: 4.9 },
  { prefix: '41', iso2: 'CH', country: 'Switzerland (+41)', region: 'Central Europe', lat: 47.37, lng: 8.54 },
  { prefix: '46', iso2: 'SE', country: 'Sweden (+46)', region: 'Nordics', lat: 59.33, lng: 18.07 },
  { prefix: '47', iso2: 'NO', country: 'Norway (+47)', region: 'Nordics', lat: 59.91, lng: 10.75 },
  { prefix: '55', iso2: 'BR', country: 'Brazil (+55)', region: 'South America', lat: -23.55, lng: -46.63 },
  { prefix: '52', iso2: 'MX', country: 'Mexico (+52)', region: 'North America', lat: 19.43, lng: -99.13 },
  { prefix: '27', iso2: 'ZA', country: 'South Africa (+27)', region: 'Southern Africa', lat: -26.2, lng: 28.04 },
  { prefix: '972', iso2: 'IL', country: 'Israel (+972)', region: 'Middle East', lat: 32.09, lng: 34.78 },
  { prefix: '1', iso2: 'US', country: 'United States / Canada (+1)', region: 'North America', lat: 37.09, lng: -95.71 },
];

async function runPhoneInfogaScanner(
  parsed: NormalizedPhoneTarget,
  enableGoogleDorking = false
): Promise<InvestigationResultItem[]> {
  const t0 = Date.now();
  const { cleanDigits, national, e164, international, iso2, validLength } = parsed;

  // OVH public telecom VoIP zone lookup (European countries supported by OVH)
  let ovhMatch: string | null = null;
  const ovhSupported = new Set(['FR', 'BE', 'DE', 'ES', 'GB', 'CH', 'IE', 'IT', 'PT', 'NL']);
  const ovhPromise = (async () => {
    if (ovhSupported.has(iso2)) {
      const ovhRes = await fetchJsonSafe<Array<{ city?: string; zne?: string; zipCode?: string }>>(
        `https://api.ovh.com/1.0/telephony/number/detailedZones?country=${iso2.toLowerCase()}`,
        3800
      );
      if (ovhRes.ok && Array.isArray(ovhRes.data)) {
        const hit = ovhRes.data.find((z) => z.zne && national.startsWith(z.zne));
        if (hit) {
          ovhMatch = `${hit.city || 'OVH Zone'}${hit.zipCode ? ` (${hit.zipCode})` : ''}`;
        }
      }
    }
  })();

  // Optional Numverify carrier verification when NUMVERIFY_API_KEY is configured
  let numverifyData: Record<string, unknown> | undefined;
  const numverifyKey = process.env.NUMVERIFY_API_KEY?.trim();
  const numverifyPromise = (async () => {
    if (numverifyKey) {
      const nvRes = await fetchJsonSafe<Record<string, unknown>>(
        `https://apilayer.net/api/validate?access_key=${encodeURIComponent(numverifyKey)}&number=${encodeURIComponent(cleanDigits)}&format=1`,
        4200
      );
      if (nvRes.ok && nvRes.data && nvRes.data.valid !== undefined) {
        numverifyData = nvRes.data;
      }
    }
  })();

  // Opt-in only: deep Google Dorking & live web/file/record search
  const dorkPromise = enableGoogleDorking
    ? runDeepGoogleDorking({
        target: e164,
        targetType: 'phone',
        mode: 'full',
      })
    : Promise.resolve(null);

  const [, , dorkReport] = await Promise.all([ovhPromise, numverifyPromise, dorkPromise]);

  const dorkArtifacts: ArtifactItem[] = dorkReport
    ? [
        ...dorkReport.hits.slice(0, 30).map((hit) => ({
      id: `phone-hit-${hit.id}`,
      type: 'profile_signal' as const,
      title: `[${hit.fileType}] ${hit.title}`,
      subtitle: `${hit.category} · ${hit.domain} (${hit.sourceEngine})`,
      url: hit.url,
      timestamp: hit.timestamp,
      summary: hit.snippet.slice(0, 300),
      details: {
        category: hit.category,
        fileType: hit.fileType,
        domain: hit.domain,
        sourceEngine: hit.sourceEngine,
        matchedQuery: hit.matchedQuery,
      },
    })),
    ...dorkReport.queries.map((q) => ({
      id: `phoneinfoga-${q.id}`,
      type: 'profile_signal' as const,
      title: `Google Dork: ${q.title}`,
      subtitle: `${q.category} · ${q.description}`,
      url: q.googleUrl,
      summary: q.query,
      details: {
        dorkQuery: q.query,
        category: q.category,
        searchEngine: 'Google Search',
      },
    })),
      ]
    : [];

  const items: InvestigationResultItem[] = [];

  if (ovhMatch) {
    items.push({
      id: 'phoneinfoga-ovh-voip',
      platform: 'OVH VoIP Registry',
      domain: 'ovh.com',
      category: 'Phone & Telecom',
      tool: 'phoneinfoga',
      status: 'found',
      findingKind: 'infrastructure',
      handle: e164,
      displayName: `OVH Zone: ${ovhMatch}`,
      accountType: 'Live Telecom Registry Hit',
      relativeTime: ovhMatch,
      url: 'https://api.ovh.com/1.0/telephony/number/detailedZones',
      summary: `Live OVH European VoIP zone match confirmed for ${international}: ${ovhMatch}.`,
      durationMs: Date.now() - t0,
      details: { e164, ovhZone: ovhMatch },
    });
  }

  if (numverifyData?.valid === true) {
    items.push({
      id: 'phoneinfoga-numverify-carrier',
      platform: 'Numverify Line Verification',
      domain: 'numverify.com',
      category: 'Phone & Telecom',
      tool: 'phoneinfoga',
      status: 'found',
      findingKind: 'infrastructure',
      handle: e164,
      displayName: String(numverifyData.carrier || numverifyData.line_type || international),
      accountType: 'Live HLR / Carrier API',
      summary: `Numverify confirmed ${String(numverifyData.line_type || 'line')} (${String(numverifyData.carrier || 'carrier verified')}) in ${String(numverifyData.location || parsed.countryName)}.`,
      durationMs: Date.now() - t0,
      details: { e164, numverify: numverifyData },
    });
  }

  if (dorkReport && dorkReport.hits.length > 0) {
    const hasExposedFilesOrCode =
      dorkReport.summary.filesAndDocs > 0 || dorkReport.summary.codeAndPastes > 0;
    const topFormats = Array.from(
      new Set(dorkReport.hits.map((h) => h.fileType))
    ).slice(0, 5);

    items.push({
      id: 'phoneinfoga-live-web-dorks',
      platform: 'Google Web & Document Index',
      domain: dorkReport.hits[0]?.domain || 'google.com',
      category: 'Breach & Exposure',
      tool: 'phoneinfoga',
      status: 'found',
      findingKind: hasExposedFilesOrCode ? 'leaked' : 'registered',
      handle: e164,
      displayName: `${dorkReport.hits.length} Public Web/File Match${dorkReport.hits.length === 1 ? '' : 'es'}`,
      accountType: `Formats: ${topFormats.join(', ')}`,
      relativeTime: `${dorkReport.summary.filesAndDocs} file(s)`,
      linkedInfo: [
        `${dorkReport.summary.filesAndDocs} Files & Docs`,
        `${dorkReport.summary.codeAndPastes} Code & Pastes`,
        `${dorkReport.summary.websitesAndMentions} Websites`,
        `${dorkReport.summary.archivesAndRecords} Archives`,
      ],
      displayFields: [
        { label: 'Phone', value: e164, kind: 'phone', copyable: true },
        { label: 'Live Web Matches', value: String(dorkReport.hits.length) },
        { label: 'Files & Documents', value: String(dorkReport.summary.filesAndDocs) },
        { label: 'Code & Pastes', value: String(dorkReport.summary.codeAndPastes) },
        { label: 'Top Source Domain', value: dorkReport.hits[0]?.domain || '—' },
      ],
      statsLine: `${dorkReport.hits.length} live matches · ${dorkReport.enginesQueried.join(', ')}`,
      url: dorkReport.hits[0]?.url || dorkReport.queries[0]?.googleUrl,
      summary: `Surfaced ${dorkReport.hits.length} live public record(s) (${dorkReport.summary.filesAndDocs} files/docs, ${dorkReport.summary.codeAndPastes} code/pastes, ${dorkReport.summary.websitesAndMentions} websites) mentioning ${e164}.`,
      durationMs: Date.now() - t0,
      artifacts: dorkArtifacts,
      details: { dorkReport },
    });
  } else if (dorkReport) {
    items.push({
      id: 'phoneinfoga-live-web-dorks',
      platform: 'Google Web & Document Index',
      domain: 'google.com',
      category: 'Breach & Exposure',
      tool: 'phoneinfoga',
      status: validLength ? 'not_found' : 'error',
      findingKind: 'leaked',
      handle: e164,
      displayName: 'No Public Web/Document Mentions',
      relativeTime: `${dorkReport.queries.length} dorks queried`,
      url: dorkReport.queries[0]?.googleUrl,
      summary: `No indexed public web pages, PDFs, or spreadsheets surfaced for ${e164} across ${dorkReport.queries.length} OSINT dork operators.`,
      durationMs: Date.now() - t0,
      artifacts: dorkArtifacts,
      details: {
        e164,
        dorkReport,
        dorkSummary: dorkReport.summary,
        variantsUsed: dorkReport.variantsUsed,
        enginesQueried: dorkReport.enginesQueried,
      },
    });
  } else {
    items.push({
      id: 'phoneinfoga-opt-in-dork',
      platform: 'PhoneInfoga (Google Dorking Opt-In)',
      domain: 'google.com',
      category: 'Phone & Telecom',
      tool: 'phoneinfoga',
      status: validLength ? 'not_checked' : 'error',
      findingKind: 'infrastructure',
      handle: e164,
      displayName: validLength ? 'Telecom Check Complete (Dorking Off)' : 'Invalid Phone Format',
      relativeTime: 'Opt-in only',
      summary: validLength
        ? `Phone number ${international} normalized cleanly and telecom checks finished. Deep Google Dorking is off by default — enable it on launch or click "Show Google Dorking Results" to query public web, file, and code indexes.`
        : `Number "${parsed.raw}" has invalid length (${cleanDigits.length} digits).`,
      durationMs: Date.now() - t0,
      details: { e164, dorkingSkipped: true },
    });
  }

  return items;
}

async function runPhoneIntelligence(
  phone: string,
  tools: ToolId[],
  enableGoogleDorking = false,
  onModuleDone?: (
    items: InvestigationResultItem[],
    exec: ToolExecutionState,
    geo?: GeoMarker | null,
    breaches?: BreachedAccountItem[]
  ) => void
): Promise<{
  results: InvestigationResultItem[];
  executions: ToolExecutionState[];
  geoMarkers: GeoMarker[];
  breaches: BreachedAccountItem[];
}> {
  const parsed = normalizePhoneTarget(phone, COUNTRY_CALLING_MAP);
  const indianInfo =
    parsed.iso2 === 'IN' ? resolveIndianTelecomSeries(parsed.national) : null;

  const geoMarkers: GeoMarker[] = indianInfo
    ? [
        {
          id: `geo-phone-in-${indianInfo.prefixMatched}`,
          label: `${indianInfo.city} (${indianInfo.circle})`,
          region: `${indianInfo.circle} · ${indianInfo.carrier}`,
          country: 'India',
          lat: indianInfo.lat,
          lng: indianInfo.lng,
          source: `TRAI Circle (${indianInfo.prefixMatched}xxxx)`,
          count: 1,
        },
      ]
    : parsed.matchedCountry
    ? [
        {
          id: `geo-phone-${parsed.matchedCountry.prefix}`,
          label: parsed.matchedCountry.country,
          region: parsed.matchedCountry.region,
          country: parsed.matchedCountry.country,
          lat: parsed.matchedCountry.lat,
          lng: parsed.matchedCountry.lng,
          source: 'Country Calling Prefix',
          count: 1,
        },
      ]
    : [];

  const allResults: InvestigationResultItem[] = [];
  const executions: ToolExecutionState[] = [];
  const allBreaches: BreachedAccountItem[] = [];

  await Promise.all(
    tools.map(async (tool) => {
      const t0 = Date.now();
      if (tool === 'mailaccess') {
        const abstractKey = process.env.ABSTRACT_PHONE_API_KEY?.trim();
        const veriphoneKey = process.env.VERIPHONE_API_KEY?.trim();
        const truecallerToken = process.env.TRUECALLER_TOKEN?.trim();

        const [exposureRes, abstractRes, veriphoneRes, truecallerRes] = await Promise.all([
          runPhoneExposureChecks(parsed),
          abstractKey
            ? fetchJsonSafe<{
                valid?: boolean;
                carrier?: string;
                type?: string;
                location?: string;
                country?: { name?: string; code?: string };
              }>(
                `https://phonevalidation.abstractapi.com/v1/?api_key=${encodeURIComponent(
                  abstractKey
                )}&phone=${encodeURIComponent(parsed.cleanDigits)}`,
                4500
              )
            : Promise.resolve(null),
          veriphoneKey
            ? fetchJsonSafe<{
                phone_valid?: boolean;
                carrier?: string;
                phone_type?: string;
                phone_region?: string;
                country?: string;
              }>(
                `https://api.veriphone.io/v2/verify?phone=${encodeURIComponent(
                  parsed.e164
                )}&key=${encodeURIComponent(veriphoneKey)}`,
                4500
              )
            : Promise.resolve(null),
          truecallerToken
            ? fetchJsonSafe<{
                data?: Array<{
                  name?: string;
                  image?: string;
                  profilePicture?: string;
                  addresses?: Array<{ city?: string; countryCode?: string }>;
                  phones?: Array<{ carrier?: string; numberType?: string }>;
                  internetAddresses?: Array<{ id?: string; service?: string }>;
                }>;
              }>(
                `https://search5-noneu.truecaller.com/v2/search?q=${encodeURIComponent(
                  parsed.cleanDigits
                )}&countryCode=${encodeURIComponent(
                  parsed.iso2 === 'INTL' ? 'IN' : parsed.iso2
                )}&type=4&encoding=json`,
                5000,
                { Authorization: `Bearer ${truecallerToken}` }
              )
            : Promise.resolve(null),
        ]);

        const abstractData = abstractRes?.ok ? abstractRes.data : undefined;
        const veriphoneData = veriphoneRes?.ok ? veriphoneRes.data : undefined;
        const tcFirst = truecallerRes?.ok ? truecallerRes.data?.data?.[0] : undefined;
        const noApiTc = exposureRes.results.find((r) => r.id === 'mailaccess-truecaller-noapi');
        const noApiTcName =
          typeof (noApiTc?.details as { extractedCallerName?: unknown } | undefined)?.extractedCallerName === 'string'
            ? (noApiTc?.details as { extractedCallerName: string }).extractedCallerName
            : undefined;

        const resolvedCarrier =
          tcFirst?.phones?.[0]?.carrier ||
          abstractData?.carrier ||
          veriphoneData?.carrier ||
          indianInfo?.carrier ||
          'International Carrier';
        const resolvedCallerName = tcFirst?.name || noApiTcName;
        const resolvedCallerAvatar = normalizeRemoteImageUrl(
          tcFirst?.image || tcFirst?.profilePicture
        );
        const resolvedEmailPivot = tcFirst?.internetAddresses?.find(
          (a) => a.service === 'email' && a.id
        )?.id;
        const resolvedLineType =
          tcFirst?.phones?.[0]?.numberType ||
          abstractData?.type ||
          veriphoneData?.phone_type ||
          (indianInfo ? 'Mobile (TRAI MSC)' : 'Mobile / Fixed Line');
        const resolvedLocation =
          tcFirst?.addresses?.[0]?.city ||
          abstractData?.location ||
          veriphoneData?.phone_region ||
          (indianInfo ? `${indianInfo.city}, ${indianInfo.circle}` : parsed.countryName);

        const extraCarrierGeo =
          tcFirst?.addresses?.[0]?.city
            ? matchLocationToGeo(tcFirst.addresses[0].city, 'Truecaller API')
            : null;
        if (extraCarrierGeo) geoMarkers.push(extraCarrierGeo);

        const carrierItem: InvestigationResultItem = {
          id: 'mailaccess-telecom-carrier',
          platform: indianInfo ? `Telecom & Carrier (${indianInfo.circle})` : 'Telecom & Carrier Plan',
          domain: 'trai.gov.in',
          category: 'Phone & Telecom',
          tool: 'mailaccess',
          status: parsed.validLength ? 'found' : 'error',
          findingKind: 'infrastructure',
          handle: parsed.e164,
          displayName: resolvedCallerName
            ? `${resolvedCallerName} · ${resolvedCarrier}`
            : indianInfo
            ? `${indianInfo.carrier} · ${indianInfo.circle}`
            : `${parsed.countryName} (${parsed.e164})`,
          accountType: indianInfo ? 'TRAI MSC Circle Allotment' : 'E.164 Number Plan',
          avatarUrl: resolvedCallerAvatar,
          relativeTime: indianInfo
            ? `Prefix ${indianInfo.prefixMatched}xxxx`
            : parsed.iso2,
          linkedInfo: [
            resolvedCarrier,
            resolvedLocation,
            resolvedLineType,
            indianInfo ? 'MNP Portability Aware' : undefined,
            resolvedEmailPivot ? `Email: ${resolvedEmailPivot}` : undefined,
          ].filter((v): v is string => Boolean(v)),
          displayFields: [
            { label: 'E.164 Format', value: parsed.e164, kind: 'phone' as const, copyable: true },
            { label: 'International', value: parsed.international, copyable: true },
            { label: 'Original Carrier', value: resolvedCarrier },
            ...(resolvedEmailPivot
              ? [{ label: 'Linked Email', value: resolvedEmailPivot, kind: 'email' as const, copyable: true }]
              : []),
            indianInfo
              ? { label: 'TRAI Circle', value: `${indianInfo.circle} (${indianInfo.city})` }
              : { label: 'Country / Region', value: `${parsed.countryName} (${parsed.region})` },
            { label: 'Line / Signal', value: resolvedLineType },
            ...(resolvedCallerName
              ? [{ label: 'Caller Identity', value: resolvedCallerName, copyable: true }]
              : []),
          ].slice(0, 5),
          statsLine: `Wa.me & t.me pivots ready · ${parsed.validLength ? 'Valid E.164 length' : 'Invalid digit length'}`,
          url: `https://wa.me/${parsed.cleanDigits}`,
          summary: indianInfo
            ? `${parsed.international} maps to ${resolvedCarrier} (${indianInfo.circle} circle, hub: ${indianInfo.city}, 4-digit MSC ${indianInfo.prefixMatched}xxxx; subject to MNP porting).`
            : parsed.validLength
            ? `${parsed.international} normalized under ${parsed.countryName} (${parsed.region}) numbering plan (${resolvedLineType}).`
            : `Number "${phone}" has invalid length (${parsed.cleanDigits.length} digits).`,
          durationMs: Date.now() - t0,
          artifacts: [
            {
              id: 'phone-pivot-whatsapp',
              type: 'profile_signal',
              title: 'WhatsApp Click-to-Chat Pivot',
              subtitle: `wa.me/${parsed.cleanDigits}`,
              url: `https://wa.me/${parsed.cleanDigits}`,
              summary: `Direct WhatsApp verification link for ${parsed.international}.`,
              details: { e164: parsed.e164, url: `https://wa.me/${parsed.cleanDigits}` },
            },
            {
              id: 'phone-pivot-telegram',
              type: 'profile_signal',
              title: 'Telegram Phone Resolve Pivot',
              subtitle: `t.me/+${parsed.cleanDigits}`,
              url: `https://t.me/+${parsed.cleanDigits}`,
              summary: `Direct Telegram profile link for ${parsed.international}.`,
              details: { e164: parsed.e164, url: `https://t.me/+${parsed.cleanDigits}` },
            },
          ],
          details: {
            ...parsed,
            indianTelecom: indianInfo,
            resolvedCarrier,
            resolvedLineType,
            resolvedCallerName: resolvedCallerName || null,
            resolvedLocation,
            mnpNote: indianInfo
              ? 'Series prefix reflects original TRAI MSC allotment; subscriber may have ported carrier via MNP.'
              : undefined,
            liveApis: {
              abstract: Boolean(abstractData),
              veriphone: Boolean(veriphoneData),
              truecaller: Boolean(tcFirst),
            },
          },
        };

        const items = [carrierItem, ...exposureRes.results];
        const { breaches } = exposureRes;
        const foundCount = items.filter((i) => i.status === 'found').length;
        const errCount = items.filter((i) => i.status === 'error').length;
        const exec: ToolExecutionState = {
          tool,
          status: errCount > 0 && foundCount === 0 ? 'warning' : 'completed',
          progress: 100,
          durationMs: Date.now() - t0,
          platformsChecked: items.length,
          foundCount,
          errorCount: errCount,
          message: `Telecom carrier + ${exposureRes.results.length} breach/public citation sources (${foundCount} hit(s), ${breaches.length} breach(es))`,
        };
        allResults.push(...items);
        allBreaches.push(...breaches);
        executions.push(exec);
        onModuleDone?.(items, exec, extraCarrierGeo || geoMarkers[0], breaches);
      } else if (tool === 'phoneinfoga') {
        const items = await runPhoneInfogaScanner(parsed, enableGoogleDorking);
        const foundCount = items.filter((i) => i.status === 'found').length;
        const errCount = items.filter((i) => i.status === 'error').length;
        const exec: ToolExecutionState = {
          tool,
          status: parsed.validLength && errCount === 0 ? 'completed' : foundCount > 0 ? 'warning' : 'error',
          progress: 100,
          durationMs: Date.now() - t0,
          platformsChecked: items.length,
          foundCount,
          errorCount: errCount,
          message: enableGoogleDorking
            ? `Indexed web/file & dork audit completed (${foundCount} hit(s))`
            : `Telecom/VoIP audit completed (Google Dorking opt-in off)`,
        };
        allResults.push(...items);
        executions.push(exec);
        onModuleDone?.(items, exec, geoMarkers[0]);
      } else if (tool === 'ignorant') {
        const phoneTargets = buildPhoneServiceProbes(parsed);
        let checked = 0;
        let foundSoFar = 0;

        const sweep = await runPublicHandleSweep(
          parsed.e164,
          'ignorant',
          phoneTargets,
          (item) => {
            checked += 1;
            if (item.status === 'found') foundSoFar += 1;
            if (!allResults.some((r) => r.id === item.id)) {
              allResults.push(item);
            }
            const progressStep = phoneTargets.length > 100 ? 45 : 5;
            if (item.status === 'found' || checked % progressStep === 0 || checked === phoneTargets.length) {
              const runningExec: ToolExecutionState = {
                tool: 'ignorant',
                status: 'running',
                progress: Math.min(95, Math.round((checked / phoneTargets.length) * 90) + 5),
                durationMs: Date.now() - t0,
                platformsChecked: checked,
                foundCount: foundSoFar,
                errorCount: 0,
                message: `Checking ${checked}/${phoneTargets.length} phone-enabled websites...`,
              };
              onModuleDone?.([item], runningExec);
            }
          }
        );

        const items = sweep.results;
        const foundCount = items.filter((i) => i.status === 'found').length;
        const errCount = items.filter((i) => i.status === 'error').length;
        const exec: ToolExecutionState = {
          tool,
          status: errCount > 0 ? (foundCount > 0 ? 'warning' : 'error') : 'completed',
          progress: 100,
          durationMs: Date.now() - t0,
          platformsChecked: items.length,
          foundCount,
          errorCount: errCount,
          message: `Audited ${items.length} websites & services (${foundCount} registered account(s), ${items.filter((i) => i.status === 'not_found').length} verified clean)`,
        };
        for (const item of items) {
          if (!allResults.some((r) => r.id === item.id)) allResults.push(item);
        }
        executions.push(exec);
        onModuleDone?.(items, exec);
      } else {
        const exec: ToolExecutionState = {
          tool,
          status: 'skipped',
          progress: 100,
          durationMs: 0,
          platformsChecked: 0,
          foundCount: 0,
          errorCount: 0,
          message: 'Skipped (email/username module only)',
        };
        executions.push(exec);
        onModuleDone?.([], exec);
      }
    })
  );

  // Cross-pivot avatar lookup across discovered phone handles (Telegram, Instagram) & linked non-masked emails
  const resolveHandleAvatarUrl = async (vHandle: string): Promise<string | undefined> => {
    const cleanHandle = vHandle.replace(/^@/, '').trim();
    if (!cleanHandle) return undefined;
    const enc = encodeURIComponent(cleanHandle);
    const [unavTg, unavGeneric, ghUser, tgDirect, genDirect] = await Promise.all([
      fetchJsonSafe<{ url?: string }>(
        `https://unavatar.io/telegram/${enc}?json&fallback=false`,
        3600
      ),
      fetchJsonSafe<{ url?: string }>(
        `https://unavatar.io/${enc}?json&fallback=false`,
        3600
      ),
      fetchJsonSafe<{ avatar_url?: string }>(
        `https://api.github.com/users/${enc}`,
        3200
      ),
      probeDirectPublicImageUrl(`https://unavatar.io/telegram/${enc}?fallback=false`, 3400),
      probeDirectPublicImageUrl(`https://unavatar.io/${enc}?fallback=false`, 3400),
    ]);
    return (
      normalizeRemoteImageUrl(unavTg.data?.url) ||
      normalizeRemoteImageUrl(unavGeneric.data?.url) ||
      normalizeRemoteImageUrl(ghUser.data?.avatar_url) ||
      tgDirect ||
      genDirect
    );
  };

  const resolveEmailAvatarUrl = async (rawEmail: string): Promise<string | undefined> => {
    const cleanEmail = rawEmail.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@') || cleanEmail.includes('*')) return undefined;
    const enc = encodeURIComponent(cleanEmail);
    const hash = md5Hex(cleanEmail);
    const shaHash = sha256Hex(cleanEmail);
    const [unavEmail, unavGoogle, unavDirect, gravDirect, gravShaDirect] = await Promise.all([
      fetchJsonSafe<{ url?: string }>(
        `https://unavatar.io/${enc}?json&fallback=false`,
        3600
      ),
      fetchJsonSafe<{ url?: string }>(
        `https://unavatar.io/google/${enc}?json&fallback=false`,
        3600
      ),
      probeDirectPublicImageUrl(`https://unavatar.io/${enc}?fallback=false`, 3600),
      probeDirectPublicImageUrl(`https://www.gravatar.com/avatar/${hash}?s=256&d=404`, 3200),
      probeDirectPublicImageUrl(`https://www.gravatar.com/avatar/${shaHash}?s=256&d=404`, 3200),
    ]);
    return (
      normalizeRemoteImageUrl(unavEmail.data?.url) ||
      normalizeRemoteImageUrl(unavGoogle.data?.url) ||
      unavDirect ||
      gravDirect ||
      gravShaDirect
    );
  };

  const discoveredEmails = new Set<string>();
  const discoveredHandles = new Set<string>();
  const updatedAvatarItems: InvestigationResultItem[] = [];

  for (const r of allResults) {
    if (r.status !== 'found') continue;
    const det = (r.details || {}) as Record<string, unknown>;
    const vHandle =
      (typeof det.verifiedUsername === 'string' && det.verifiedUsername.trim()) ||
      r.displayFields?.find((f) => /username/i.test(f.label) && f.value)?.value?.replace(/^@/, '').trim() ||
      '';
    if (vHandle && !vHandle.includes('*')) {
      discoveredHandles.add(vHandle);
      if (!r.avatarUrl) {
        const resolved = await resolveHandleAvatarUrl(vHandle);
        if (resolved) {
          r.avatarUrl = resolved;
          updatedAvatarItems.push(r);
        }
      }
    }

    const emailField =
      r.displayFields?.find((f) => f.kind === 'email' && f.value && !f.value.includes('*'))?.value ||
      (typeof det.email === 'string' && det.email.includes('@') && !det.email.includes('*') ? det.email : undefined);
    if (emailField) {
      discoveredEmails.add(emailField.trim().toLowerCase());
      if (!r.avatarUrl) {
        const resolvedEmailImg = await resolveEmailAvatarUrl(emailField);
        if (resolvedEmailImg) {
          r.avatarUrl = resolvedEmailImg;
          updatedAvatarItems.push(r);
        }
      }
    }
  }

  // If phone-linked carrier card still lacks an avatar, try cross-pivoting any non-masked emails/handles or resolved service avatars
  const carrierCard = allResults.find((r) => r.id === 'mailaccess-telecom-carrier' && r.status === 'found');
  if (carrierCard && !carrierCard.avatarUrl) {
    for (const em of discoveredEmails) {
      const img = await resolveEmailAvatarUrl(em);
      if (img) {
        carrierCard.avatarUrl = img;
        carrierCard.linkedInfo = Array.from(
          new Set([...(carrierCard.linkedInfo || []), `Linked Avatar (${em})`])
        );
        updatedAvatarItems.push(carrierCard);
        break;
      }
    }
    if (!carrierCard.avatarUrl) {
      for (const h of discoveredHandles) {
        const img = await resolveHandleAvatarUrl(h);
        if (img) {
          carrierCard.avatarUrl = img;
          carrierCard.linkedInfo = Array.from(
            new Set([...(carrierCard.linkedInfo || []), `Linked Avatar (@${h})`])
          );
          updatedAvatarItems.push(carrierCard);
          break;
        }
      }
    }
  }

  if (updatedAvatarItems.length > 0 && onModuleDone) {
    const carrierExec =
      executions.find((e) => e.tool === 'mailaccess') ||
      executions[0] || {
        tool: 'mailaccess',
        status: 'completed',
        progress: 100,
        durationMs: 0,
        platformsChecked: updatedAvatarItems.length,
        foundCount: updatedAvatarItems.length,
        errorCount: 0,
        message: 'Linked avatar enrichment applied',
      };
    onModuleDone(updatedAvatarItems, carrierExec);
  }

  return { results: allResults, executions, geoMarkers, breaches: allBreaches };
}

async function runGhuntEmailModule(email: string): Promise<{
  result: InvestigationResultItem;
  geoMarkers: GeoMarker[];
}> {
  const native = await runNativeGhuntInvestigation(email);
  return {
    result: native.result,
    geoMarkers: native.geoMarkers,
  };
}

export async function executeInvestigation(
  scanId: string,
  rawTarget: string,
  targetType: TargetType,
  selectedTools: ToolId[],
  onProgress?: (partial: InvestigationRecord) => void,
  options?: { enableGoogleDorking?: boolean }
): Promise<InvestigationRecord> {
  const enableGoogleDorking = options?.enableGoogleDorking === true;
  const target =
    targetType === 'email' || targetType === 'domain'
      ? rawTarget.trim().toLowerCase()
      : rawTarget.trim();
  const startedAt = new Date().toISOString();
  const startMs = Date.now();
  const allResults: InvestigationResultItem[] = [];
  const breachedAccounts: BreachedAccountItem[] = [];
  const geoMarkers: GeoMarker[] = [];

  const execMap = new Map<ToolId, ToolExecutionState>();
  for (const t of selectedTools) {
    execMap.set(t, {
      tool: t,
      status: 'running',
      progress: 15,
      durationMs: 0,
      platformsChecked: 0,
      foundCount: 0,
      errorCount: 0,
      message: `Scanning ${t}...`,
    });
  }

  const buildSnapshot = (
    statusOverride?: InvestigationRecord['status'],
    completedAt?: string
  ): InvestigationRecord => {
    const seenPhotoUrls = new Set<string>();
    const profilePhotos: ProfilePhotoItem[] = [];
    for (const r of allResults) {
      if (r.status === 'found' && r.avatarUrl) {
        const cleanAvatarUrl = normalizeRemoteImageUrl(r.avatarUrl, r.url);
        if (cleanAvatarUrl) {
          r.avatarUrl = cleanAvatarUrl;
          const dedupKey = cleanAvatarUrl.toLowerCase();
          if (!seenPhotoUrls.has(dedupKey)) {
            seenPhotoUrls.add(dedupKey);
            profilePhotos.push({
              id: `photo-${r.id}`,
              url: cleanAvatarUrl,
              platform: r.platform,
              handle: r.handle,
              tool: r.tool,
              resultId: r.id,
            });
          }
        }
      }

      const ghuntCover =
        r.status === 'found' &&
        (r.details as { ghuntIntel?: { coverPhotoUrl?: string } } | undefined)?.ghuntIntel?.coverPhotoUrl;
      if (typeof ghuntCover === 'string' && ghuntCover.trim()) {
        const cleanCoverUrl = normalizeRemoteImageUrl(ghuntCover, r.url);
        if (cleanCoverUrl) {
          const coverKey = cleanCoverUrl.toLowerCase();
          if (!seenPhotoUrls.has(coverKey)) {
            seenPhotoUrls.add(coverKey);
            profilePhotos.push({
              id: 'photo-ghunt-cover',
              url: cleanCoverUrl,
              platform: 'Google Cover Photo (GHunt)',
              handle: r.handle,
              tool: 'ghunt',
              resultId: r.id,
            });
          }
        }
      }
    }

    const dedupedGeoMap = new Map<string, GeoMarker>();
    for (const g of geoMarkers) {
      const key =
        g.kind === 'review' || g.kind === 'ring_center'
          ? g.id
          : `${g.region}|${g.country}`;
      const existing = dedupedGeoMap.get(key);
      if (existing) {
        dedupedGeoMap.set(key, { ...existing, count: existing.count + 1 });
      } else {
        dedupedGeoMap.set(key, { ...g });
      }
    }

    const found = allResults.filter((r) => r.status === 'found').length;
    const breached = breachedAccounts.length;
    const leaked = allResults.filter(
      (r) => r.status === 'found' && r.findingKind === 'leaked'
    ).length;
    const registered = allResults.filter(
      (r) => r.status === 'found' && r.findingKind === 'registered'
    ).length;
    const notFound = allResults.filter((r) => r.status === 'not_found').length;
    const notChecked = allResults.filter((r) => r.status === 'not_checked').length;
    const errors = allResults.filter((r) => r.status === 'error').length;

    const computedStatus: InvestigationRecord['status'] =
      statusOverride ||
      (errors > 0 && found === 0 && notFound === 0
        ? 'failed'
        : errors > 0
        ? 'partial'
        : 'completed');

    return {
      scanId,
      target,
      targetType,
      email: targetType === 'email' ? target : '',
      createdAt: startedAt,
      ...(completedAt ? { completedAt } : {}),
      durationMs: Date.now() - startMs,
      status: computedStatus,
      selectedTools,
      enableGoogleDorking,
      summary: {
        total: found,
        found,
        breached,
        registered,
        leaked,
        notFound,
        notChecked,
        errors,
        profilePhotosCount: profilePhotos.length,
      },
      profilePhotos: [...profilePhotos],
      breachedAccounts: [...breachedAccounts],
      geoMarkers: Array.from(dedupedGeoMap.values()),
      toolExecutions: selectedTools.map((t) => execMap.get(t)!),
      results: [...allResults],
    };
  };

  const emitProgress = () => {
    onProgress?.(buildSnapshot('running'));
  };

  if (targetType === 'phone') {
    await runPhoneIntelligence(target, selectedTools, enableGoogleDorking, (items, exec, geo, subBreaches) => {
      for (const item of items) {
        const existingIdx = allResults.findIndex((r) => r.id === item.id);
        if (existingIdx >= 0) {
          allResults[existingIdx] = item;
        } else {
          allResults.push(item);
        }
      }
      if (subBreaches) {
        for (const b of subBreaches) {
          if (!breachedAccounts.some((x) => x.id === b.id)) {
            breachedAccounts.push(b);
          }
        }
      }
      if (geo) geoMarkers.push(geo);
      execMap.set(exec.tool, exec);
      emitProgress();
    });
  } else if (targetType === 'ip') {
    const out = await runIpLookup(target);
    allResults.push(...out.results);
    if (out.geo) geoMarkers.push(out.geo);
    for (const tool of selectedTools) {
      execMap.set(tool, {
        tool,
        status: (tool === 'mailaccess' ? 'completed' : 'skipped') as ToolExecutionState['status'],
        progress: 100,
        durationMs: tool === 'mailaccess' ? Date.now() - startMs : 0,
        platformsChecked: tool === 'mailaccess' ? out.results.length : 0,
        foundCount:
          tool === 'mailaccess'
            ? out.results.filter((r) => r.status === 'found').length
            : 0,
        errorCount: 0,
        message:
          tool === 'mailaccess'
            ? 'IP & geolocation probe completed'
            : 'Skipped for IP target',
      });
    }
    emitProgress();
  } else if (targetType === 'domain') {
    const out = await runDomainLookup(target);
    allResults.push(...out.results);
    if (out.geo) geoMarkers.push(out.geo);
    for (const tool of selectedTools) {
      execMap.set(tool, {
        tool,
        status: (tool === 'mailaccess' ? 'completed' : 'skipped') as ToolExecutionState['status'],
        progress: 100,
        durationMs: tool === 'mailaccess' ? Date.now() - startMs : 0,
        platformsChecked: tool === 'mailaccess' ? out.results.length : 0,
        foundCount:
          tool === 'mailaccess'
            ? out.results.filter((r) => r.status === 'found').length
            : 0,
        errorCount: 0,
        message:
          tool === 'mailaccess'
            ? 'Domain DNS & RDAP check completed'
            : 'Skipped for domain target',
      });
    }
    emitProgress();
  } else {
    const handle =
      targetType === 'email'
        ? target.split('@')[0].trim()
        : target.replace(/^@/, '').trim();

    await Promise.all(
      selectedTools.map(async (tool) => {
        const t0 = Date.now();
        let items: InvestigationResultItem[] = [];

        try {
          if (tool === 'mailaccess') {
            if (targetType === 'email') {
              const out = await runMailAccessEmailModule(
                target,
                (subItems, subBreaches, subGeo) => {
                  for (const item of subItems) {
                    if (!allResults.some((r) => r.id === item.id)) {
                      allResults.push(item);
                    }
                  }
                  if (subBreaches) {
                    for (const b of subBreaches) {
                      if (!breachedAccounts.some((x) => x.id === b.id)) {
                        breachedAccounts.push(b);
                      }
                    }
                  }
                  if (subGeo) geoMarkers.push(subGeo);
                  emitProgress();
                },
                enableGoogleDorking
              );
              items = out.results;
            } else {
              const buildPermutations = async (): Promise<InvestigationResultItem> => {
                const tPerm = Date.now();
                const base = handle.replace(/^@/, '').trim();
                const candidates: Array<{ handle: string; reason: string }> = [
                  { handle: `${base}_`, reason: 'Trailing underscore' },
                  { handle: `real${base}`, reason: 'Real prefix' },
                  { handle: `the${base}`, reason: 'The prefix' },
                  { handle: `${base}99`, reason: 'Numeric suffix' },
                  { handle: `${base}.dev`, reason: 'Developer suffix' },
                  { handle: `${base}_official`, reason: 'Official handle' },
                  { handle: `${base}hq`, reason: 'HQ suffix' },
                  { handle: `0x${base}`, reason: 'Hex/sec prefix' },
                ].filter((c) => c.handle.toLowerCase() !== base.toLowerCase());

                const probed: UsernamePermutationItem[] = await mapWithConcurrency(
                  candidates,
                  2,
                  async (c, idx) => {
                    if (idx >= 5 || !/^[a-zA-Z0-9-]+$/.test(c.handle)) {
                      return { handle: c.handle, reason: c.reason };
                    }
                    const githubUrl = `https://github.com/${encodeURIComponent(c.handle)}`;
                    const gh = await fetchHeadOrGetStatus(githubUrl, 3000);
                    if (gh.status >= 200 && gh.status < 300) {
                      return {
                        handle: c.handle,
                        reason: c.reason,
                        githubExists: true,
                        githubUrl,
                      };
                    }
                    return {
                      handle: c.handle,
                      reason: c.reason,
                      githubExists: gh.status === 404 ? false : undefined,
                    };
                  }
                );

                const activeMatches = probed.filter((p) => p.githubExists);
                return {
                  id: 'mailaccess-username-permutations',
                  platform: 'Username Permutation Suggester',
                  domain: 'github.com',
                  category: 'Social & Community',
                  tool: 'mailaccess',
                  status: activeMatches.length > 0 ? 'found' : 'not_found',
                  findingKind: 'infrastructure',
                  handle: base,
                  displayName: `${probed.length} Handle Variants`,
                  accountType:
                    activeMatches.length > 0
                      ? `${activeMatches.length} Live Alternate(s)`
                      : 'Suggested Pivot Handles',
                  relativeTime: 'Variant analysis',
                  linkedInfo: probed.slice(0, 4).map((p) => `@${p.handle}`),
                  displayFields:
                    activeMatches.length > 0
                      ? [
                          { label: 'Base Handle', value: base, copyable: true },
                          { label: 'Live Alternates', value: activeMatches.map((a) => a.handle).join(', '), copyable: true },
                        ]
                      : undefined,
                  url: activeMatches[0]?.githubUrl,
                  summary:
                    activeMatches.length > 0
                      ? `Found ${activeMatches.length} live alternate handle(s) on GitHub: ${activeMatches.map((a) => `@${a.handle}`).join(', ')}`
                      : `Generated ${probed.length} OSINT handle permutations for one-click pivot scanning.`,
                  durationMs: Date.now() - tPerm,
                  details: {
                    baseHandle: base,
                    permutations: probed,
                  },
                };
              };

              const cleanUsername = handle.replace(/^@/, '').trim();
              const resolveUsernameUnavatar = async (h: string): Promise<string | undefined> => {
                const enc = encodeURIComponent(h);
                const providers = [
                  `https://unavatar.io/${enc}?json&fallback=false`,
                  `https://unavatar.io/github/${enc}?json&fallback=false`,
                  `https://unavatar.io/x/${enc}?json&fallback=false`,
                  `https://unavatar.io/telegram/${enc}?json&fallback=false`,
                ];
                const responses = await Promise.all(
                  providers.map((u) => fetchJsonSafe<{ url?: string }>(u, 4000))
                );
                for (const r of responses) {
                  const candidate = normalizeRemoteImageUrl(r.data?.url);
                  if (candidate) return candidate;
                }
                const directProviders = [
                  `https://unavatar.io/${enc}?fallback=false`,
                  `https://unavatar.io/github/${enc}?fallback=false`,
                  `https://unavatar.io/telegram/${enc}?fallback=false`,
                ];
                const directImgs = await Promise.all(
                  directProviders.map((u) => probeDirectPublicImageUrl(u, 3800))
                );
                return directImgs.find((u): u is string => Boolean(u));
              };

              const [gh, grav, permItem, resolvedUnav] = await Promise.all([
                runGitHubIntelligence(handle, 'username', 'mailaccess').then((res) => {
                  for (const item of res.results) {
                    if (!allResults.some((r) => r.id === item.id)) allResults.push(item);
                  }
                  if (res.geo) geoMarkers.push(res.geo);
                  emitProgress();
                  return res;
                }),
                runGravatarLookup(handle, 'username', 'mailaccess').then((res) => {
                  if (!allResults.some((r) => r.id === res.result.id)) allResults.push(res.result);
                  if (res.geo) geoMarkers.push(res.geo);
                  emitProgress();
                  return res;
                }),
                buildPermutations().then((pItem) => {
                  if (!allResults.some((r) => r.id === pItem.id)) allResults.push(pItem);
                  emitProgress();
                  return pItem;
                }),
                resolveUsernameUnavatar(cleanUsername),
              ]);
              items = [...gh.results, grav.result, permItem];
              const existingUrls = new Set(
                items
                  .filter((it) => it.status === 'found' && it.avatarUrl)
                  .map((it) => normalizeRemoteImageUrl(it.avatarUrl, it.url)?.toLowerCase())
                  .filter((v): v is string => Boolean(v))
              );
              if (resolvedUnav && !existingUrls.has(resolvedUnav.toLowerCase())) {
                const unavItem: InvestigationResultItem = {
                  id: 'mailaccess-unavatar-username',
                  platform: 'Public Avatar Index (Unavatar)',
                  domain: 'unavatar.io',
                  category: 'Social & Community',
                  tool: 'mailaccess',
                  status: 'found',
                  findingKind: 'registered',
                  handle,
                  displayName: handle,
                  accountType: 'Cross-Network Public Avatar',
                  avatarUrl: resolvedUnav,
                  relativeTime: 'Active image',
                  displayFields: [
                    { label: 'Username', value: handle, copyable: true },
                    { label: 'Image Source', value: resolvedUnav, kind: 'url', copyable: true },
                  ],
                  url: resolvedUnav,
                  summary: `Resolved public avatar image for @${handle} via Unavatar cross-network index.`,
                  durationMs: Date.now() - t0,
                  details: { handle, imageUrl: resolvedUnav },
                };
                if (!allResults.some((r) => r.id === unavItem.id)) allResults.push(unavItem);
                items.push(unavItem);
                emitProgress();
              }
            }
          } else if (tool === 'holehe') {
            if (targetType === 'email') {
              const holeheTargets = buildHoleheTargets(target);
              let checked = 0;
              let foundSoFar = 0;

              const sweep = await runPublicHandleSweep(
                target,
                'holehe',
                holeheTargets,
                (item, geo) => {
                  checked += 1;
                  if (item.status === 'found') foundSoFar += 1;
                  if (!allResults.some((r) => r.id === item.id)) allResults.push(item);
                  if (geo) geoMarkers.push(geo);
                  const progressStep = holeheTargets.length > 120 ? 35 : 4;
                  if (
                    item.status === 'found' ||
                    checked % progressStep === 0 ||
                    checked === holeheTargets.length
                  ) {
                    execMap.set('holehe', {
                      tool: 'holehe',
                      status: 'running',
                      progress: Math.min(95, Math.round((checked / holeheTargets.length) * 90) + 5),
                      durationMs: Date.now() - t0,
                      platformsChecked: checked,
                      foundCount: foundSoFar,
                      errorCount: 0,
                      message: `Sweeping ${checked}/${holeheTargets.length} strict email endpoints...`,
                    });
                    emitProgress();
                  }
                }
              );

              items = sweep.results;
            } else {
              execMap.set(tool, {
                tool,
                status: 'skipped',
                progress: 100,
                durationMs: 0,
                platformsChecked: 0,
                foundCount: 0,
                errorCount: 0,
                message: 'Email-only registration module skipped for username',
              });
              emitProgress();
              return;
            }
          } else if (tool === 'ghunt') {
            if (targetType === 'email') {
              const ghuntOut = await runGhuntEmailModule(target);
              geoMarkers.push(...ghuntOut.geoMarkers);
              items = [ghuntOut.result];
            } else {
              execMap.set(tool, {
                tool,
                status: 'skipped',
                progress: 100,
                durationMs: 0,
                platformsChecked: 0,
                foundCount: 0,
                errorCount: 0,
                message: 'Google email ecosystem module skipped for username',
              });
              emitProgress();
              return;
            }
          } else if (tool === 'maigret') {
            if (targetType === 'email') {
              execMap.set(tool, {
                tool,
                status: 'skipped',
                progress: 100,
                durationMs: 0,
                platformsChecked: 0,
                foundCount: 0,
                errorCount: 0,
                message: 'Username-handle sweep disabled in strict Email mode',
              });
              emitProgress();
              return;
            }
            if (selectedTools.includes('mailaccess')) {
              await new Promise((r) => setTimeout(r, 700));
            }
            let checked = 0;
            let foundSoFar = 0;
            const sweep = await runPublicHandleSweep(
              handle,
              'maigret',
              MAIGRET_TARGETS,
              (item, geo) => {
                checked += 1;
                if (item.status === 'found') foundSoFar += 1;
                if (!allResults.some((r) => r.id === item.id)) allResults.push(item);
                if (geo) geoMarkers.push(geo);
                if (item.status === 'found' || checked % 5 === 0) {
                  execMap.set('maigret', {
                    tool: 'maigret',
                    status: 'running',
                    progress: Math.min(95, Math.round((checked / MAIGRET_TARGETS.length) * 90) + 5),
                    durationMs: Date.now() - t0,
                    platformsChecked: checked,
                    foundCount: foundSoFar,
                    errorCount: 0,
                    message: `Sweeping ${checked}/${MAIGRET_TARGETS.length} dev, AI & cloud platforms...`,
                  });
                  emitProgress();
                }
              }
            );
            items = sweep.results;
          } else if (tool === 'blackbird') {
            if (targetType === 'email') {
              execMap.set(tool, {
                tool,
                status: 'skipped',
                progress: 100,
                durationMs: 0,
                platformsChecked: 0,
                foundCount: 0,
                errorCount: 0,
                message: 'Username-handle sweep disabled in strict Email mode',
              });
              emitProgress();
              return;
            }
            if (selectedTools.includes('mailaccess')) {
              await new Promise((r) => setTimeout(r, 750));
            }
            let checked = 0;
            let foundSoFar = 0;
            const sweep = await runPublicHandleSweep(
              handle,
              'blackbird',
              BLACKBIRD_TARGETS,
              (item, geo) => {
                checked += 1;
                if (item.status === 'found') foundSoFar += 1;
                if (!allResults.some((r) => r.id === item.id)) allResults.push(item);
                if (geo) geoMarkers.push(geo);
                if (item.status === 'found' || checked % 5 === 0) {
                  execMap.set('blackbird', {
                    tool: 'blackbird',
                    status: 'running',
                    progress: Math.min(95, Math.round((checked / BLACKBIRD_TARGETS.length) * 90) + 5),
                    durationMs: Date.now() - t0,
                    platformsChecked: checked,
                    foundCount: foundSoFar,
                    errorCount: 0,
                    message: `Sweeping ${checked}/${BLACKBIRD_TARGETS.length} gaming, security & media hosts...`,
                  });
                  emitProgress();
                }
              }
            );
            items = sweep.results;
          } else if (tool === 'sherlock') {
            if (targetType === 'email') {
              execMap.set(tool, {
                tool,
                status: 'skipped',
                progress: 100,
                durationMs: 0,
                platformsChecked: 0,
                foundCount: 0,
                errorCount: 0,
                message: 'Username-handle sweep disabled in strict Email mode',
              });
              emitProgress();
              return;
            }
            if (selectedTools.includes('mailaccess')) {
              await new Promise((r) => setTimeout(r, 800));
            }
            let checked = 0;
            let foundSoFar = 0;
            const sweep = await runPublicHandleSweep(
              handle,
              'sherlock',
              SHERLOCK_TARGETS,
              (item, geo) => {
                checked += 1;
                if (item.status === 'found') foundSoFar += 1;
                if (!allResults.some((r) => r.id === item.id)) allResults.push(item);
                if (geo) geoMarkers.push(geo);
                if (item.status === 'found' || checked % 5 === 0) {
                  execMap.set('sherlock', {
                    tool: 'sherlock',
                    status: 'running',
                    progress: Math.min(95, Math.round((checked / SHERLOCK_TARGETS.length) * 90) + 5),
                    durationMs: Date.now() - t0,
                    platformsChecked: checked,
                    foundCount: foundSoFar,
                    errorCount: 0,
                    message: `Sweeping ${checked}/${SHERLOCK_TARGETS.length} social, creator & web archives...`,
                  });
                  emitProgress();
                }
              }
            );
            items = sweep.results;
          } else {
            execMap.set(tool, {
              tool,
              status: 'skipped',
              progress: 100,
              durationMs: 0,
              platformsChecked: 0,
              foundCount: 0,
              errorCount: 0,
              message: `Skipped for ${targetType} target`,
            });
            emitProgress();
            return;
          }

          for (const item of items) {
            if (!allResults.some((r) => r.id === item.id)) {
              allResults.push(item);
            }
          }
          const foundCount = items.filter((i) => i.status === 'found').length;
          const notFoundCount = items.filter((i) => i.status === 'not_found').length;
          const errCount = items.filter((i) => i.status === 'error').length;
          const resolvedCount = foundCount + notFoundCount;
          const isMultiSweep = items.length > 5;

          const resolvedStatus: ToolExecutionState['status'] = isMultiSweep
            ? errCount === items.length || (resolvedCount === 0 && errCount > items.length * 0.5)
              ? 'error'
              : errCount > items.length * 0.35
              ? 'warning'
              : 'completed'
            : errCount > 0 && foundCount === 0 && notFoundCount === 0
            ? 'error'
            : errCount > 0
            ? 'warning'
            : 'completed';

          execMap.set(tool, {
            tool,
            status: resolvedStatus,
            progress: 100,
            durationMs: Date.now() - t0,
            platformsChecked: items.length,
            foundCount,
            errorCount: errCount,
            message: isMultiSweep
              ? `Completed ${items.length} website check(s) · ${foundCount} found`
              : `Completed ${items.length} check(s) · ${foundCount} found`,
          });
          emitProgress();
        } catch (toolErr) {
          execMap.set(tool, {
            tool,
            status: 'error',
            progress: 100,
            durationMs: Date.now() - t0,
            platformsChecked: items.length,
            foundCount: items.filter((i) => i.status === 'found').length,
            errorCount: 1,
            message:
              toolErr instanceof Error
                ? toolErr.message
                : `Module ${tool} encountered a network error.`,
          });
          emitProgress();
        }
      })
    );

    // Verified-Handle Cross-Platform Correlation (Email Mode only)
    // Uses strictly verified usernames resolved by email APIs (GitHub, Gravatar, Launchpad, Flickr, npm, Duolingo, HN)
    // to probe Replit, Render, Vercel, Netlify, GitLab, Hugging Face, CodePen, PyPI, Docker Hub, etc.
    if (targetType === 'email') {
      const verifiedHandles = new Map<string, string>(); // lowercase handle -> source label
      const handleSources: Array<{ handle?: string; source: string }> = [];

      const existingFoundPlatforms = new Set(
        allResults
          .filter((r) => r.status === 'found')
          .map((r) => r.platform.toLowerCase())
      );
      const existingFoundUrls = new Set(
        allResults
          .filter((r) => r.status === 'found' && r.url)
          .map((r) => r.url!.replace(/\/$/, '').toLowerCase())
      );

      for (const r of allResults) {
        if (r.status !== 'found') continue;
        const det = r.details as Record<string, unknown> | undefined;

        if (typeof det?.verifiedUsername === 'string' && det.verifiedUsername.trim()) {
          handleSources.push({ handle: det.verifiedUsername.trim(), source: r.platform });
        }
        if (typeof det?.login === 'string' && det.login.trim()) {
          handleSources.push({ handle: det.login.trim(), source: r.platform });
        }
        if (typeof det?.preferredUsername === 'string' && det.preferredUsername.trim()) {
          handleSources.push({ handle: det.preferredUsername.trim(), source: 'Gravatar' });
        }
        if (Array.isArray(det?.authors) && typeof det.authors[0] === 'string') {
          handleSources.push({ handle: det.authors[0], source: 'Hacker News' });
        }

        // Extract verified profile handles from live-verified Dork hits
        const dorkHits = (det?.dorkReport as { hits?: Array<{ url?: string; verificationMethod?: string }> } | undefined)?.hits;
        if (Array.isArray(dorkHits)) {
          for (const hit of dorkHits) {
            if (
              hit.verificationMethod !== 'live-page-match' &&
              hit.verificationMethod !== 'api-exact-match'
            ) {
              continue;
            }
            const u = hit.url || '';
            const m =
              u.match(/^https?:\/\/(?:www\.)?github\.com\/([a-zA-Z0-9-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?replit\.com\/@([a-zA-Z0-9._-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?huggingface\.co\/([a-zA-Z0-9._-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?gitlab\.com\/([a-zA-Z0-9._-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?dev\.to\/([a-zA-Z0-9._-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?npmjs\.com\/~([a-zA-Z0-9._-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?medium\.com\/@([a-zA-Z0-9._-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?substack\.com\/@([a-zA-Z0-9._-]{2,39})(?:\/|$)/i) ||
              u.match(/^https?:\/\/(?:www\.)?kaggle\.com\/([a-zA-Z0-9._-]{2,39})(?:\/|$)/i);
            const extracted = m?.[1];
            if (
              extracted &&
              !/^(orgs|topics|explore|search|settings|login|signup|about|pricing|docs|blog|models|datasets|spaces)$/i.test(
                extracted
              )
            ) {
              handleSources.push({ handle: extracted, source: 'Verified Dork Profile' });
            }
          }
        }

        // Emit Gravatar verified linkedAccounts directly as correlated findings
        if (Array.isArray(det?.linkedAccounts)) {
          for (const accRaw of det.linkedAccounts) {
            if (!accRaw || typeof accRaw !== 'object') continue;
            const acc = accRaw as {
              domain?: string;
              display?: string;
              url?: string;
              username?: string;
              shortname?: string;
            };
            if (acc.username && typeof acc.username === 'string') {
              handleSources.push({
                handle: acc.username,
                source: `Gravatar (${acc.shortname || acc.domain || 'Linked'})`,
              });
            }
            const platName = (acc.display || acc.shortname || acc.domain || '').trim();
            const linkUrl = acc.url?.trim();
            if (!platName || !linkUrl || !/^https?:\/\//i.test(linkUrl)) continue;
            const normUrl = linkUrl.replace(/\/$/, '').toLowerCase();
            if (existingFoundPlatforms.has(platName.toLowerCase()) || existingFoundUrls.has(normUrl)) {
              continue;
            }
            existingFoundPlatforms.add(platName.toLowerCase());
            existingFoundUrls.add(normUrl);

            const dom = (() => {
              try {
                return new URL(linkUrl).hostname.replace(/^www\./, '');
              } catch {
                return acc.domain;
              }
            })();

            const gravCorrelated: InvestigationResultItem = {
              id: `correlated-gravatar-${platName.toLowerCase().replace(/\W+/g, '-')}`,
              platform: platName,
              domain: dom,
              category: 'Social & Community',
              tool: 'mailaccess',
              status: 'found',
              findingKind: 'registered',
              handle: acc.username || target,
              displayName: acc.username || acc.display || platName,
              accountType: 'Gravatar Verified Link',
              relativeTime: 'Verified link',
              linkedInfo: ['Source: Gravatar Profile', ...(acc.username ? [`@${acc.username}`] : [])],
              displayFields: [
                { label: 'Source', value: 'Gravatar Verified Accounts' },
                ...(acc.username ? [{ label: 'Handle', value: acc.username, copyable: true }] : []),
                { label: 'Profile URL', value: linkUrl, kind: 'url', copyable: true },
              ],
              url: linkUrl,
              summary: `Verified Gravatar profile explicitly links to ${platName}${
                acc.username ? ` (@${acc.username})` : ''
              }.`,
              durationMs: 0,
              details: { correlatedFrom: 'Gravatar', ...acc },
            };
            allResults.push(gravCorrelated);
          }
        }
      }

      for (const cand of handleSources) {
        if (!cand.handle) continue;
        const cleanCand = cand.handle.replace(/^@/, '').trim();
        if (!/^[a-zA-Z0-9._-]{3,38}$/.test(cleanCand)) continue;
        const key = cleanCand.toLowerCase();
        if (!verifiedHandles.has(key)) {
          verifiedHandles.set(key, cand.source);
        }
      }

      if (verifiedHandles.size > 0) {
        const correlationNames = new Set([
          'Lovable',
          'Lovable App',
          'Bolt.new',
          'Vercel v0',
          'Cursor',
          'Supabase',
          'Replit',
          'Render',
          'Vercel',
          'Netlify',
          'Railway',
          'Fly.io',
          'Cloudflare Pages',
          'GitLab Pages',
          'GitHub Pages',
          'DEV Community',
          'Hugging Face',
          'Kaggle',
          'CodePen',
          'CodeSandbox',
          'StackBlitz',
          'Glitch',
          'Hashnode',
          'GitLab',
          'Bitbucket',
          'Codeberg',
          'SourceHut',
          'Gitee',
          'PyPI',
          'npm Registry',
          'Docker Hub',
          'Crates.io',
          'Replicate',
          'Civitai',
          'Weights & Biases',
          'Exercism',
          'HackerRank',
          'GeeksforGeeks',
          'Lichess',
          'Keybase',
          'HackerOne',
          'TryHackMe',
          'Reddit',
          'Bluesky',
          'Mastodon (mastodon.social)',
          'Patreon',
          'BuyMeACoffee',
          'Ko-fi',
          'Product Hunt',
          'Dribbble',
          'Behance',
          'Linktree',
          'Medium',
          'Substack',
          'Disqus',
          'Quora',
          'LeetCode',
          'Codeforces',
          'Telegram',
          'Twitch',
          'YouTube',
          'Steam',
        ]);

        const candidatePool: PlatformSweepTarget[] = [];
        const seenPool = new Set<string>();
        for (const t of [...MAIGRET_TARGETS, ...BLACKBIRD_TARGETS, ...SHERLOCK_TARGETS]) {
          const pKey = t.platform.toLowerCase();
          if (!correlationNames.has(t.platform) || seenPool.has(pKey)) continue;
          seenPool.add(pKey);
          candidatePool.push(t);
        }

        const topHandles = Array.from(verifiedHandles.entries()).slice(0, 2);
        let correlatedAdded = 0;

        const corrRuns = await Promise.all(
          topHandles.map(async ([handleKey, sourcePlatform]) => {
            const targetsForHandle = candidatePool.filter(
              (t) => !existingFoundPlatforms.has(t.platform.toLowerCase())
            );
            if (targetsForHandle.length === 0) return null;
            const corrSweep = await runPublicHandleSweep(
              handleKey,
              selectedTools.includes('holehe') ? 'holehe' : 'mailaccess',
              targetsForHandle
            );
            return { handleKey, sourcePlatform, corrSweep };
          })
        );

        for (const run of corrRuns) {
          if (!run) continue;
          const { handleKey, sourcePlatform, corrSweep } = run;
          for (const item of corrSweep.results) {
            if (item.status !== 'found') continue;
            const pKey = item.platform.toLowerCase();
            if (existingFoundPlatforms.has(pKey)) continue;
            existingFoundPlatforms.add(pKey);
            correlatedAdded += 1;

            // Remove any prior unverified/auth-gated placeholder for this same platform
            for (let idx = allResults.length - 1; idx >= 0; idx--) {
              if (
                allResults[idx].status !== 'found' &&
                allResults[idx].platform.toLowerCase() === pKey
              ) {
                allResults.splice(idx, 1);
              }
            }

            allResults.push({
              ...item,
              id: `correlated-${handleKey.replace(/\W+/g, '-')}-${pKey.replace(/\W+/g, '-')}`,
              accountType: `Correlated via Verified Handle (@${handleKey})`,
              linkedInfo: [
                ...(item.linkedInfo || []),
                `Resolved via ${sourcePlatform}`,
                `@${handleKey}`,
              ].slice(0, 5),
              summary: `Resolved verified handle @${handleKey} (via ${sourcePlatform}) → ${
                item.summary || `confirmed active ${item.platform} account`
              }`,
              details: {
                ...(item.details || {}),
                correlatedFromHandle: handleKey,
                correlatedSource: sourcePlatform,
              },
            });
          }
          geoMarkers.push(...corrSweep.geoMarkers);
        }

        if (correlatedAdded > 0 && execMap.has('holehe')) {
          const curExec = execMap.get('holehe')!;
          execMap.set('holehe', {
            ...curExec,
            foundCount: allResults.filter((r) => r.tool === 'holehe' && r.status === 'found').length,
            message: `${curExec.message} + ${correlatedAdded} correlated via verified handle(s)`,
          });
        }
        emitProgress();
      }

      // Cross-enrich GHunt Workspace card with verified profile photo / display name discovered by email modules (GitHub, Gravatar, Duolingo, Launchpad, SO, Unavatar)
      const ghuntResult = allResults.find((r) => r.id === 'ghunt-google-workspace');
      if (ghuntResult) {
        const ghDetails = (ghuntResult.details || {}) as {
          ghuntIntel?: {
            avatarUrl?: string;
            displayName?: string;
            note?: string;
          };
        };
        const verifiedPeerWithAvatar = allResults.find(
          (r) =>
            r.id !== 'ghunt-google-workspace' &&
            r.status === 'found' &&
            Boolean(normalizeRemoteImageUrl(r.avatarUrl, r.url))
        );
        const verifiedPeerWithName = allResults.find(
          (r) =>
            r.id !== 'ghunt-google-workspace' &&
            r.status === 'found' &&
            Boolean(r.displayName && r.displayName.toLowerCase() !== target.toLowerCase())
        );

        let ghUpdated = false;
        if (!normalizeRemoteImageUrl(ghuntResult.avatarUrl, ghuntResult.url) && verifiedPeerWithAvatar?.avatarUrl) {
          const cleanPeerAvatar = normalizeRemoteImageUrl(verifiedPeerWithAvatar.avatarUrl, verifiedPeerWithAvatar.url);
          if (cleanPeerAvatar) {
            ghuntResult.avatarUrl = cleanPeerAvatar;
            if (ghDetails.ghuntIntel) {
              ghDetails.ghuntIntel.avatarUrl = cleanPeerAvatar;
            }
            ghUpdated = true;
          }
        }
        if (
          (!ghuntResult.displayName || ghuntResult.displayName.toLowerCase() === target.toLowerCase()) &&
          verifiedPeerWithName?.displayName
        ) {
          ghuntResult.displayName = verifiedPeerWithName.displayName;
          if (ghDetails.ghuntIntel && !ghDetails.ghuntIntel.displayName) {
            ghDetails.ghuntIntel.displayName = verifiedPeerWithName.displayName;
          }
          ghUpdated = true;
        }
        if (ghUpdated && ghuntResult.status === 'not_checked') {
          ghuntResult.status = 'found';
        }
      }
    }
  }

  return buildSnapshot(undefined, new Date().toISOString());
}
