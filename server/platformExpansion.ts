import crypto from 'node:crypto';
import type { PlatformSweepTarget } from './platformCatalog.ts';
import { queryBingRssDork } from './dorkEngine.ts';
import { runGeminiGoogleSearchDork } from './geminiRotator.ts';

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

function makeStackExchangeTarget(
  platform: string,
  site: string,
  webHost: string
): PlatformSweepTarget {
  return {
    platform,
    category: 'Developer & Code',
    urlFn: (h) => `https://${webHost}/users?tab=users&filter=all&search=${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.stackexchange.com/2.3/users?order=desc&sort=reputation&inname=${encodeURIComponent(
        h
      )}&site=${encodeURIComponent(site)}&pagesize=5`,
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
  };
}

function makeMastodonTarget(platform: string, host: string): PlatformSweepTarget {
  return {
    platform,
    category: 'Social & Community',
    urlFn: (h) => `https://${host}/@${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://${host}/api/v1/accounts/lookup?acct=${encodeURIComponent(h)}`,
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
  };
}

function makeLemmyTarget(platform: string, host: string): PlatformSweepTarget {
  return {
    platform,
    category: 'Social & Community',
    urlFn: (h) => `https://${host}/u/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://${host}/api/v3/user?username=${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const pv = asObj(asObj(data)?.person_view);
      const person = asObj(pv?.person);
      if (!person || !person.name) return { status: 'not_found' };
      return {
        status: 'found',
        id: person.id !== undefined ? String(person.id) : undefined,
        displayName: asStr(person.display_name) || asStr(person.name),
        avatarUrl: asStr(person.avatar),
        bio: asStr(person.bio),
        createdAt: asStr(person.published),
        url: asStr(person.actor_id),
      };
    },
  };
}

function makeMediaWikiTarget(
  platform: string,
  host: string,
  category: PlatformSweepTarget['category'] = 'Social & Community'
): PlatformSweepTarget {
  return {
    platform,
    category,
    urlFn: (h) => `https://${host}/wiki/User:${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://${host}/w/api.php?action=query&list=users&ususers=${encodeURIComponent(
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
  };
}

function makeHtmlProfileTarget(
  platform: string,
  category: PlatformSweepTarget['category'],
  urlFn: (h: string) => string,
  opts: {
    brandNeedle?: string;
    extraNotFound?: string[];
    rejectRedirect?: string[];
    subdomain?: boolean;
  } = {}
): PlatformSweepTarget {
  const brand = (opts.brandNeedle || platform.split(' ')[0]).toLowerCase();
  return {
    platform,
    category,
    urlFn,
    htmlCheck: {
      isSubdomainHost: opts.subdomain,
      notFoundMarkers: [
        'page not found',
        'user not found',
        'profile not found',
        'not found',
        '404',
        ...(opts.extraNotFound || []),
      ],
      rejectRedirectSubstrings: opts.rejectRedirect || ['/login', '/signin', '/signup', '/404'],
      foundMarkers: opts.subdomain
        ? (_low, raw, h, finalUrlLower) =>
            raw.trim().length > 90 && finalUrlLower.includes(h)
        : (low, _raw, h) =>
            (low.includes(h) || low.includes(`@${h}`)) &&
            (low.includes(brand) || low.includes('og:title')),
    },
  };
}

// ---------------------------------------------------------------------------
// EXTRA MAIGRET TARGETS (+66 Platforms): Cloud, Forges, Packages, SE, AI
// ---------------------------------------------------------------------------
export const EXTRA_MAIGRET_TARGETS: PlatformSweepTarget[] = [
  makeHtmlProfileTarget(
    'Firebase Hosting (.web.app)',
    'Productivity & Cloud',
    (h) => `https://${encodeURIComponent(h.toLowerCase())}.web.app`,
    {
      subdomain: true,
      extraNotFound: ['site not found', 'why am i seeing this?'],
    }
  ),
  makeHtmlProfileTarget(
    'Firebase Hosting (.firebaseapp.com)',
    'Productivity & Cloud',
    (h) => `https://${encodeURIComponent(h.toLowerCase())}.firebaseapp.com`,
    {
      subdomain: true,
      extraNotFound: ['site not found', 'why am i seeing this?'],
    }
  ),
  makeHtmlProfileTarget(
    'Heroku',
    'Productivity & Cloud',
    (h) => `https://${encodeURIComponent(h.toLowerCase())}.herokuapp.com`,
    {
      subdomain: true,
      extraNotFound: ['no such app', 'there is nothing here yet', 'heroku | welcome'],
    }
  ),
  makeHtmlProfileTarget(
    'PythonAnywhere',
    'Productivity & Cloud',
    (h) => `https://${encodeURIComponent(h.toLowerCase())}.pythonanywhere.com`,
    {
      subdomain: true,
      extraNotFound: ['coming soon!', 'nothing here yet'],
    }
  ),
  makeHtmlProfileTarget(
    'GitBook',
    'Productivity & Cloud',
    (h) => `https://${encodeURIComponent(h.toLowerCase())}.gitbook.io`,
    {
      subdomain: true,
      extraNotFound: ['space not found', 'not found on gitbook'],
    }
  ),
  makeHtmlProfileTarget(
    'Read the Docs',
    'Developer & Code',
    (h) => `https://${encodeURIComponent(h.toLowerCase())}.readthedocs.io`,
    {
      subdomain: true,
      extraNotFound: ['page not found', "this page doesn't exist"],
    }
  ),
  {
    platform: 'Neocities',
    category: 'Productivity & Cloud',
    urlFn: (h) => `https://${encodeURIComponent(h.toLowerCase())}.neocities.org`,
    apiUrlFn: (h) =>
      `https://neocities.org/api/info?sitename=${encodeURIComponent(h.toLowerCase())}`,
    extractJson: (data) => {
      const obj = asObj(data);
      const info = asObj(obj?.info);
      if (!obj || obj.result !== 'success' || !info) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: asStr(info.sitename),
        createdAt: asStr(info.created_at),
        extraFields:
          typeof info.views === 'number'
            ? [{ label: 'Site Views', value: String(info.views) }]
            : undefined,
      };
    },
  },
  {
    platform: 'Gitea.com',
    category: 'Developer & Code',
    urlFn: (h) => `https://gitea.com/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://gitea.com/api/v1/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.login) return { status: 'not_found' };
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.full_name) || asStr(obj.login),
        avatarUrl: asStr(obj.avatar_url),
        bio: asStr(obj.description),
        location: asStr(obj.location),
        createdAt: asStr(obj.created),
      };
    },
  },
  {
    platform: 'Framagit',
    category: 'Developer & Code',
    urlFn: (h) => `https://framagit.org/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://framagit.org/api/v4/users?username=${encodeURIComponent(h)}`,
    extractJson: (data) => {
      if (!Array.isArray(data) || data.length === 0) return { status: 'not_found' };
      const u = asObj(data[0]);
      if (!u || !u.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: u.id !== undefined ? String(u.id) : undefined,
        displayName: asStr(u.name) || asStr(u.username),
        avatarUrl: asStr(u.avatar_url),
        url: asStr(u.web_url),
      };
    },
  },
  {
    platform: 'Arch Linux AUR',
    category: 'Developer & Code',
    urlFn: (h) => `https://aur.archlinux.org/packages?SeB=m&K=${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://aur.archlinux.org/rpc/?v=5&type=search&by=maintainer&arg=${encodeURIComponent(
        h
      )}`,
    extractJson: (data, h) => {
      const obj = asObj(data);
      const count = asNum(obj?.resultcount);
      if (!count || count <= 0) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: h,
        extraFields: [{ label: 'AUR Packages', value: String(count) }],
      };
    },
  },
  {
    platform: 'MetaCPAN (Perl)',
    category: 'Developer & Code',
    urlFn: (h) => `https://metacpan.org/author/${encodeURIComponent(h.toUpperCase())}`,
    apiUrlFn: (h) =>
      `https://fastapi.metacpan.org/v1/author/${encodeURIComponent(h.toUpperCase())}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.pauseid) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(obj.pauseid),
        displayName: asStr(obj.name) || asStr(obj.pauseid),
        avatarUrl: asStr(obj.gravatar_url),
        location: asStr(obj.country),
      };
    },
  },
  {
    platform: 'Snapcraft Publishers',
    category: 'Developer & Code',
    urlFn: (h) => `https://snapcraft.io/publisher/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://api.snapcraft.io/v2/snaps/find?q=publisher:${encodeURIComponent(h)}`,
    apiHeaders: { 'Snap-Device-Series': '16' },
    extractJson: (data, h) => {
      const results = asObj(data)?.results;
      if (!Array.isArray(results) || results.length === 0) return { status: 'not_found' };
      const exact = results
        .map(asObj)
        .find(
          (r) =>
            asStr(asObj(asObj(r?.snap)?.publisher)?.username)?.toLowerCase() ===
            h.toLowerCase()
        );
      if (!exact) return { status: 'not_found' };
      const pub = asObj(asObj(exact.snap)?.publisher);
      return {
        status: 'found',
        id: asStr(pub?.id),
        displayName: asStr(pub?.['display-name']) || asStr(pub?.username) || h,
      };
    },
  },
  {
    platform: 'Terraform Registry',
    category: 'Developer & Code',
    urlFn: (h) => `https://registry.terraform.io/namespaces/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://registry.terraform.io/v2/organizations/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const d = asObj(asObj(data)?.data);
      const attrs = asObj(d?.attributes);
      if (!d || !attrs?.name) return { status: 'not_found' };
      return {
        status: 'found',
        id: asStr(d.id),
        displayName: asStr(attrs.name),
      };
    },
  },
  {
    platform: 'ArtifactHub (Helm/K8s)',
    category: 'Developer & Code',
    urlFn: (h) => `https://artifacthub.io/packages/search?user=${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://artifacthub.io/api/v1/packages/search?user=${encodeURIComponent(h)}&limit=3`,
    extractJson: (data, h) => {
      const pkgs = asObj(data)?.packages;
      if (!Array.isArray(pkgs) || pkgs.length === 0) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: h,
        extraFields: [{ label: 'Published Charts', value: `${pkgs.length}+` }],
      };
    },
  },
  {
    platform: 'WordPress.org Profiles',
    category: 'Developer & Code',
    urlFn: (h) => `https://profiles.wordpress.org/${encodeURIComponent(h.toLowerCase())}/`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404', 'could not be found'],
      foundMarkers: (low, _raw, h) =>
        low.includes(`(@${h})`) || (low.includes('wordpress.org') && low.includes(h)),
    },
  },
  {
    platform: 'Drupal.org',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.drupal.org/u/${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['page not found', '404'],
      foundMarkers: (low, _raw, h) => low.includes(h) && low.includes('drupal'),
    },
  },
  {
    platform: 'Figma Community',
    category: 'Developer & Code',
    urlFn: (h) => `https://www.figma.com/@${encodeURIComponent(h)}`,
    htmlCheck: {
      notFoundMarkers: ['"status":404', 'error.not_found', 'page not found'],
      foundMarkers: (low, _raw, h) => low.includes('figma') && low.includes(h),
    },
  },
  makeHtmlProfileTarget('Anaconda.org', 'Developer & Code', (h) => `https://anaconda.org/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Clojars', 'Developer & Code', (h) => `https://clojars.org/users/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('CocoaPods', 'Developer & Code', (h) => `https://cocoapods.org/owners/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Pub.dev (Dart)', 'Developer & Code', (h) => `https://pub.dev/publishers/${encodeURIComponent(h)}.dev`),
  makeHtmlProfileTarget('Hugging Face Spaces', 'Developer & Code', (h) => `https://huggingface.co/spaces/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Ollama Library', 'Developer & Code', (h) => `https://ollama.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Poe', 'Developer & Code', (h) => `https://poe.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('FlowGPT', 'Developer & Code', (h) => `https://flowgpt.com/@${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Fedora Account System', 'Developer & Code', (h) => `https://accounts.fedoraproject.org/user/${encodeURIComponent(h)}/`, { brandNeedle: 'fedora', rejectRedirect: ['/?next=', '/login', '/signin', '/signup', '/404'] }),
  makeHtmlProfileTarget('Debian Salsa', 'Developer & Code', (h) => `https://salsa.debian.org/${encodeURIComponent(h)}`, { brandNeedle: 'salsa' }),
  makeHtmlProfileTarget('GNOME GitLab', 'Developer & Code', (h) => `https://gitlab.gnome.org/${encodeURIComponent(h)}`, { brandNeedle: 'gitlab' }),
  makeHtmlProfileTarget('KDE Invent', 'Developer & Code', (h) => `https://invent.kde.org/${encodeURIComponent(h)}`, { brandNeedle: 'gitlab' }),
  makeHtmlProfileTarget('Disroot Git', 'Developer & Code', (h) => `https://git.disroot.org/${encodeURIComponent(h)}`, { brandNeedle: 'git' }),
  makeHtmlProfileTarget('0xacab GitLab', 'Developer & Code', (h) => `https://0xacab.org/${encodeURIComponent(h)}`, { brandNeedle: '0xacab' }),
  makeHtmlProfileTarget('Topcoder', 'Developer & Code', (h) => `https://www.topcoder.com/members/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('SPOJ', 'Developer & Code', (h) => `https://www.spoj.com/users/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Kattis', 'Developer & Code', (h) => `https://open.kattis.com/users/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('DMOJ', 'Developer & Code', (h) => `https://dmoj.ca/user/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('CodinGame', 'Developer & Code', (h) => `https://www.codingame.com/profile/${encodeURIComponent(h)}`),
  {
    platform: 'Project Euler',
    category: 'Developer & Code',
    urlFn: (h) => `https://projecteuler.net/profile/${encodeURIComponent(h)}.txt`,
    htmlCheck: {
      acceptHeader: 'text/plain',
      notFoundMarkers: ['no data', 'not found', 'error'],
      foundMarkers: (_low, raw) => raw.trim().length > 2 && raw.includes(','),
    },
  },
  makeHtmlProfileTarget('Devpost', 'Developer & Code', (h) => `https://devpost.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Hackster.io', 'Developer & Code', (h) => `https://www.hackster.io/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('HackTheBox', 'Developer & Code', (h) => `https://app.hackthebox.com/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Intigriti', 'Developer & Code', (h) => `https://app.intigriti.com/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('YesWeHack', 'Developer & Code', (h) => `https://yeswehack.com/hunters/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Immunefi', 'Developer & Code', (h) => `https://immunefi.com/profile/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('PentesterLab', 'Developer & Code', (h) => `https://pentesterlab.com/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Mozilla Add-ons', 'Developer & Code', (h) => `https://addons.mozilla.org/en-US/firefox/user/${encodeURIComponent(h)}/`, { brandNeedle: 'firefox' }),
  makeHtmlProfileTarget('Weblate', 'Developer & Code', (h) => `https://hosted.weblate.org/user/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Crowdin', 'Developer & Code', (h) => `https://crowdin.com/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Transifex', 'Developer & Code', (h) => `https://www.transifex.com/user/profile/${encodeURIComponent(h)}/`),
  // 18 StackExchange Network API targets
  makeStackExchangeTarget('SuperUser (StackExchange)', 'superuser', 'superuser.com'),
  makeStackExchangeTarget('AskUbuntu', 'askubuntu', 'askubuntu.com'),
  makeStackExchangeTarget('ServerFault', 'serverfault', 'serverfault.com'),
  makeStackExchangeTarget('InfoSec StackExchange', 'security', 'security.stackexchange.com'),
  makeStackExchangeTarget('Math StackExchange', 'math', 'math.stackexchange.com'),
  makeStackExchangeTarget('Cross Validated (Stats)', 'stats', 'stats.stackexchange.com'),
  makeStackExchangeTarget('Unix & Linux SE', 'unix', 'unix.stackexchange.com'),
  makeStackExchangeTarget('Software Engineering SE', 'softwareengineering', 'softwareengineering.stackexchange.com'),
  makeStackExchangeTarget('Cryptography SE', 'crypto', 'crypto.stackexchange.com'),
  makeStackExchangeTarget('Reverse Engineering SE', 'reverseengineering', 'reverseengineering.stackexchange.com'),
  makeStackExchangeTarget('Database Admins SE', 'dba', 'dba.stackexchange.com'),
  makeStackExchangeTarget('Webmasters SE', 'webmasters', 'webmasters.stackexchange.com'),
  makeStackExchangeTarget('Ask Different (Apple)', 'apple', 'apple.stackexchange.com'),
  makeStackExchangeTarget('Android Enthusiasts SE', 'android', 'android.stackexchange.com'),
  makeStackExchangeTarget('Arqade (Gaming SE)', 'gaming', 'gaming.stackexchange.com'),
  makeStackExchangeTarget('English Language SE', 'english', 'english.stackexchange.com'),
  makeStackExchangeTarget('Sci-Fi & Fantasy SE', 'scifi', 'scifi.stackexchange.com'),
  makeStackExchangeTarget('Code Golf SE', 'codegolf', 'codegolf.stackexchange.com'),
  makeHtmlProfileTarget('Lovable', 'Developer & Code', (h) => `https://lovable.dev/@${encodeURIComponent(h)}`, { brandNeedle: 'lovable', rejectRedirect: ['/login', '/404'] }),
  makeHtmlProfileTarget('Lovable App', 'Productivity & Cloud', (h) => `https://${encodeURIComponent(h.toLowerCase())}.lovable.app`, { subdomain: true }),
  {
    platform: 'Unavatar',
    category: 'Social & Community',
    urlFn: (h) => `https://unavatar.io/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://unavatar.io/github/${encodeURIComponent(h)}?json&fallback=false`,
    extractJson: (data, h) => {
      const url = asStr(asObj(data)?.url);
      if (!url) return { status: 'not_found' };
      return {
        status: 'found',
        displayName: h,
        avatarUrl: url,
        url,
      };
    },
  },
];

// ---------------------------------------------------------------------------
// EXTRA BLACKBIRD TARGETS (+56 Platforms): Games, Quizzes, EdTech, Audio, Anime
// ---------------------------------------------------------------------------
export const EXTRA_BLACKBIRD_TARGETS: PlatformSweepTarget[] = [
  makeHtmlProfileTarget('Kahoot!', 'Social & Community', (h) => `https://create.kahoot.it/profiles/${encodeURIComponent(h)}`, { brandNeedle: 'kahoot' }),
  makeHtmlProfileTarget('Quizlet', 'Social & Community', (h) => `https://quizlet.com/user/${encodeURIComponent(h)}/sets`),
  makeHtmlProfileTarget('Khan Academy', 'Social & Community', (h) => `https://www.khanacademy.org/profile/${encodeURIComponent(h)}`, { brandNeedle: 'khan academy' }),
  makeHtmlProfileTarget('Coursera', 'Productivity & Cloud', (h) => `https://www.coursera.org/user/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Udemy', 'Productivity & Cloud', (h) => `https://www.udemy.com/user/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('edX', 'Productivity & Cloud', (h) => `https://profile.edx.org/u/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Skillshare', 'Productivity & Cloud', (h) => `https://www.skillshare.com/en/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Brilliant', 'Social & Community', (h) => `https://brilliant.org/profile/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Memrise', 'Social & Community', (h) => `https://app.memrise.com/user/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('SoloLearn', 'Developer & Code', (h) => `https://www.sololearn.com/en/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('W3Schools Profile', 'Developer & Code', (h) => `https://www.w3profile.com/${encodeURIComponent(h)}`, { brandNeedle: 'w3' }),
  makeHtmlProfileTarget('Poki', 'Social & Community', (h) => `https://poki.com/en/user/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Armor Games', 'Social & Community', (h) => `https://armorgames.com/user/${encodeURIComponent(h)}`, { brandNeedle: 'armor' }),
  makeHtmlProfileTarget('Miniclip', 'Social & Community', (h) => `https://www.miniclip.com/players/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('PSNProfiles', 'Social & Community', (h) => `https://psnprofiles.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('XboxGamertag', 'Social & Community', (h) => `https://xboxgamertag.com/search/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('FortniteTracker', 'Social & Community', (h) => `https://fortnitetracker.com/profile/all/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('OP.GG', 'Social & Community', (h) => `https://www.op.gg/summoners/na/${encodeURIComponent(h)}`, { brandNeedle: 'op.gg' }),
  makeHtmlProfileTarget('FACEIT', 'Social & Community', (h) => `https://www.faceit.com/en/players/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Liquipedia', 'Social & Community', (h) => `https://liquipedia.net/commons/User:${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Nexus Mods', 'Social & Community', (h) => `https://www.nexusmods.com/users/${encodeURIComponent(h)}`, { brandNeedle: 'nexus' }),
  makeHtmlProfileTarget('VRChat', 'Social & Community', (h) => `https://vrchat.com/home/user/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('SteamLadder', 'Social & Community', (h) => `https://steamladder.com/profile/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('RetroAchievements', 'Social & Community', (h) => `https://retroachievements.org/user/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Trackmania.io', 'Social & Community', (h) => `https://trackmania.io/#/player/${encodeURIComponent(h)}`),
  {
    platform: 'Kitsu',
    category: 'Social & Community',
    urlFn: (h) => `https://kitsu.app/users/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://kitsu.io/api/edge/users?filter[name]=${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const arr = asObj(data)?.data;
      if (!Array.isArray(arr) || arr.length === 0) return { status: 'not_found' };
      const item = asObj(arr[0]);
      const attrs = asObj(item?.attributes);
      if (!item || !attrs?.name) return { status: 'not_found' };
      const avatar = asObj(attrs.avatar);
      return {
        status: 'found',
        id: asStr(item.id),
        displayName: asStr(attrs.name),
        avatarUrl: asStr(avatar?.large) || asStr(avatar?.medium),
        bio: asStr(attrs.about),
        location: asStr(attrs.location),
        createdAt: asStr(attrs.createdAt),
        followers: asNum(attrs.followersCount),
      };
    },
  },
  {
    platform: 'Shikimori',
    category: 'Social & Community',
    urlFn: (h) => `https://shikimori.one/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://shikimori.one/api/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.nickname) return { status: 'not_found' };
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.nickname),
        avatarUrl: asStr(asObj(obj.image)?.x160) || asStr(obj.avatar),
        url: asStr(obj.url),
      };
    },
  },
  {
    platform: 'Audius',
    category: 'Social & Community',
    urlFn: (h) => `https://audius.co/${encodeURIComponent(h)}`,
    apiUrlFn: (h) =>
      `https://discoveryprovider.audius.co/v1/users/handle/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const d = asObj(asObj(data)?.data);
      if (!d || !d.handle) return { status: 'not_found' };
      const pic = asObj(d.profile_picture);
      return {
        status: 'found',
        id: asStr(d.id),
        displayName: asStr(d.name) || asStr(d.handle),
        avatarUrl: asStr(pic?.['480x480']) || asStr(pic?.['150x150']),
        bio: asStr(d.bio),
        location: asStr(d.location),
        followers: asNum(d.follower_count),
      };
    },
  },
  {
    platform: 'Discogs',
    category: 'Social & Community',
    urlFn: (h) => `https://www.discogs.com/user/${encodeURIComponent(h)}`,
    apiUrlFn: (h) => `https://api.discogs.com/users/${encodeURIComponent(h)}`,
    extractJson: (data) => {
      const obj = asObj(data);
      if (!obj || !obj.username) return { status: 'not_found' };
      return {
        status: 'found',
        id: obj.id !== undefined ? String(obj.id) : undefined,
        displayName: asStr(obj.name) || asStr(obj.username),
        avatarUrl: asStr(obj.avatar_url),
        location: asStr(obj.location),
        bio: asStr(obj.profile),
        createdAt: asStr(obj.registered),
        url: asStr(obj.uri),
      };
    },
  },
  makeHtmlProfileTarget('Anime-Planet', 'Social & Community', (h) => `https://www.anime-planet.com/users/${encodeURIComponent(h)}`, { brandNeedle: 'anime-planet' }),
  makeHtmlProfileTarget('MyDramaList', 'Social & Community', (h) => `https://mydramalist.com/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('The StoryGraph', 'Social & Community', (h) => `https://app.thestorygraph.com/profile/${encodeURIComponent(h)}`, { brandNeedle: 'storygraph' }),
  makeHtmlProfileTarget('LibraryThing', 'Social & Community', (h) => `https://www.librarything.com/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Royal Road', 'Social & Community', (h) => `https://www.royalroad.com/profile/${encodeURIComponent(h)}`, { brandNeedle: 'royal road' }),
  makeHtmlProfileTarget('Scribble Hub', 'Social & Community', (h) => `https://www.scribblehub.com/profile/${encodeURIComponent(h)}/`, { brandNeedle: 'scribble' }),
  makeHtmlProfileTarget('Webnovel', 'Social & Community', (h) => `https://www.webnovel.com/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('TMDB', 'Social & Community', (h) => `https://www.themoviedb.org/u/${encodeURIComponent(h)}`, { brandNeedle: 'tmdb' }),
  makeHtmlProfileTarget('Genius', 'Social & Community', (h) => `https://genius.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('RateYourMusic', 'Social & Community', (h) => `https://rateyourmusic.com/~${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('MuseScore', 'Social & Community', (h) => `https://musescore.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('BandLab', 'Social & Community', (h) => `https://www.bandlab.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('ReverbNation', 'Social & Community', (h) => `https://www.reverbnation.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Freesound', 'Social & Community', (h) => `https://freesound.org/people/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('PromoDJ', 'Social & Community', (h) => `https://promodj.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Hearthis.at', 'Social & Community', (h) => `https://hearthis.at/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('500px', 'Social & Community', (h) => `https://500px.com/p/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Polywork', 'Social & Community', (h) => `https://www.polywork.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Read.cv', 'Social & Community', (h) => `https://read.cv/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Layers.to', 'Social & Community', (h) => `https://layers.to/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('YouPic', 'Social & Community', (h) => `https://youpic.com/photographer/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Contently', 'Social & Community', (h) => `https://${encodeURIComponent(h.toLowerCase())}.contently.com/`, { subdomain: true, rejectRedirect: ['https://contently.com/', 'http://contently.com/', '/login', '/404'] }),
  makeHtmlProfileTarget('Clippings.me', 'Social & Community', (h) => `https://www.clippings.me/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Crevado', 'Social & Community', (h) => `https://${encodeURIComponent(h.toLowerCase())}.crevado.com/`, { subdomain: true }),
  makeHtmlProfileTarget('Coroflot', 'Social & Community', (h) => `https://www.coroflot.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Carbonmade', 'Social & Community', (h) => `https://${encodeURIComponent(h.toLowerCase())}.carbonmade.com/`, { subdomain: true }),
  makeHtmlProfileTarget('PlayCanvas', 'Developer & Code', (h) => `https://playcanvas.com/${encodeURIComponent(h)}`),
];

// ---------------------------------------------------------------------------
// EXTRA SHERLOCK TARGETS (+56 Platforms): Fediverse, Wikis, Creator, Commerce, Finance
// ---------------------------------------------------------------------------
export const EXTRA_SHERLOCK_TARGETS: PlatformSweepTarget[] = [
  // 17 Additional Mastodon Fediverse Servers (live JSON API)
  makeMastodonTarget('Fosstodon', 'fosstodon.org'),
  makeMastodonTarget('Infosec.exchange', 'infosec.exchange'),
  makeMastodonTarget('Hachyderm.io', 'hachyderm.io'),
  makeMastodonTarget('TechHub.social', 'techhub.social'),
  makeMastodonTarget('Mstdn.social', 'mstdn.social'),
  makeMastodonTarget('Mas.to', 'mas.to'),
  makeMastodonTarget('Chaos.social', 'chaos.social'),
  makeMastodonTarget('IOC.exchange', 'ioc.exchange'),
  makeMastodonTarget('Defcon.social', 'defcon.social'),
  makeMastodonTarget('Kolektiva.social', 'kolektiva.social'),
  makeMastodonTarget('Universeodon', 'universeodon.com'),
  makeMastodonTarget('SFBA.social', 'sfba.social'),
  makeMastodonTarget('FediScience', 'fediscience.org'),
  makeMastodonTarget('Mastodon.online', 'mastodon.online'),
  makeMastodonTarget('Mastodon.world', 'mastodon.world'),
  makeMastodonTarget('Mastodon.cloud', 'mastodon.cloud'),
  makeMastodonTarget('Vivaldi Social', 'social.vivaldi.net'),
  // 8 Lemmy Fediverse Servers (live JSON API)
  makeLemmyTarget('Lemmy.world', 'lemmy.world'),
  makeLemmyTarget('Lemmy.ml', 'lemmy.ml'),
  makeLemmyTarget('Programming.dev (Lemmy)', 'programming.dev'),
  makeLemmyTarget('Sh.itjust.works', 'sh.itjust.works'),
  makeLemmyTarget('Beehaw', 'beehaw.org'),
  makeLemmyTarget('Feddit.org', 'feddit.org'),
  makeLemmyTarget('Sopuli.xyz', 'sopuli.xyz'),
  makeLemmyTarget('Lemm.ee', 'lemm.ee'),
  // 9 Wikimedia Global Projects (live JSON API)
  makeMediaWikiTarget('Wikimedia Commons', 'commons.wikimedia.org', 'Social & Community'),
  makeMediaWikiTarget('Wikidata', 'www.wikidata.org', 'Developer & Code'),
  makeMediaWikiTarget('Wikipedia (Hindi)', 'hi.wikipedia.org', 'Social & Community'),
  makeMediaWikiTarget('Wikibooks', 'en.wikibooks.org', 'Social & Community'),
  makeMediaWikiTarget('Wikiversity', 'en.wikiversity.org', 'Social & Community'),
  makeMediaWikiTarget('Wikisource', 'en.wikisource.org', 'Social & Community'),
  makeMediaWikiTarget('Wiktionary', 'en.wiktionary.org', 'Social & Community'),
  makeMediaWikiTarget('Wikinews', 'en.wikinews.org', 'Social & Community'),
  makeMediaWikiTarget('Wikivoyage', 'en.wikivoyage.org', 'Social & Community'),
  // Additional Creator, Publishing, Web3, Sports & E-Commerce
  makeHtmlProfileTarget('Micro.blog', 'Social & Community', (h) => `https://micro.blog/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Bear Blog', 'Social & Community', (h) => `https://${encodeURIComponent(h.toLowerCase())}.bearblog.dev/`, { subdomain: true }),
  makeHtmlProfileTarget('Write.as', 'Social & Community', (h) => `https://write.as/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Beacons.ai', 'Social & Community', (h) => `https://beacons.ai/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('XDA Developers', 'Developer & Code', (h) => `https://xdaforums.com/m/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('9GAG', 'Social & Community', (h) => `https://9gag.com/u/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Imgflip', 'Social & Community', (h) => `https://imgflip.com/user/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Vero', 'Social & Community', (h) => `https://vero.co/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Gab', 'Social & Community', (h) => `https://gab.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Bitcointalk', 'Network & Infrastructure', (h) => `https://bitcointalk.org/index.php?action=profile;u=${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('OpenSea', 'Network & Infrastructure', (h) => `https://opensea.io/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Warpcast (Farcaster)', 'Social & Community', (h) => `https://warpcast.com/${encodeURIComponent(h)}`, { brandNeedle: 'warpcast' }),
  makeHtmlProfileTarget('Strava', 'Social & Community', (h) => `https://www.strava.com/athletes/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('AllTrails', 'Social & Community', (h) => `https://www.alltrails.com/members/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Komoot', 'Social & Community', (h) => `https://www.komoot.com/user/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Couchsurfing', 'Social & Community', (h) => `https://www.couchsurfing.com/people/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Vivino', 'Social & Community', (h) => `https://www.vivino.com/users/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('TripAdvisor', 'Social & Community', (h) => `https://www.tripadvisor.com/Profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Poshmark', 'Social & Community', (h) => `https://poshmark.com/closet/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Depop', 'Social & Community', (h) => `https://www.depop.com/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Etsy', 'Social & Community', (h) => `https://www.etsy.com/shop/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Fiverr', 'Productivity & Cloud', (h) => `https://www.fiverr.com/${encodeURIComponent(h)}`),
];

// Live Email-Specific Registration & Identity Verification Probes (Strict Email Mode — zero username-prefix guessing)
const PROBE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

async function safeProbeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 4200
): Promise<{ status: number; text: string; json: unknown; headers?: Headers }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': PROBE_UA,
        ...(init.headers || {}),
      },
    });
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: res.status, text, json, headers: res.headers };
  } catch {
    return { status: 0, text: '', json: null };
  } finally {
    clearTimeout(timer);
  }
}

type ProbeHookResult = NonNullable<
  Awaited<ReturnType<NonNullable<PlatformSweepTarget['customProbeFn']>>>
>;

export async function probeFacebookIdentify(
  identifier: string
): Promise<ProbeHookResult> {
  const initRes = await safeProbeFetch(
    'https://www.facebook.com/login/identify/?ctx=recover&ars=facebook_login',
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    },
    6500
  );

  if (!initRes.text) {
    return { status: 'not_checked', httpStatus: initRes.status };
  }

  const setCookies = initRes.headers?.getSetCookie
    ? initRes.headers.getSetCookie()
    : [];
  const cookies = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');

  const formMatch =
    initRes.text.match(/<form[^>]*id="identify_yourself_flow"[\s\S]*?<\/form>/i)?.[0] ||
    initRes.text;
  const params = new URLSearchParams();
  for (const m of formMatch.matchAll(
    /<input[^>]*name="([^"]+)"[^>]*value="([^"]*)"/gi
  )) {
    params.set(m[1], m[2]);
  }
  const lsd =
    params.get('lsd') ||
    initRes.text.match(/\["LSD",\[\],\{"token":"([^"]+)"\}/)?.[1] ||
    '';
  if (!lsd) {
    return { status: 'not_checked', httpStatus: initRes.status };
  }
  params.set('lsd', lsd);
  params.set('email', identifier);
  params.set('did_submit', '1');

  const spinR = initRes.text.match(/"__spin_r":(\d+)/)?.[1];
  const spinT = initRes.text.match(/"__spin_t":(\d+)/)?.[1];
  const spinB = initRes.text.match(/"__spin_b":"([^"]+)"/)?.[1];
  if (spinR) params.set('__spin_r', spinR);
  if (spinT) params.set('__spin_t', spinT);
  if (spinB) params.set('__spin_b', spinB);
  params.set('__a', '1');
  params.set('__user', '0');

  const checkRes = await safeProbeFetch(
    'https://www.facebook.com/ajax/login/help/identify.php?ctx=recover',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://www.facebook.com',
        Referer: 'https://www.facebook.com/login/identify/?ctx=recover&ars=facebook_login',
        ...(cookies ? { Cookie: cookies } : {}),
        'X-FB-LSD': lsd,
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
      },
      body: params.toString(),
    },
    6500
  );

  const rawBody = checkRes.text.replace(/^for\s*\(\s*;\s*;\s*\);\s*/, '');
  if (!rawBody) {
    return { status: 'not_checked', httpStatus: checkRes.status };
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = asObj(JSON.parse(rawBody));
  } catch {
    parsed = null;
  }

  if (parsed?.error || parsed?.errorSummary) {
    return { status: 'not_checked', httpStatus: checkRes.status };
  }

  const hasRecoverRedirect =
    rawBody.includes('redirectPageTo') || rawBody.includes('/recover/initiate/');
  if (hasRecoverRedirect) {
    const ldataMatch = rawBody.match(/"(\\\/recover\\\/initiate\\\/\?ldata=[^"]+)"/);
    const ldataPath = ldataMatch?.[1]?.replace(/\\\//g, '/');
    let recoveredName: string | undefined;
    let recoveredAvatar: string | undefined;
    if (ldataPath) {
      const recRes = await safeProbeFetch(
        `https://www.facebook.com${ldataPath}`,
        {
          headers: {
            Accept: 'text/html,application/xhtml+xml',
            ...(cookies ? { Cookie: cookies } : {}),
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'same-origin',
          },
        },
        4500
      );
      if (recRes.text) {
        const nameHit = recRes.text.match(/class="[^"]*fsl fwb fcb[^"]*"[^>]*>([^<]{2,80})</i)?.[1];
        if (nameHit && !/facebook|log in|identify|recover/i.test(nameHit)) {
          recoveredName = nameHit.trim();
        }
        const avatarHit =
          recRes.text.match(/https:(?:\\u002[fF]|\\\/|\/){2}scontent[^"'\s<>\\]+/i)?.[0] ||
          recRes.text.match(/https:(?:\\u002[fF]|\\\/|\/){2}graph\.facebook\.com[^"'\s<>\\]+/i)?.[0] ||
          recRes.text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["'](https:\/\/[^"']+)["']/i)?.[1];
        if (avatarHit) {
          const cleaned = avatarHit
            .replace(/\\u002[fF]/g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\u003[dD]/g, '=')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&')
            .trim();
          if (!cleaned.includes('static.xx.fbcdn.net/rsrc.php')) {
            recoveredAvatar = cleaned;
          }
        }
      }
    }

    if (!recoveredAvatar) {
      const inlineAvatar =
        rawBody.match(/https:(?:\\u002[fF]|\\\/|\/){2}scontent[^"'\s<>\\]+/i)?.[0] ||
        rawBody.match(/https:(?:\\u002[fF]|\\\/|\/){2}graph\.facebook\.com[^"'\s<>\\]+/i)?.[0];
      if (inlineAvatar) {
        const cleaned = inlineAvatar
          .replace(/\\u002[fF]/g, '/')
          .replace(/\\u0026/g, '&')
          .replace(/\\u003[dD]/g, '=')
          .replace(/\\\//g, '/')
          .replace(/&amp;/g, '&')
          .trim();
        if (!cleaned.includes('static.xx.fbcdn.net/rsrc.php')) {
          recoveredAvatar = cleaned;
        }
      }
    }

    return {
      status: 'found',
      httpStatus: checkRes.status,
      displayName: recoveredName || identifier,
      avatarUrl: recoveredAvatar,
      url: 'https://www.facebook.com/login/identify/',
      bio: `Registered Meta / Facebook account confirmed via live identify recovery graph (zero OTP sent).`,
      extraFields: [
        { label: 'Meta Account', value: 'Registered (Recovery Flow Confirmed)' },
        ...(recoveredName ? [{ label: 'Profile Label', value: recoveredName, copyable: true }] : []),
        { label: 'Verification Method', value: 'Live Identify Endpoint (Zero OTP)' },
      ],
    };
  }

  const domops = Array.isArray(parsed?.domops) ? parsed.domops : [];
  const hasSearchNotFound = domops.some(
    (entry) => Array.isArray(entry) && entry[1] === '#account_search'
  );
  if (hasSearchNotFound || rawBody.includes('#account_search')) {
    return {
      status: 'not_found',
      httpStatus: checkRes.status,
      url: 'https://www.facebook.com/login/identify/',
      bio: `No Facebook / Meta account matched ${identifier}.`,
    };
  }

  return { status: 'not_checked', httpStatus: checkRes.status };
}

export async function probeInstagramAccount(
  identifier: string,
  mode: 'email' | 'phone'
): Promise<ProbeHookResult> {
  const initRes = await safeProbeFetch(
    'https://www.instagram.com/accounts/emailsignup/',
    {
      headers: {
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
      },
    },
    5500
  );

  const initCookies = initRes.headers?.getSetCookie
    ? initRes.headers.getSetCookie()
    : [];
  let cookiePairs = initCookies.map((c) => c.split(';')[0]).filter(Boolean);
  let cookiesStr = cookiePairs.join('; ');
  let csrfToken =
    cookiesStr.match(/csrftoken=([^;]+)/)?.[1] ||
    initRes.text.match(/"csrf_token":"([^"]+)"/)?.[1] ||
    '';
  let appId =
    initRes.text.match(/"X-IG-App-ID":"([^"]+)"/)?.[1] || '936619743392459';

  if (!csrfToken) {
    const loginWarmup = await safeProbeFetch(
      'https://www.instagram.com/accounts/login/',
      {
        headers: {
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      },
      5000
    );
    const loginCookies = loginWarmup.headers?.getSetCookie
      ? loginWarmup.headers.getSetCookie()
      : [];
    cookiePairs = loginCookies.map((c) => c.split(';')[0]).filter(Boolean);
    cookiesStr = cookiePairs.join('; ');
    csrfToken =
      cookiesStr.match(/csrftoken=([^;]+)/)?.[1] ||
      loginWarmup.text.match(/"csrf_token":"([^"]+)"/)?.[1] ||
      '';
    appId =
      loginWarmup.text.match(/"X-IG-App-ID":"([^"]+)"/)?.[1] || appId;
  }

  if (csrfToken) {
    const formParams = new URLSearchParams(
      mode === 'email'
        ? {
            email: identifier,
            username: '',
            first_name: '',
            opt_into_one_tap: 'false',
          }
        : {
            phone_number: identifier,
            username: '',
            first_name: '',
            opt_into_one_tap: 'false',
          }
    );

    const attemptRes = await safeProbeFetch(
      'https://www.instagram.com/api/v1/web/accounts/web_create_ajax/attempt/',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: '*/*',
          'X-CSRFToken': csrfToken,
          'X-IG-App-ID': appId,
          'X-Requested-With': 'XMLHttpRequest',
          Origin: 'https://www.instagram.com',
          Referer: 'https://www.instagram.com/accounts/emailsignup/',
          Cookie: cookiesStr || `csrftoken=${csrfToken}`,
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: formParams.toString(),
      },
      5500
    );

    const obj = asObj(attemptRes.json);
    const errorsObj = asObj(obj?.errors);
    const fieldErr = errorsObj?.[mode === 'email' ? 'email' : 'phone_number'];
    if (attemptRes.status === 200 && obj) {
      if (Array.isArray(fieldErr) && fieldErr.length > 0) {
        const errJoined = fieldErr
          .map((e) => `${asStr(asObj(e)?.code) || ''} ${asStr(asObj(e)?.message) || ''}`)
          .join(' ')
          .toLowerCase();
        if (
          errJoined.includes('taken') ||
          errJoined.includes('another account') ||
          errJoined.includes('already') ||
          errJoined.includes('in use')
        ) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: identifier,
            url: 'https://www.instagram.com/',
            bio: `Registered Instagram account confirmed via live signup validation (zero OTP/email sent).`,
            extraFields: [
              { label: 'Instagram Status', value: 'Registered (Identifier In Use)' },
              { label: 'Verification Method', value: 'Web Create Attempt Check' },
            ],
          };
        }
        if (errJoined.includes('invalid') || errJoined.includes('valid')) {
          return { status: 'not_checked', httpStatus: 200 };
        }
      } else if (obj.status === 'ok' || errorsObj) {
        return {
          status: 'not_found',
          httpStatus: 200,
          url: 'https://www.instagram.com/',
          bio: `No Instagram account registered with ${identifier}.`,
        };
      }
    }
  }

  // Fallback passive Android API lookup with skip_recovery=1 (prevents sending email/SMS)
  if (csrfToken) {
    const lookupRes = await safeProbeFetch(
      'https://i.instagram.com/api/v1/users/lookup/',
      {
        method: 'POST',
        headers: {
          'User-Agent': 'Instagram 275.0.0.27.98 Android (31/12; 420dpi; 1080x2400; Google; Pixel 6; oriole; oriole; en_US; 458229237)',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: '*/*',
          'X-CSRFToken': csrfToken,
          Cookie: cookiesStr || `csrftoken=${csrfToken}`,
          'Sec-Fetch-Dest': 'empty',
          'Sec-Fetch-Mode': 'cors',
          'Sec-Fetch-Site': 'same-origin',
        },
        body: new URLSearchParams({
          q: identifier,
          skip_recovery: '1',
        }).toString(),
      },
      5500
    );

    const lObj = asObj(lookupRes.json);
    const lUser = asObj(lObj?.user);
    if (
      lookupRes.status === 200 &&
      lObj &&
      (lObj.can_email_reset === true ||
        lObj.can_sms_reset === true ||
        lObj.has_valid_phone === true ||
        Boolean(lObj.obfuscated_email) ||
        Boolean(lObj.obfuscated_phone) ||
        Boolean(lUser?.username))
    ) {
      const uname = asStr(lUser?.username);
      const maskedEmail = asStr(lObj.obfuscated_email);
      const maskedPhone = asStr(lObj.obfuscated_phone);
      const rawIgPic =
        asStr(asObj(lUser?.hd_profile_pic_url_info)?.url) ||
        asStr(lUser?.profile_pic_url_hd) ||
        asStr(lUser?.profile_pic_url);
      let igAvatar = rawIgPic
        ?.replace(/\\u002[fF]/g, '/')
        .replace(/\\u0026/g, '&')
        .replace(/\\\//g, '/');

      if (!igAvatar && uname) {
        const unavIg = await safeProbeFetch(
          `https://unavatar.io/instagram/${encodeURIComponent(uname)}?json&fallback=false`,
          { headers: { Accept: 'application/json' } },
          3500
        );
        const unavIgUrl = asStr(asObj(unavIg.json)?.url);
        if (unavIgUrl) igAvatar = unavIgUrl;
      }

      return {
        status: 'found',
        httpStatus: 200,
        id: lUser?.pk !== undefined ? String(lUser.pk) : undefined,
        displayName: uname ? `@${uname}` : identifier,
        verifiedUsername: uname,
        avatarUrl: igAvatar,
        url: uname
          ? `https://www.instagram.com/${encodeURIComponent(uname)}/`
          : 'https://www.instagram.com/',
        bio: `Instagram account confirmed${maskedEmail ? ` · Recovery email: ${maskedEmail}` : ''}${maskedPhone ? ` · Phone: ${maskedPhone}` : ''}.`,
        extraFields: [
          ...(uname ? [{ label: 'Username', value: `@${uname}`, copyable: true }] : []),
          ...(maskedEmail ? [{ label: 'Masked Email', value: maskedEmail, copyable: true }] : []),
          ...(maskedPhone ? [{ label: 'Masked Phone', value: maskedPhone, copyable: true }] : []),
        ],
      };
    }

    const msg = asStr(lObj?.message)?.toLowerCase() || '';
    if (lookupRes.status === 404 || msg.includes('no users found')) {
      return {
        status: 'not_found',
        httpStatus: lookupRes.status || 404,
        url: 'https://www.instagram.com/',
        bio: `No Instagram account found for ${identifier}.`,
      };
    }
    return { status: 'not_checked', httpStatus: lookupRes.status || initRes.status };
  }

  return { status: 'not_checked', httpStatus: initRes.status };
}

export async function probeFlipkartAccount(
  loginId: string,
  mode: 'email' | 'phone'
): Promise<ProbeHookResult> {
  const res = await safeProbeFetch(
    'https://1.rome.api.flipkart.com/api/6/user/signup/status',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-User-Agent': `${PROBE_UA} FKUA/website/42/website/Desktop`,
        Origin: 'https://www.flipkart.com',
        Referer: 'https://www.flipkart.com/',
      },
      body: JSON.stringify({
        loginId,
        supportAllStates: true,
      }),
    },
    6500
  );

  const root = asObj(res.json);
  const resp = asObj(root?.RESPONSE);
  const details = asObj(resp?.userDetails);
  const rawState = details ? asStr(details[loginId]) : undefined;
  const state = rawState?.toUpperCase();

  if (state === 'VERIFIED' || state === 'NOT_VERIFIED') {
    return {
      status: 'found',
      httpStatus: res.status || 200,
      displayName: state === 'VERIFIED' ? 'Flipkart Verified Account' : 'Flipkart Registered Account',
      url: 'https://www.flipkart.com/account/login',
      bio: `Registered Flipkart customer account (${state}) confirmed for ${loginId} (zero OTP sent).`,
      extraFields: [
        { label: 'Account State', value: `${state} (Registered)` },
        { label: mode === 'phone' ? 'Phone' : 'Email', value: loginId, copyable: true },
        { label: 'Verification Method', value: 'Zero-OTP Signup Status API' },
      ],
    };
  }
  if (state === 'GUEST' || state === 'NOT_FOUND') {
    return {
      status: 'not_found',
      httpStatus: res.status || 200,
      url: 'https://www.flipkart.com/account/login',
      bio: `No Flipkart account registered for ${loginId} (returned ${state}).`,
    };
  }
  return {
    status: 'not_checked',
    httpStatus: res.status,
    url: 'https://www.flipkart.com/account/login',
  };
}

function makeFirebaseAuthEmailProbe(
  platform: string,
  category: PlatformSweepTarget['category'],
  homeUrl: string,
  apiKey: string,
  cleanEmail: string
): PlatformSweepTarget {
  const origin = new URL(homeUrl).origin;
  return {
    platform,
    category,
    isLiveVerification: true,
    urlFn: () => homeUrl,
    customProbeFn: async () => {
      const res = await safeProbeFetch(
        `https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Origin: origin,
            Referer: homeUrl,
          },
          body: JSON.stringify({
            identifier: cleanEmail,
            continueUri: homeUrl,
          }),
        },
        5500
      );
      const obj = asObj(res.json);
      if (res.status === 200 && obj && typeof obj.registered === 'boolean') {
        if (!obj.registered) {
          return { status: 'not_found', httpStatus: 200 };
        }
        const methods = Array.isArray(obj.signinMethods)
          ? obj.signinMethods.filter((m): m is string => typeof m === 'string')
          : Array.isArray(obj.allProviders)
          ? obj.allProviders.filter((m): m is string => typeof m === 'string')
          : [];
        return {
          status: 'found',
          httpStatus: 200,
          displayName: cleanEmail,
          url: homeUrl,
          extraFields: [
            {
              label: 'Sign-In Methods',
              value: methods.length > 0 ? methods.join(', ') : 'Email / OAuth',
            },
          ],
        };
      }
      return { status: 'not_checked', httpStatus: res.status };
    },
  };
}

function makeAuthGateEmailProbe(
  platform: string,
  category: PlatformSweepTarget['category'],
  homeUrl: string,
  checkUrl: string,
  method: 'GET' | 'POST' = 'POST',
  bodyObj?: Record<string, unknown>,
  extraHeaders: Record<string, string> = {}
): PlatformSweepTarget {
  return {
    platform,
    category,
    urlFn: () => homeUrl,
    customProbeFn: async () => {
      const res = await safeProbeFetch(
        checkUrl,
        {
          method,
          headers: {
            Accept: 'application/json',
            ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
            ...extraHeaders,
          },
          ...(method === 'POST' && bodyObj ? { body: JSON.stringify(bodyObj) } : {}),
        },
        1800
      );
      return {
        status: 'not_checked',
        httpStatus: res.status || 403,
        bio: `${platform} blocks unauthenticated email lookup via WAF/anti-enumeration — correlated via verified handles & web/code dorks when present.`,
      };
    },
  };
}

export function buildExtraEmailProbes(email: string): PlatformSweepTarget[] {
  const cleanEmail = email.trim();
  const cleanLower = cleanEmail.toLowerCase();
  const emailMd5 = crypto.createHash('md5').update(cleanLower).digest('hex');

  return [
    {
      platform: 'Unavatar',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => `https://unavatar.io/${encodeURIComponent(cleanLower)}`,
      customProbeFn: async () => {
        const encoded = encodeURIComponent(cleanLower);
        const endpoints = [
          `https://unavatar.io/${encoded}?json&fallback=false`,
          `https://unavatar.io/google/${encoded}?json&fallback=false`,
          `https://unavatar.io/gravatar/${encoded}?json&fallback=false`,
        ];
        let lastStatus = 404;
        for (const ep of endpoints) {
          const res = await safeProbeFetch(
            ep,
            { headers: { Accept: 'application/json' } },
            4200
          );
          if (res.status) lastStatus = res.status;
          const obj = asObj(res.json);
          const avatar = asStr(obj?.url);
          if (res.status >= 200 && res.status < 300 && avatar) {
            return {
              status: 'found',
              httpStatus: res.status,
              displayName: cleanEmail,
              avatarUrl: avatar,
              url: avatar,
              extraFields: [
                { label: 'Avatar Source', value: avatar, copyable: true },
              ],
            };
          }
        }
        // Fallback direct binary image check (handles providers where ?json omits url)
        try {
          const directRes = await fetch(`https://unavatar.io/${encoded}?fallback=false`, {
            method: 'GET',
            redirect: 'follow',
            headers: { 'User-Agent': PROBE_UA, Accept: 'image/*,*/*;q=0.8' },
            signal: AbortSignal.timeout(4000),
          });
          const ctype = (directRes.headers.get('content-type') || '').toLowerCase();
          await directRes.body?.cancel().catch(() => {});
          if (directRes.ok && ctype.startsWith('image/')) {
            const finalImg = directRes.url || `https://unavatar.io/${encoded}?fallback=false`;
            return {
              status: 'found',
              httpStatus: directRes.status,
              displayName: cleanEmail,
              avatarUrl: finalImg,
              url: finalImg,
              extraFields: [{ label: 'Avatar Source', value: finalImg, copyable: true }],
            };
          }
          if (directRes.status) lastStatus = directRes.status;
        } catch {
          // ignore direct timeout
        }
        if (lastStatus === 404) return { status: 'not_found', httpStatus: 404 };
        return {
          status: lastStatus === 0 || lastStatus === 403 || lastStatus === 429 ? 'not_checked' : 'not_found',
          httpStatus: lastStatus,
        };
      },
    },
    {
      platform: 'Libravatar',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => `https://www.libravatar.org/`,
      customProbeFn: async () => {
        const avatar = `https://seccdn.libravatar.org/avatar/${emailMd5}?d=404&s=256`;
        const res = await safeProbeFetch(avatar, { method: 'HEAD' }, 5500);
        if (res.status === 200) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            avatarUrl: avatar,
            url: avatar,
            extraFields: [{ label: 'Federated Hash', value: emailMd5, copyable: true }],
          };
        }
        if (res.status === 404) return { status: 'not_found', httpStatus: 404 };
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Zoho',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://accounts.zoho.com/',
      customProbeFn: async () => {
        const initRes = await safeProbeFetch('https://accounts.zoho.com/signin', {}, 5500);
        const setCookies = initRes.headers?.getSetCookie ? initRes.headers.getSetCookie() : [];
        const pairs = setCookies.map((c) => c.split(';')[0]).filter(Boolean);
        const iamcsr = pairs.find((p) => p.startsWith('iamcsr='));
        const token = iamcsr ? iamcsr.split('=')[1] : '';
        if (!token) {
          return { status: 'not_checked', httpStatus: initRes.status };
        }
        const lookup = await safeProbeFetch(
          `https://accounts.zoho.com/signin/v2/lookup/${encodeURIComponent(cleanEmail)}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Cookie: pairs.join('; '),
              'X-ZCSRF-TOKEN': `iamcsrcoo=${token}`,
              Origin: 'https://accounts.zoho.com',
              Referer: 'https://accounts.zoho.com/signin',
            },
            body: `mode=primary&cli_time=${Date.now()}&servicename=ZohoHome`,
          },
          5500
        );
        const obj = asObj(lookup.json);
        if (!obj) return { status: 'not_checked', httpStatus: lookup.status };
        const lookupObj = asObj(obj.lookup);
        if (lookupObj && (lookupObj.identifier || lookupObj.loginid)) {
          const modes = asObj(lookupObj.modes)?.allowed_modes;
          const modeList = Array.isArray(modes) ? modes.filter((m): m is string => typeof m === 'string') : [];
          return {
            status: 'found',
            httpStatus: lookup.status,
            id: asStr(lookupObj.identifier),
            displayName: asStr(lookupObj.loginid) || cleanEmail,
            extraFields: [
              ...(modeList.length > 0 ? [{ label: 'Auth Modes', value: modeList.join(', ') }] : []),
            ],
          };
        }
        const rawErr = `${String(obj.message || '')} ${String(obj.localized_message || '')}`.toLowerCase();
        if (/hip|captcha|in108|limit/i.test(rawErr)) {
          return { status: 'not_checked', httpStatus: lookup.status };
        }
        if (
          (obj.status_code === 400 || rawErr.includes('does not exist')) &&
          !rawErr.includes('captcha')
        ) {
          return { status: 'not_found', httpStatus: lookup.status };
        }
        return { status: 'not_checked', httpStatus: lookup.status };
      },
    },
    {
      platform: 'Launchpad (Ubuntu)',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () => `https://launchpad.net/`,
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://api.launchpad.net/1.0/people?ws.op=getByEmail&email=${encodeURIComponent(cleanEmail)}`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        if (res.status === 200 && res.text.trim() === 'null') {
          return { status: 'not_found', httpStatus: 200 };
        }
        const obj = asObj(res.json);
        const name = asStr(obj?.name);
        if (res.status === 200 && name) {
          return {
            status: 'found',
            httpStatus: 200,
            id: name,
            displayName: asStr(obj?.display_name) || name,
            verifiedUsername: name,
            avatarUrl: asStr(obj?.logo_link),
            location: asStr(obj?.time_zone),
            createdAt: asStr(obj?.date_created),
            url: asStr(obj?.web_link) || `https://launchpad.net/~${encodeURIComponent(name)}`,
            extraFields: [
              { label: 'Launchpad Handle', value: name, copyable: true },
              ...(asStr(obj?.time_zone)
                ? [{ label: 'Timezone', value: asStr(obj?.time_zone)! }]
                : []),
            ],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Chess.com',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.chess.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://www.chess.com/callback/email/available?email=${encodeURIComponent(cleanEmail)}`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        const obj = asObj(res.json);
        if (!obj || typeof obj.isEmailAvailable !== 'boolean') {
          return { status: 'not_checked', httpStatus: res.status };
        }
        if (obj.isEmailAvailable === false) {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: cleanEmail,
            extraFields: [
              { label: 'Registration Status', value: asStr(obj.reason) || 'Email In Use' },
            ],
          };
        }
        return { status: 'not_found', httpStatus: res.status };
      },
    },
    {
      platform: 'X (Twitter)',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://x.com/',
      customProbeFn: async () => {
        let res = await safeProbeFetch(
          `https://api.x.com/i/users/email_available.json?email=${encodeURIComponent(cleanEmail)}`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        if (!res.json || res.status === 0 || res.status >= 400) {
          res = await safeProbeFetch(
            `https://api.twitter.com/i/users/email_available.json?email=${encodeURIComponent(cleanEmail)}`,
            { headers: { Accept: 'application/json' } },
            5500
          );
        }
        const obj = asObj(res.json);
        if (!obj || typeof obj.taken !== 'boolean') {
          return { status: 'not_checked', httpStatus: res.status };
        }
        if (obj.taken) {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: cleanEmail,
            extraFields: [
              { label: 'Registration Status', value: asStr(obj.msg) || 'Email registered on X' },
            ],
          };
        }
        return { status: 'not_found', httpStatus: res.status };
      },
    },
    {
      platform: 'WordPress.com',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://wordpress.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://public-api.wordpress.com/rest/v1.1/users/${encodeURIComponent(cleanEmail)}/auth-options`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        const obj = asObj(res.json);
        if (res.status === 404 || obj?.error === 'unknown_user') {
          return { status: 'not_found', httpStatus: res.status };
        }
        if (res.status === 200 || obj?.error === 'email_login_not_allowed') {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: cleanEmail,
            extraFields: [
              {
                label: 'Account Status',
                value:
                  obj?.error === 'email_login_not_allowed'
                    ? 'Registered WordPress.com account (username login enforced)'
                    : 'Registered WordPress.com account',
              },
            ],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Microsoft',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://login.live.com/',
      customProbeFn: async () => {
        // 1. Primary fast unthrottled ODC Realm / IDP check
        const odcRes = await safeProbeFetch(
          `https://odc.officeapps.live.com/odc/emailhrd/getidp?hm=1&emailAddress=${encodeURIComponent(
            cleanEmail
          )}`,
          { headers: { Accept: 'text/plain, */*' } },
          5500
        );
        const odcBody = odcRes.text.trim();
        if (odcRes.status === 200 && /^(MSAccount|OrgId|Both)$/i.test(odcBody)) {
          const scopeLabel = /^OrgId$/i.test(odcBody)
            ? 'Microsoft Entra / Work Account (OrgId)'
            : /^Both$/i.test(odcBody)
            ? 'Microsoft Personal (MSA) + Entra Work Account'
            : 'Microsoft Personal (MSA)';
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            url: 'https://login.live.com/',
            bio: `Registered Microsoft account verified via ODC HRD (${odcBody}, zero OTP sent).`,
            extraFields: [
              { label: 'Account Scope', value: scopeLabel },
              { label: 'IDP Realm', value: odcBody },
            ],
          };
        }
        if (odcRes.status === 200 && /^Neither$/i.test(odcBody)) {
          return {
            status: 'not_found',
            httpStatus: 200,
            bio: `No Microsoft / MSA / Entra account registered to ${cleanEmail}.`,
          };
        }

        // 2. Fallback: login.live.com PPFT flowToken + GetCredentialType.srf
        const initRes = await safeProbeFetch(
          'https://login.live.com/',
          { headers: { Accept: 'text/html,application/xhtml+xml' } },
          5500
        );
        const setCookies = initRes.headers?.getSetCookie ? initRes.headers.getSetCookie() : [];
        const cookies = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
        const ppft =
          initRes.text.match(/value=\\"([^\\"]+)\\"/)?.[1] ||
          initRes.text.match(/name="PPFT"[^>]*value="([^"]+)"/)?.[1] ||
          initRes.text.match(/"sFT":"([^"]+)"/)?.[1] ||
          '';
        const credUrl =
          initRes.text.match(/https:\/\/login\.live\.com\/GetCredentialType\.srf\?[^'"\\]+/)?.[0] ||
          'https://login.live.com/GetCredentialType.srf';

        if (!ppft) {
          return { status: 'not_checked', httpStatus: initRes.status || odcRes.status };
        }

        const credRes = await safeProbeFetch(
          credUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...(cookies ? { Cookie: cookies } : {}),
              Origin: 'https://login.live.com',
              Referer: 'https://login.live.com/',
            },
            body: JSON.stringify({
              username: cleanEmail,
              uaId: '',
              isOtherIdpSupported: true,
              checkPhones: false,
              isRemoteNGCSupported: false,
              isCookieBannerShown: false,
              isFidoSupported: false,
              flowToken: ppft,
            }),
          },
          5500
        );
        const obj = asObj(credRes.json);
        if (!obj || typeof obj.IfExistsResult !== 'number' || obj.ThrottleStatus === 1) {
          return { status: 'not_checked', httpStatus: credRes.status };
        }
        const exists =
          obj.IfExistsResult === 0 || obj.IfExistsResult === 5 || obj.IfExistsResult === 6;
        if (!exists) return { status: 'not_found', httpStatus: credRes.status };
        return {
          status: 'found',
          httpStatus: credRes.status,
          displayName: cleanEmail,
          url: 'https://login.live.com/',
          extraFields: [
            {
              label: 'Account Scope',
              value:
                obj.IfExistsResult === 5
                  ? 'Microsoft Personal (MSA)'
                  : obj.IfExistsResult === 0
                  ? 'Microsoft / Entra Account'
                  : 'Federated Microsoft Account',
            },
          ],
        };
      },
    },
    {
      platform: 'Adobe',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://account.adobe.com/',
      apiUrlFn: () => 'https://auth.services.adobe.com/signin/v2/users/accounts',
      apiMethod: 'POST',
      apiHeaders: {
        'Content-Type': 'application/json',
        'X-IMS-ClientId': 'SunbreakWebUI1',
      },
      apiBodyFn: () => JSON.stringify({ username: cleanEmail }),
      extractJson: (data) => {
        if (!Array.isArray(data)) return { status: 'not_checked' };
        if (data.length === 0) return { status: 'not_found' };
        const first = asObj(data[0]);
        const methodsRaw = Array.isArray(first?.authenticationMethods)
          ? first.authenticationMethods
              .map((m) => asStr(asObj(m)?.id))
              .filter((v): v is string => Boolean(v))
          : [];
        return {
          status: 'found',
          displayName: cleanEmail,
          extraFields: [
            {
              label: 'Adobe Account Type',
              value: asStr(first?.type) || 'Individual Adobe ID',
            },
            ...(methodsRaw.length > 0
              ? [{ label: 'Auth Methods', value: methodsRaw.join(', ') }]
              : []),
          ],
        };
      },
    },
    {
      platform: 'Spotify',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.spotify.com/',
      apiUrlFn: () =>
        `https://spclient.wg.spotify.com/signup/public/v1/account?validate=1&email=${encodeURIComponent(
          cleanEmail
        )}`,
      extractJson: (data) => {
        const obj = asObj(data);
        if (!obj || typeof obj.status !== 'number') return { status: 'not_checked' };
        if (obj.status === 20) {
          return {
            status: 'found',
            displayName: cleanEmail,
            url: 'https://www.spotify.com/',
            extraFields: [{ label: 'Registration Status', value: 'Email registered on Spotify' }],
          };
        }
        if (obj.status === 1) {
          return { status: 'not_found' };
        }
        return { status: 'not_checked' };
      },
    },
    {
      platform: 'Firefox Accounts',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://accounts.firefox.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://api.accounts.firefox.com/v1/account/status',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              Origin: 'https://accounts.firefox.com',
              Referer: 'https://accounts.firefox.com/',
            },
            body: JSON.stringify({ email: cleanEmail }),
          },
          5500
        );
        const obj = asObj(res.json);
        if (res.status === 200 && obj && typeof obj.exists === 'boolean') {
          if (!obj.exists) return { status: 'not_found', httpStatus: 200 };
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [{ label: 'Mozilla Sync / FxA', value: 'Active Firefox Account' }],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'LastPass',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://lastpass.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://lastpass.com/create_account.php?check=avail&username=${encodeURIComponent(cleanEmail)}`,
          {},
          5500
        );
        const body = res.text.trim().toLowerCase();
        if (res.status === 200 && body === 'ok') return { status: 'not_found', httpStatus: 200 };
        if (res.status === 200 && (body === 'no' || body.includes('email_exists'))) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [{ label: 'Vault Status', value: 'LastPass account registered' }],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Plurk',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.plurk.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://www.plurk.com/Users/isEmailFound?email=${encodeURIComponent(cleanEmail)}`,
          {},
          5500
        );
        const body = res.text.trim().toLowerCase();
        if (res.status === 200 && body === 'true') {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [{ label: 'Registration Status', value: 'Email registered on Plurk' }],
          };
        }
        if (res.status === 200 && body === 'false') return { status: 'not_found', httpStatus: 200 };
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Vivino',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.vivino.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://www.vivino.com/api/login',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email: cleanEmail, password: 'WrongPasswordCheck!9' }),
          },
          5500
        );
        const err = asStr(asObj(res.json)?.error)?.toLowerCase() || '';
        if (err.includes('does not exist')) return { status: 'not_found', httpStatus: res.status };
        if (
          err.includes('password') ||
          err.includes('locked') ||
          res.status === 401
        ) {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: cleanEmail,
            extraFields: [{ label: 'Account Signal', value: asStr(asObj(res.json)?.error) || 'Account registered' }],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Rambler',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => 'https://id.rambler.ru/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://id.rambler.ru/jsonrpc',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              method: 'Rambler::Id::get_email_account_info',
              params: [{ email: cleanEmail }],
              rpc: '2.0',
            }),
          },
          5500
        );
        const r = asObj(asObj(res.json)?.result);
        if (!r || typeof r.exists !== 'number') return { status: 'not_checked', httpStatus: res.status };
        if (r.exists === 1) {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: cleanEmail,
            extraFields: [{ label: 'Account Type', value: asStr(r.type) || 'Rambler ID' }],
          };
        }
        return { status: 'not_found', httpStatus: res.status };
      },
    },
    {
      platform: 'Any.do',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://www.any.do/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://sm-prod2.any.do/check_email',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail }),
          },
          5500
        );
        const obj = asObj(res.json);
        if (!obj || typeof obj.user_exists !== 'boolean') {
          return { status: 'not_checked', httpStatus: res.status };
        }
        return obj.user_exists
          ? {
              status: 'found',
              httpStatus: res.status,
              displayName: cleanEmail,
              extraFields: [{ label: 'Workspace Status', value: 'Active Any.do account' }],
            }
          : { status: 'not_found', httpStatus: res.status };
      },
    },
    {
      platform: 'Snapchat',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.snapchat.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://bitmoji.api.snapchat.com/api/user/find',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail }),
          },
          5500
        );
        if (res.status === 204) return { status: 'not_found', httpStatus: 204 };
        const obj = asObj(res.json);
        if (res.status === 200 && obj) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [
              { label: 'Account Link', value: asStr(obj.account_type) || 'Snapchat / Bitmoji linked' },
            ],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Freelancer',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://www.freelancer.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://www.freelancer.com/api/users/0.1/users/check?compact=true',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user: { email: cleanEmail } }),
          },
          5500
        );
        const obj = asObj(res.json);
        const msg = asStr(obj?.message)?.toLowerCase() || '';
        const errCode = asStr(obj?.error_code)?.toLowerCase() || '';
        if (res.status === 409 || msg.includes('already exists') || errCode.includes('exist')) {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: cleanEmail,
            extraFields: [{ label: 'Registration Status', value: 'Freelancer account exists' }],
          };
        }
        if (res.status === 200 && asStr(obj?.status) === 'success') {
          return { status: 'not_found', httpStatus: 200 };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Keys.OpenPGP.org',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => `https://keys.openpgp.org/search?q=${encodeURIComponent(cleanEmail)}`,
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://keys.openpgp.org/vks/v1/by-email/${encodeURIComponent(cleanEmail)}`,
          {},
          5200
        );
        if (res.status === 200 && res.text.includes('BEGIN PGP PUBLIC KEY BLOCK')) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [
              { label: 'Registry', value: 'Verified PGP key on keys.openpgp.org' },
            ],
          };
        }
        if (res.status === 404) {
          return { status: 'not_found', httpStatus: 404 };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'GitHub Email Directory',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () => `https://github.com/search?q=${encodeURIComponent(cleanEmail)}&type=users`,
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://api.github.com/search/users?q=${encodeURIComponent(`${cleanEmail} in:email`)}&per_page=3`,
          { headers: { Accept: 'application/vnd.github+json' } },
          5500
        );
        const obj = asObj(res.json);
        const items = Array.isArray(obj?.items) ? obj.items : null;
        if (res.status === 200 && items) {
          if (items.length === 0) return { status: 'not_found', httpStatus: 200 };
          const first = asObj(items[0]);
          const login = asStr(first?.login);
          const avatarUrl = asStr(first?.avatar_url);
          const profileUrl = asStr(first?.html_url);
          if (login) {
            return {
              status: 'found',
              httpStatus: 200,
              id: first?.id !== undefined ? String(first.id) : undefined,
              displayName: login,
              verifiedUsername: login,
              avatarUrl,
              url: profileUrl || `https://github.com/${encodeURIComponent(login)}`,
              extraFields: [
                { label: 'GitHub Handle', value: `@${login}`, copyable: true },
                { label: 'Verification', value: 'Public GitHub email match' },
              ],
            };
          }
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Proton Mail Keyserver',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => `https://api.protonmail.ch/pks/lookup?op=get&search=${encodeURIComponent(cleanEmail)}`,
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://api.protonmail.ch/pks/lookup?op=index&search=${encodeURIComponent(cleanEmail)}`,
          {},
          5500
        );
        if (res.status === 200 && /\bpub:/i.test(res.text)) {
          const fpr = res.text.match(/pub:([A-F0-9]{16,40})/i)?.[1];
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [
              ...(fpr ? [{ label: 'PGP Fingerprint', value: fpr, copyable: true }] : []),
              { label: 'Registry', value: 'Proton PGP Keyserver' },
            ],
          };
        }
        if (res.status === 404 || res.text.includes('info:1:0')) {
          return { status: 'not_found', httpStatus: res.status };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Ubuntu PGP Keyserver',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => `https://keyserver.ubuntu.com/pks/lookup?search=${encodeURIComponent(cleanEmail)}&op=vindex`,
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://keyserver.ubuntu.com/pks/lookup?op=index&options=mr&search=${encodeURIComponent(cleanEmail)}`,
          {},
          5500
        );
        if (res.status === 200 && /\bpub:/i.test(res.text)) {
          const pubCount = (res.text.match(/^pub:/gm) || []).length;
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [
              { label: 'Indexed PGP Keys', value: String(pubCount || 1) },
            ],
          };
        }
        if (res.status === 404) return { status: 'not_found', httpStatus: 404 };
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Mailvelope PGP Registry',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => `https://keys.mailvelope.com/api/v1/key?email=${encodeURIComponent(cleanEmail)}`,
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://keys.mailvelope.com/api/v1/key?email=${encodeURIComponent(cleanEmail)}`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        if (res.status === 404) return { status: 'not_found', httpStatus: 404 };
        if (res.status === 200 && res.json) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [{ label: 'PGP Registry', value: 'Verified key on keys.mailvelope.com' }],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Mail.ru',
      category: 'Email & Domain',
      isLiveVerification: true,
      urlFn: () => 'https://mail.ru/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://account.mail.ru/api/v1/user/exists',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: `email=${encodeURIComponent(cleanEmail)}`,
          },
          5500
        );
        const obj = asObj(res.json);
        const body = asObj(obj?.body);
        if (body && typeof body.exists === 'boolean') {
          return body.exists
            ? { status: 'found', httpStatus: res.status, displayName: cleanEmail }
            : { status: 'not_found', httpStatus: res.status };
        }
        if (obj?.status === 400) return { status: 'not_found', httpStatus: res.status };
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Imgur',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://imgur.com/',
      customProbeFn: async () => {
        const initRes = await safeProbeFetch('https://imgur.com/register', {}, 4500);
        const setCookies = initRes.headers?.getSetCookie ? initRes.headers.getSetCookie() : [];
        const cookieHeader = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
        const res = await safeProbeFetch(
          'https://imgur.com/signin/ajax_email_available',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              ...(cookieHeader ? { Cookie: cookieHeader } : {}),
              Origin: 'https://imgur.com',
              Referer: 'https://imgur.com/register',
            },
            body: `email=${encodeURIComponent(cleanEmail)}`,
          },
          5500
        );
        const dataObj = asObj(asObj(res.json)?.data);
        if (res.status === 200 && dataObj && typeof dataObj.available === 'boolean') {
          return dataObj.available
            ? { status: 'not_found', httpStatus: 200 }
            : { status: 'found', httpStatus: 200, displayName: cleanEmail };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Komoot',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.komoot.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://account.komoot.com/v1/signin',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: cleanEmail }),
          },
          5500
        );
        if (res.status === 404) return { status: 'not_found', httpStatus: 404 };
        const obj = asObj(res.json);
        if (res.status === 200 && obj && obj.type) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: cleanEmail,
            extraFields: [{ label: 'Komoot Auth Type', value: asStr(obj.type) || 'Account active' }],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Flickr',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.flickr.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://www.flickr.com/services/rest/?method=flickr.people.findByEmail&api_key=9a0554259914a86fb9e7eb014e4e5d52&find_email=${encodeURIComponent(cleanEmail)}&format=json&nojsoncallback=1`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        const obj = asObj(res.json);
        const userObj = asObj(obj?.user);
        const unameObj = asObj(userObj?.username);
        const nsid = asStr(userObj?.nsid) || asStr(userObj?.id);
        const username = asStr(unameObj?._content);
        if (obj?.stat === 'ok' && nsid) {
          return {
            status: 'found',
            httpStatus: res.status,
            id: nsid,
            displayName: username || cleanEmail,
            verifiedUsername: username,
            url: `https://www.flickr.com/people/${encodeURIComponent(nsid)}/`,
            extraFields: [
              ...(username ? [{ label: 'Flickr Handle', value: username, copyable: true }] : []),
              { label: 'Flickr NSID', value: nsid, copyable: true },
            ],
          };
        }
        if (obj?.stat === 'fail' && obj?.code === 1) {
          return { status: 'not_found', httpStatus: res.status };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Stack Overflow',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () => 'https://stackoverflow.com/',
      customProbeFn: async () => {
        const cleanLower = cleanEmail.toLowerCase();
        const res = await safeProbeFetch(
          `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(`"${cleanEmail}"`)}&site=stackoverflow&pagesize=5&filter=withbody`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        const obj = asObj(res.json);
        const rawItems = Array.isArray(obj?.items) ? obj.items : null;
        if (!rawItems) return { status: 'not_checked', httpStatus: res.status };
        const matches = rawItems.filter((item) => {
          const it = asObj(item);
          if (!it) return false;
          const text = `${asStr(it.title) || ''} ${asStr(it.body) || ''} ${asStr(it.link) || ''}`.toLowerCase();
          return text.includes(cleanLower);
        });
        if (matches.length > 0) {
          const first = asObj(matches[0]);
          const owner = asObj(first?.owner);
          const ownerName = asStr(owner?.display_name);
          return {
            status: 'found',
            httpStatus: res.status,
            id: owner?.user_id !== undefined ? String(owner.user_id) : undefined,
            displayName: ownerName || cleanEmail,
            avatarUrl: asStr(owner?.profile_image),
            url: asStr(first?.link) || asStr(owner?.link) || 'https://stackoverflow.com/',
            bio: asStr(first?.title),
            extraFields: [
              { label: 'Exact SO Citations', value: String(matches.length) },
              ...(ownerName ? [{ label: 'Author', value: ownerName, copyable: true }] : []),
            ],
          };
        }
        return { status: 'not_found', httpStatus: res.status };
      },
    },
    {
      platform: 'Internet Archive',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://archive.org/',
      customProbeFn: async () => {
        const cleanLower = cleanEmail.toLowerCase();
        const res = await safeProbeFetch(
          `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`"${cleanEmail}"`)}&output=json&rows=5`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        const responseObj = asObj(asObj(res.json)?.response);
        const docs = Array.isArray(responseObj?.docs) ? responseObj.docs : null;
        if (!docs) return { status: 'not_checked', httpStatus: res.status };
        const matches = docs.filter((d) =>
          JSON.stringify(d).toLowerCase().includes(cleanLower)
        );
        if (matches.length > 0) {
          const first = asObj(matches[0]);
          const ident = asStr(first?.identifier);
          return {
            status: 'found',
            httpStatus: res.status,
            id: ident,
            displayName: asStr(first?.creator) || asStr(first?.title) || cleanEmail,
            url: ident ? `https://archive.org/details/${encodeURIComponent(ident)}` : 'https://archive.org/',
            bio: asStr(first?.title),
            extraFields: [
              { label: 'Indexed Items', value: String(matches.length) },
              ...(ident ? [{ label: 'Archive ID', value: ident, copyable: true }] : []),
            ],
          };
        }
        return { status: 'not_found', httpStatus: res.status };
      },
    },
    // Live Firebase Auth & Registration API Checks (Strict Email Verification)
    makeFirebaseAuthEmailProbe(
      'CrazyGames',
      'Social & Community',
      'https://www.crazygames.com/',
      'AIzaSyAkBGn9sKEUBSMQ9CTFyHHxXas0tdcpts8',
      cleanEmail
    ),
    makeFirebaseAuthEmailProbe(
      'Vedantu',
      'Social & Community',
      'https://www.vedantu.com/',
      'AIzaSyAXEmAZpcwLMFyKCT3tfGOzR_7HPyAjfmc',
      cleanEmail
    ),
    makeFirebaseAuthEmailProbe(
      'PhysicsWallah',
      'Social & Community',
      'https://www.pw.live/',
      'AIzaSyApsQyaMPr0NBBXi9OR7x7y0Kbc5qfLNc0',
      cleanEmail
    ),
    makeFirebaseAuthEmailProbe(
      'Smash Karts',
      'Social & Community',
      'https://smashkarts.io/',
      'AIzaSyAdY2qq9083amKDS0R8tn2tjIKQB8mocco',
      cleanEmail
    ),
    {
      platform: 'Codecademy',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () => 'https://www.codecademy.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://www.codecademy.com/register/validate',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ user: { email: cleanEmail } }),
          },
          5500
        );
        const errs = asObj(asObj(res.json)?.errors);
        const emailErr = asStr(errs?.email)?.toLowerCase() || '';
        if (emailErr.includes('taken') || emailErr.includes('already')) {
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: cleanEmail,
            extraFields: [{ label: 'Registration Status', value: 'Email registered on Codecademy' }],
          };
        }
        if (res.status === 200 && res.json && !emailErr) {
          return { status: 'not_found', httpStatus: 200 };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'npm Registry',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () => `https://www.npmjs.com/search?q=${encodeURIComponent(cleanEmail)}`,
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(cleanEmail)}&size=12`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        const objs = asObj(res.json)?.objects;
        if (res.status !== 200 || !Array.isArray(objs)) {
          return { status: 'not_checked', httpStatus: res.status };
        }
        const matchedPackages: string[] = [];
        let npmUser: string | undefined;
        for (const row of objs) {
          const pkg = asObj(asObj(row)?.package);
          const maintainers = Array.isArray(pkg?.maintainers) ? pkg.maintainers : [];
          for (const m of maintainers) {
            const mo = asObj(m);
            const mEmail = asStr(mo?.email)?.toLowerCase();
            if (mEmail === cleanLower) {
              if (!npmUser) npmUser = asStr(mo?.username);
              const pkgName = asStr(pkg?.name);
              if (pkgName && !matchedPackages.includes(pkgName)) {
                matchedPackages.push(pkgName);
              }
            }
          }
        }
        if (matchedPackages.length > 0 || npmUser) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: npmUser || cleanEmail,
            verifiedUsername: npmUser,
            url: npmUser
              ? `https://www.npmjs.com/~${encodeURIComponent(npmUser)}`
              : `https://www.npmjs.com/search?q=${encodeURIComponent(cleanEmail)}`,
            extraFields: [
              ...(matchedPackages.length > 0
                ? [{ label: 'Maintained Packages', value: matchedPackages.slice(0, 5).join(', ') }]
                : []),
            ],
          };
        }
        return { status: 'not_found', httpStatus: 200 };
      },
    },
    // Requested SaaS, AI, Gaming & Cloud Platforms (Bot/Session Gated Hosts Classify Honestly as Not Checked)
    makeAuthGateEmailProbe('Canva', 'Productivity & Cloud', 'https://www.canva.com/', 'https://www.canva.com/_ajax/login/initiate', 'POST', { email: cleanEmail }),
    makeAuthGateEmailProbe('QuillBot', 'Productivity & Cloud', 'https://quillbot.com/', 'https://quillbot.com/api/auth/check-email', 'POST', { email: cleanEmail }),
    makeAuthGateEmailProbe('Quora', 'Social & Community', 'https://www.quora.com/', 'https://www.quora.com/', 'GET'),
    makeAuthGateEmailProbe('Wix', 'Productivity & Cloud', 'https://www.wix.com/', `https://users.wix.com/wix-users/v1/email-exists?email=${encodeURIComponent(cleanEmail)}`, 'GET'),
    {
      platform: 'Plex',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.plex.tv/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          'https://plex.tv/api/v2/users?X-Plex-Product=Plex+Web&X-Plex-Client-Identifier=parmanu-osint-1',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({
              email: cleanEmail,
              password: 'x',
              username: `pmu_${emailMd5.slice(0, 12)}`,
            }),
          },
          6500
        );
        const obj = asObj(res.json);
        const errors = Array.isArray(obj?.errors) ? obj.errors : [];
        if (res.status === 422 && errors.length > 0) {
          const emailTaken = errors.some((entry) => {
            const e = asObj(entry);
            const field = asStr(e?.field)?.toLowerCase();
            const msg = asStr(e?.message)?.toLowerCase() || '';
            return (
              field === 'email' &&
              (e?.code === 1011 || msg.includes('already been taken') || msg.includes('in use'))
            );
          });
          if (emailTaken) {
            return {
              status: 'found',
              httpStatus: 422,
              displayName: cleanEmail,
              url: 'https://www.plex.tv/',
              extraFields: [
                { label: 'Account Status', value: 'Email registered on Plex' },
              ],
            };
          }
          const validationRan = errors.some((entry) => {
            const e = asObj(entry);
            return asStr(e?.field)?.toLowerCase() === 'password' || e?.code === 1032;
          });
          if (validationRan) {
            return { status: 'not_found', httpStatus: 422 };
          }
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Facebook',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.facebook.com/',
      customProbeFn: () => probeFacebookIdentify(cleanEmail),
    },
    {
      platform: 'Instagram',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.instagram.com/',
      customProbeFn: () => probeInstagramAccount(cleanEmail, 'email'),
    },
    {
      platform: 'Flipkart',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://www.flipkart.com/',
      customProbeFn: () => probeFlipkartAccount(cleanEmail, 'email'),
    },
    {
      platform: 'Duolingo',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.duolingo.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch(
          `https://www.duolingo.com/2017-06-30/users?email=${encodeURIComponent(cleanEmail)}`,
          { headers: { Accept: 'application/json' } },
          5500
        );
        const users = asObj(res.json)?.users;
        if (res.status === 200 && Array.isArray(users)) {
          if (users.length === 0) return { status: 'not_found', httpStatus: 200 };
          const u = asObj(users[0]);
          const uname = asStr(u?.username);
          const picture = asStr(u?.picture);
          const avatarUrl = picture
            ? picture.startsWith('//')
              ? `https:${picture}/xlarge`
              : picture.startsWith('http')
              ? `${picture}/xlarge`
              : undefined
            : undefined;
          const totalXp = asNum(u?.totalXp);
          return {
            status: 'found',
            httpStatus: 200,
            id: u?.id !== undefined ? String(u.id) : undefined,
            verifiedUsername: uname,
            displayName: asStr(u?.name) || uname || cleanEmail,
            avatarUrl,
            url: uname ? `https://www.duolingo.com/profile/${encodeURIComponent(uname)}` : 'https://www.duolingo.com/',
            extraFields: [
              ...(uname ? [{ label: 'Duolingo Username', value: `@${uname}`, copyable: true }] : []),
              ...(typeof totalXp === 'number' ? [{ label: 'Total XP', value: String(totalXp) }] : []),
              ...(asStr(u?.learningLanguage)
                ? [{ label: 'Learning', value: String(u?.learningLanguage).toUpperCase() }]
                : []),
            ],
          };
        }
        return { status: 'not_checked', httpStatus: res.status };
      },
    },
    {
      platform: 'Lovable',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () => 'https://lovable.dev/',
      customProbeFn: async () => {
        const localHandle = (cleanLower.split('@')[0] || '').replace(/[^a-z0-9_-]/gi, '');
        const [portalRes, bingHits, ghCommitRes, geminiRes] = await Promise.all([
          safeProbeFetch('https://lovable.dev/login', { headers: { Accept: 'text/html' } }, 4500),
          queryBingRssDork(
            `"${cleanLower}" (site:lovable.dev OR site:lovable.app)`,
            'Websites & Mentions'
          ).catch(() => []),
          safeProbeFetch(
            `https://api.github.com/search/commits?q=${encodeURIComponent(
              `"${cleanLower}"`
            )}&sort=author-date&order=desc&per_page=10`,
            { headers: { Accept: 'application/vnd.github+json' } },
            5000
          ),
          runGeminiGoogleSearchDork({
            target: cleanLower,
            targetType: 'email',
            queries: [
              `"${cleanLower}" site:lovable.dev OR site:lovable.app`,
              `"${cleanLower}" ("lovable.app" OR "lovable.dev" OR "lovable-tagger")`,
            ],
            mode: 'phone-fast',
          }).catch(() => ({ hits: [], active: false })),
        ]);

        const exactLinks: string[] = [];
        const addUrl = (u?: string) => {
          if (u && /^https?:\/\//i.test(u) && !exactLinks.includes(u)) exactLinks.push(u);
        };

        for (const h of bingHits || []) {
          const hay = `${h.title} ${h.snippet} ${h.url}`.toLowerCase();
          if (hay.includes(cleanLower)) addUrl(h.url);
        }
        for (const h of geminiRes.hits || []) {
          const hay = `${h.title} ${h.snippet} ${h.url}`.toLowerCase();
          if (hay.includes(cleanLower) && /lovable/i.test(hay)) addUrl(h.url);
        }

        const ghItems = Array.isArray(asObj(ghCommitRes.json)?.items)
          ? (asObj(ghCommitRes.json)?.items as Array<Record<string, unknown>>)
          : [];
        for (const item of ghItems) {
          const commit = asObj(item.commit);
          const authorEmail = asStr(asObj(commit?.author)?.email)?.toLowerCase();
          const committerEmail = asStr(asObj(commit?.committer)?.email)?.toLowerCase();
          const repoName = asStr(asObj(item.repository)?.full_name) || '';
          const repoDesc = asStr(asObj(item.repository)?.description) || '';
          const msg = asStr(commit?.message) || '';
          if (
            (authorEmail === cleanLower || committerEmail === cleanLower) &&
            /lovable|gpt-engineer|gptengineer/i.test(`${repoName} ${repoDesc} ${msg}`)
          ) {
            addUrl(asStr(item.html_url));
          }
        }

        if (exactLinks.length > 0) {
          return {
            status: 'found',
            httpStatus: portalRes.status || 200,
            displayName: cleanEmail,
            url: exactLinks[0],
            bio: `Verified Lovable app/commit footprint linked directly to ${cleanEmail} (${exactLinks.length} citation(s)).`,
            extraFields: [
              { label: 'Verified Signal', value: exactLinks[0], kind: 'url', copyable: true },
              { label: 'Auth Provider', value: 'Firebase / Google / GitHub OAuth' },
            ],
          };
        }

        return {
          status: 'not_checked',
          httpStatus: portalRes.status || 403,
          url: localHandle ? `https://lovable.dev/@${encodeURIComponent(localHandle)}` : 'https://lovable.dev/',
          bio: `Lovable uses Google/GitHub OAuth & Firebase anti-enumeration (direct email check blocked by design). Checked public lovable.dev/lovable.app search indexes & GitHub Lovable repo commits for ${cleanEmail}.`,
          extraFields: [
            { label: 'Auth Architecture', value: 'Google / GitHub OAuth + Anti-Enumeration' },
            ...(localHandle
              ? [{ label: 'Profile Pivot', value: `https://lovable.dev/@${localHandle}`, kind: 'url' as const, copyable: true }]
              : []),
          ],
        };
      },
    },
    {
      platform: 'Lovable & AI Builders Index',
      category: 'Developer & Code',
      isLiveVerification: true,
      urlFn: () => `https://lovable.dev/`,
      customProbeFn: async () => {
        const localHandle = (cleanLower.split('@')[0] || '').replace(/[^a-z0-9_-]/gi, '');
        const [bingAiHits, geminiAiRes] = await Promise.all([
          queryBingRssDork(
            `"${cleanLower}" (site:lovable.dev OR site:lovable.app OR site:bolt.new OR site:v0.dev OR site:vercel.app OR site:netlify.app OR site:replit.com OR site:cursor.com OR site:supabase.co OR site:render.com OR site:railway.app)`,
            'Websites & Mentions'
          ).catch(() => []),
          runGeminiGoogleSearchDork({
            target: cleanLower,
            targetType: 'email',
            queries: [
              `"${cleanLower}" (site:lovable.app OR site:lovable.dev OR site:bolt.new OR site:v0.dev OR site:vercel.app OR site:netlify.app OR site:replit.com)`,
              `"${cleanLower}" ("supabase.co" OR "cursor.com" OR "railway.app" OR "render.com")`,
            ],
            mode: 'phone-fast',
          }).catch(() => ({ hits: [], active: false })),
        ]);

        const verifiedUrls: string[] = [];
        for (const h of [...(bingAiHits || []), ...(geminiAiRes.hits || [])]) {
          const hay = `${h.title} ${h.snippet} ${h.url}`.toLowerCase();
          if (hay.includes(cleanLower) && h.url && !verifiedUrls.includes(h.url)) {
            verifiedUrls.push(h.url);
          }
        }

        if (verifiedUrls.length > 0) {
          return {
            status: 'found',
            httpStatus: 200,
            displayName: `${cleanEmail} (${verifiedUrls.length} AI/Cloud hit${verifiedUrls.length === 1 ? '' : 's'})`,
            url: verifiedUrls[0],
            bio: `Discovered ${verifiedUrls.length} public citation(s) linking ${cleanEmail} to Lovable / AI & Cloud builder deployments.`,
            extraFields: [
              { label: 'Matched Platforms', value: verifiedUrls.slice(0, 3).join(', '), copyable: true },
              { label: 'Audited Builders', value: 'Lovable, Bolt.new, v0, Cursor, Supabase, Vercel, Netlify, Replit, Render, Railway' },
            ],
          };
        }

        return {
          status: 'not_checked',
          httpStatus: 200,
          url: localHandle ? `https://lovable.dev/@${encodeURIComponent(localHandle)}` : 'https://lovable.dev/',
          bio: `Audited Lovable, Bolt.new, Vercel v0, Cursor, Supabase, Vercel, Netlify, Replit, Render & Railway via public search indexes. OAuth/Firebase sign-in prevents silent email enumeration.`,
          extraFields: [
            { label: 'Audited Builders', value: 'Lovable, Bolt.new, v0, Cursor, Supabase, Vercel, Netlify, Replit, Render, Railway' },
            ...(localHandle
              ? [{ label: 'Lovable Handle Pivot', value: `https://lovable.dev/@${localHandle}`, kind: 'url' as const, copyable: true }]
              : []),
          ],
        };
      },
    },
    makeAuthGateEmailProbe('Bolt.new', 'Developer & Code', 'https://bolt.new/', 'https://bolt.new/login', 'GET'),
    makeAuthGateEmailProbe('Vercel v0', 'Developer & Code', 'https://v0.dev/', 'https://v0.dev/api/auth', 'GET'),
    makeAuthGateEmailProbe('Cursor', 'Developer & Code', 'https://www.cursor.com/', 'https://www.cursor.com/', 'GET'),
    makeAuthGateEmailProbe('Supabase', 'Developer & Code', 'https://supabase.com/', 'https://api.supabase.com/platform/profile', 'GET'),
    makeAuthGateEmailProbe('Vercel', 'Developer & Code', 'https://vercel.com/', 'https://vercel.com/login', 'GET'),
    makeAuthGateEmailProbe('Netlify', 'Developer & Code', 'https://www.netlify.com/', 'https://app.netlify.com/', 'GET'),
    makeAuthGateEmailProbe('Railway', 'Developer & Code', 'https://railway.app/', 'https://backboard.railway.app/graphql/v2', 'POST', { query: '{ __typename }' }),
    makeAuthGateEmailProbe(
      'Replit',
      'Developer & Code',
      'https://replit.com/',
      'https://replit.com/graphql',
      'POST',
      {
        query: 'query userByEmail($email: String!) { userByEmail(email: $email) { id } }',
        variables: { email: cleanEmail },
      },
      { 'X-Requested-With': 'XMLHttpRequest', Origin: 'https://replit.com' }
    ),
    makeAuthGateEmailProbe('Render', 'Productivity & Cloud', 'https://render.com/', 'https://api.render.com/graphql', 'POST', { query: '{ __typename }' }),
    makeAuthGateEmailProbe('Notion', 'Productivity & Cloud', 'https://www.notion.so/', 'https://www.notion.so/api/v3/getLoginOptions', 'POST', { email: cleanEmail }),
    makeAuthGateEmailProbe('Figma', 'Productivity & Cloud', 'https://www.figma.com/', 'https://www.figma.com/api/user/state', 'GET'),
    makeAuthGateEmailProbe('Atlassian', 'Developer & Code', 'https://www.atlassian.com/', 'https://id.atlassian.com/rest/check-username?username=' + encodeURIComponent(cleanEmail), 'GET'),
    makeAuthGateEmailProbe('GitLab', 'Developer & Code', 'https://gitlab.com/', 'https://gitlab.com/users/sign_in', 'GET'),
    makeAuthGateEmailProbe('Docker Hub', 'Developer & Code', 'https://hub.docker.com/', 'https://hub.docker.com/v2/users/login/', 'POST', { username: cleanEmail, password: 'WrongPasswordCheck!9' }),
    makeAuthGateEmailProbe('Dropbox', 'Productivity & Cloud', 'https://www.dropbox.com/', 'https://www.dropbox.com/ajax_login', 'POST', { login_email: cleanEmail }),
    {
      platform: 'LinkedIn',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.linkedin.com/',
      customProbeFn: async () => {
        const initRes = await safeProbeFetch(
          'https://www.linkedin.com/uas/login',
          {
            headers: {
              Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'en-US,en;q=0.9',
              'Sec-Fetch-Dest': 'document',
              'Sec-Fetch-Mode': 'navigate',
              'Sec-Fetch-Site': 'none',
            },
          },
          4500
        );
        const csrfMatch = initRes.text.match(/name="loginCsrfParam"\s+value="([^"]+)"/i);
        const setCookies = initRes.headers?.getSetCookie ? initRes.headers.getSetCookie() : [];
        const cookies = setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ');
        if (!csrfMatch?.[1]) {
          return {
            status: 'not_checked',
            httpStatus: initRes.status || 403,
            bio: 'LinkedIn login edge gated by anti-enumeration protection.',
          };
        }
        const postRes = await safeProbeFetch(
          'https://www.linkedin.com/checkpoint/lg/login-submit',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Origin: 'https://www.linkedin.com',
              Referer: 'https://www.linkedin.com/uas/login',
              ...(cookies ? { Cookie: cookies } : {}),
            },
            body: new URLSearchParams({
              loginCsrfParam: csrfMatch[1],
              session_key: cleanEmail,
              session_password: 'ParmanuCheckPassword!92',
            }).toString(),
          },
          5000
        );
        const low = postRes.text.toLowerCase();
        if (low.includes('no linkedin account') || low.includes('couldn’t find a linkedin account') || low.includes("couldn't find a linkedin account")) {
          return { status: 'not_found', httpStatus: postRes.status };
        }
        if (low.includes('wrong password') || low.includes('wrong email or password')) {
          return { status: 'not_checked', httpStatus: postRes.status };
        }
        return {
          status: 'not_checked',
          httpStatus: postRes.status,
          bio: 'LinkedIn challenge/anti-enumeration active.',
        };
      },
    },
    {
      platform: 'Discord',
      category: 'Social & Community',
      urlFn: () => 'https://discord.com/',
      customProbeFn: async () => {
        const res = await safeProbeFetch('https://discord.com/login', { method: 'HEAD' }, 2500);
        return {
          status: 'not_checked',
          httpStatus: res.status || 403,
          bio: 'Discord registration check anti-enumeration protected.',
        };
      },
    },
    makeAuthGateEmailProbe('Patreon', 'Social & Community', 'https://www.patreon.com/', 'https://www.patreon.com/api/auth', 'GET'),
    {
      platform: 'Pinterest',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.pinterest.com/',
      customProbeFn: async () => {
        const initRes = await safeProbeFetch('https://www.pinterest.com/login/', {}, 5000);
        const setCookies = initRes.headers?.getSetCookie ? initRes.headers.getSetCookie() : [];
        const pairs = setCookies.map((c) => c.split(';')[0]).filter(Boolean);
        const csrfPair = pairs.find((p) => p.startsWith('csrftoken='));
        const csrfToken = csrfPair ? csrfPair.split('=')[1] : '';
        if (!csrfToken) {
          return { status: 'not_checked', httpStatus: initRes.status };
        }
        const checkRes = await safeProbeFetch(
          'https://www.pinterest.com/resource/UserRegisterResource/create/',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              'X-Requested-With': 'XMLHttpRequest',
              Referer: 'https://www.pinterest.com/',
              Origin: 'https://www.pinterest.com',
              'X-CSRFToken': csrfToken,
              Cookie: pairs.join('; '),
            },
            body: `source_url=%2F&data=${encodeURIComponent(
              JSON.stringify({ options: { email: cleanEmail }, context: {} })
            )}`,
          },
          5500
        );
        const errObj = asObj(asObj(checkRes.json)?.resource_response)?.error;
        const e = asObj(errObj);
        const code = e?.code ?? e?.api_error_code;
        const msg = asStr(e?.message)?.toLowerCase() || '';
        if (checkRes.status === 409 || code === 91 || msg.includes('already taken')) {
          return {
            status: 'found',
            httpStatus: checkRes.status,
            displayName: cleanEmail,
            extraFields: [
              { label: 'Registration Status', value: 'Email registered on Pinterest' },
            ],
          };
        }
        if (checkRes.status === 400 && (code === 4928 || msg.includes('password'))) {
          return { status: 'not_found', httpStatus: 400 };
        }
        return { status: 'not_checked', httpStatus: checkRes.status };
      },
    },
    makeAuthGateEmailProbe('Strava', 'Social & Community', 'https://www.strava.com/', 'https://www.strava.com/login', 'GET'),
    makeAuthGateEmailProbe('Trello', 'Productivity & Cloud', 'https://trello.com/', 'https://trello.com/login', 'GET'),
    makeAuthGateEmailProbe('CodePen', 'Developer & Code', 'https://codepen.io/', 'https://codepen.io/accounts/duplicate_check', 'POST', { attribute: 'email', value: cleanEmail }),
    makeAuthGateEmailProbe('Eventbrite', 'Productivity & Cloud', 'https://www.eventbrite.com/', 'https://www.eventbrite.com/signin/', 'GET'),
    makeAuthGateEmailProbe('Amazon', 'Social & Community', 'https://www.amazon.com/', 'https://www.amazon.com/ap/signin', 'GET'),
    makeAuthGateEmailProbe('PayPal', 'Social & Community', 'https://www.paypal.com/', 'https://www.paypal.com/signin', 'GET'),
  ];
}

// Legacy SaaS/Creator username-profile targets (moved strictly to Username Mode — never run on email prefix)
export const EXTRA_HOLEHE_TARGETS: PlatformSweepTarget[] = [
  makeHtmlProfileTarget('Microsoft Tech', 'Productivity & Cloud', (h) => `https://techcommunity.microsoft.com/users/${encodeURIComponent(h)}`, { brandNeedle: 'microsoft' }),
  makeHtmlProfileTarget('Adobe Community', 'Productivity & Cloud', (h) => `https://community.adobe.com/t5/user/viewprofilepage/user-id/${encodeURIComponent(h)}`, { brandNeedle: 'adobe' }),
  makeHtmlProfileTarget('Quizizz', 'Social & Community', (h) => `https://quizizz.com/profile/${encodeURIComponent(h)}`, { brandNeedle: 'quizizz' }),
  makeHtmlProfileTarget('Canva', 'Productivity & Cloud', (h) => `https://www.canva.com/p/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Dropbox', 'Productivity & Cloud', (h) => `https://www.dropbox.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('LinkedIn', 'Social & Community', (h) => `https://www.linkedin.com/in/${encodeURIComponent(h)}/`),
  makeHtmlProfileTarget('Amazon', 'Social & Community', (h) => `https://www.amazon.com/gp/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Nike', 'Social & Community', (h) => `https://www.nike.com/member/profile/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Zoho', 'Productivity & Cloud', (h) => `https://www.zoho.com/people/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Unacademy', 'Social & Community', (h) => `https://unacademy.com/@${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('PayPal.me', 'Social & Community', (h) => `https://www.paypal.com/paypalme/${encodeURIComponent(h)}`, { brandNeedle: 'paypal' }),
  makeHtmlProfileTarget('Trello', 'Productivity & Cloud', (h) => `https://trello.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Calendly', 'Productivity & Cloud', (h) => `https://calendly.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Wix', 'Productivity & Cloud', (h) => `https://${encodeURIComponent(h.toLowerCase())}.wixsite.com`, { subdomain: true }),
  makeHtmlProfileTarget('Webflow', 'Productivity & Cloud', (h) => `https://webflow.com/@${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Framer', 'Productivity & Cloud', (h) => `https://${encodeURIComponent(h.toLowerCase())}.framer.website`, { subdomain: true }),
  makeHtmlProfileTarget('Samsung', 'Social & Community', (h) => `https://r1.community.samsung.com/t5/user/viewprofilepage/user-id/${encodeURIComponent(h)}`, { brandNeedle: 'samsung' }),
  makeHtmlProfileTarget('Zomato', 'Social & Community', (h) => `https://www.zomato.com/${encodeURIComponent(h)}`),
  makeHtmlProfileTarget('Shopify Stores', 'Productivity & Cloud', (h) => `https://${encodeURIComponent(h.toLowerCase())}.myshopify.com`, { subdomain: true }),
  makeHtmlProfileTarget('Beehiiv', 'Social & Community', (h) => `https://${encodeURIComponent(h.toLowerCase())}.beehiiv.com`, { subdomain: true }),
  makeHtmlProfileTarget('Atlassian', 'Developer & Code', (h) => `https://${encodeURIComponent(h.toLowerCase())}.atlassian.net`, { subdomain: true }),
  makeHtmlProfileTarget('eBay', 'Social & Community', (h) => `https://www.ebay.com/usr/${encodeURIComponent(h)}`),
];
