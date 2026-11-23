import type {
  TargetType,
  ToolDefinition,
  ToolId,
} from '@/src/types/investigation';

export const INVESTIGATION_TOOLS: ToolDefinition[] = [
  {
    id: 'mailaccess',
    name: 'MailAccess',
    tier: 'core',
    defaultAvailability: 'ready',
    supportedTargets: ['email', 'username', 'domain', 'ip', 'phone'],
    scope: 'DNS / MX / TLS / Slack / Telecom / Sourcegraph & Opt-In Web Dorking',
    description:
      'Flagship pure live-native OSINT core: Email mode probes MX, SPF, DMARC, BIMI, Slack workspaces, OpenPGP keys, Gravatar, breaches, GitHub commit leaks & opt-in deep web/code dorking; Username mode isolates GitHub/Gravatar; Phone mode emits TRAI telecom circle & carrier telemetry, LeakCheck & ProxyNova COMB breaches, GitHub, Sourcegraph, HN, Archive, Reddit, StackOverflow, Wikipedia & npm checks; Domain & IP modes inspect network infrastructure.',
    capabilities: [
      'Opt-in Google Grounding, Sourcegraph, GitHub Commits & StackOverflow dorking',
      'Live GitHub, Gravatar, Slack Workspace, LeakCheck & ProxyNova COMB correlation',
      'TRAI 4-digit carrier intelligence, OpenPGP keyserver, TLS & RDAP inspection',
    ],
  },
  {
    id: 'holehe',
    name: 'Holehe',
    tier: 'core',
    defaultAvailability: 'ready',
    supportedTargets: ['email'],
    scope: '850+ Strict Email Endpoints + Verified-Handle Correlation',
    description:
      'Probes 850+ live websites strictly anchored to the exact email address (Instagram, Facebook, Flipkart, Unavatar, Libravatar, Zoho, Launchpad, Chess.com, X, WordPress.com, Microsoft, Adobe, Spotify, Firefox Accounts, Duolingo, ORCID, Pinterest, Bugzilla & 800+ SaaS/AI/cloud hosts) and correlates verified handles across Replit, Render, GitLab, Hugging Face, Vercel & DEV.to.',
    capabilities: [
      'Live zero-OTP probes on Instagram, Meta/Facebook, Flipkart, X, Spotify, Microsoft, Zoho & Launchpad',
      'Automatic Verified-Handle cross-platform pivot to Replit, Render, GitLab, PyPI & Hugging Face',
    ],
  },
  {
    id: 'maigret',
    name: 'Maigret',
    tier: 'core',
    defaultAvailability: 'ready',
    supportedTargets: ['username'],
    scope: '119+ Cloud PaaS, Forges, Registries & StackExchange',
    description:
      'Sweeps 116 developer, cloud hosting, package registry, AI, CTF & StackExchange hubs (Replit, Render, Vercel, Netlify, Firebase, Heroku, LeetCode, Codeforces, Figma, Kaggle, Hugging Face, AUR, MetaCPAN, Snapcraft, Terraform, StackExchange x18).',
    capabilities: [
      'Probes Cloud PaaS subdomains & GraphQL/JSON developer APIs concurrently',
      'Extracts avatars, rankings, join timestamps, locations, and live page titles',
    ],
  },
  {
    id: 'ghunt',
    name: 'GHunt',
    tier: 'core',
    defaultAvailability: 'ready',
    supportedTargets: ['email'],
    scope: 'Pure Live-Native Google Ecosystem & Calendar Engine',
    description:
      'Live-native Google ecosystem analyzer inspecting Google Workspace MX posture, Unavatar Google profile images, public Google Calendar ICS feeds, SPF/DMARC configuration, and direct Google Maps/Contacts lookup pivots.',
    capabilities: [
      '100% live-native Google Workspace MX, Unavatar & Calendar ICS inspection',
      'Surfaces Google Workspace host telemetry & direct Maps/Contacts OSINT pivots',
    ],
  },
  {
    id: 'blackbird',
    name: 'Blackbird',
    tier: 'enhanced',
    defaultAvailability: 'ready',
    supportedTargets: ['username'],
    scope: '106 Gaming, EdTech, Audio, Anime & Creative Platforms',
    description:
      'Concurrent handle sweep across CrazyGames, Kahoot!, Quizlet, Khan Academy, Coursera, Udemy, Roblox, Minecraft, Steam, Twitch, Kick, Kitsu, Shikimori, Audius, Discogs, Chess.com, Lichess, HackerOne, TryHackMe, and AniList.',
    capabilities: [
      'Real GraphQL/REST verification + anti-SPA 404 verification on gaming & CTF hosts',
      'Extracts linked identities, game stats, follower counts, and avatars',
    ],
  },
  {
    id: 'sherlock',
    name: 'Sherlock',
    tier: 'enhanced',
    defaultAvailability: 'ready',
    supportedTargets: ['username'],
    scope: '140+ Social, Fediverse, SaaS, Creator & Commerce Sites',
    description:
      'Resolves public identities across Reddit, Bluesky, 18 Mastodon servers, 8 Lemmy instances, 10 Wikimedia projects, YouTube, Telegram, Patreon, Substack, Etsy, Fiverr, Strava, OpenSea, Warpcast, and Archive.org.',
    capabilities: [
      'ATProto, Fediverse, Lemmy, MediaWiki & Reddit JSON API integration',
      'Extracts OpenGraph titles, profile photos, bios & creation timestamps',
    ],
  },
  {
    id: 'phoneinfoga',
    name: 'PhoneInfoga',
    tier: 'core',
    defaultAvailability: 'ready',
    supportedTargets: ['phone'],
    scope: 'Carrier Verification, OVH VoIP & Opt-In Deep Web/Code Dorks',
    description:
      'Normalizes local/international dialing formats (including bare 10-digit Indian numbers), checks OVH Telecom VoIP ranges & optional carrier APIs, and runs opt-in multi-variant Google Grounding, Sourcegraph, GitHub, StackOverflow & Archive dorks when enabled.',
    capabilities: [
      'Accurate local & E.164 normalization without country-code misclassification',
      'Opt-in multi-variant web/code/document dorking & OVH Telecom VoIP range checks',
    ],
  },
  {
    id: 'ignorant',
    name: 'Ignorant',
    tier: 'core',
    defaultAvailability: 'ready',
    supportedTargets: ['phone'],
    scope: '370+ Websites & Live Pre-OTP Account Checks (Zero-SMS)',
    description:
      'Probes 370+ phone-enabled websites & services purely live-native: zero-OTP checks on Facebook/Meta, Instagram, Snapchat, Flipkart, Microsoft, Zoho, Telegram & WhatsApp pivots, plus passive reachability audits across banking, UPI, telecom & commerce hosts.',
    capabilities: [
      'Deterministic zero-SMS verification on Facebook, Instagram, Snapchat, Flipkart, Microsoft, Zoho & Telegram',
      '370+ live-native site checks with strict OTP / Auth Gated isolation',
    ],
  },
];

export const TOOL_BY_ID: Record<ToolId, ToolDefinition> =
  INVESTIGATION_TOOLS.reduce(
    (acc, tool) => {
      acc[tool.id] = tool;
      return acc;
    },
    {} as Record<ToolId, ToolDefinition>
  );

export function getDefaultToolsForTarget(targetType: TargetType): ToolId[] {
  if (targetType === 'phone') {
    return ['mailaccess', 'phoneinfoga', 'ignorant'];
  }
  if (targetType === 'domain' || targetType === 'ip') {
    return ['mailaccess'];
  }
  if (targetType === 'username') {
    return ['mailaccess', 'maigret', 'blackbird', 'sherlock'];
  }
  return ['mailaccess', 'holehe', 'ghunt'];
}
