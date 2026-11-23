import type {
  DorkFileFormat,
  DorkResourceCategory,
  GoogleDorkHit,
  GoogleDorkQuery,
  GoogleDorkResponse,
  TargetType,
} from '../src/types/investigation.ts';
import { runGeminiGoogleSearchDork } from './geminiRotator.ts';

const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const FREE_MAIL_DOMAINS = new Set([
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
  'aol.com',
  'zoho.com',
  'zoho.in',
  'zohomail.com',
  'zohomail.in',
  'yandex.com',
  'yandex.ru',
  'mail.com',
  'mail.ru',
  'rediffmail.com',
  'rediff.com',
  'qq.com',
  '163.com',
  'fastmail.com',
  'hey.com',
  'duck.com',
]);

const SPAM_OR_NOISE_DOMAINS = new Set([
  'whitepages.com',
  'spokeo.com',
  'truepeoplesearch.com',
  'fastpeoplesearch.com',
  'anywho.com',
  'usphonebook.com',
  'clustrmaps.com',
  'peekyou.com',
  'radaris.com',
  'beenverified.com',
  'intelius.com',
  'peoplefinders.com',
  'mylife.com',
  'zabasearch.com',
  'cocofinder.com',
  'accounts.google.com',
  'login.live.com',
  'duckduckgo.com',
  'bing.com',
]);

function isBlockedNoiseDomain(domain: string): boolean {
  const clean = domain.toLowerCase().replace(/^www\./, '');
  if (!clean) return true;
  if (SPAM_OR_NOISE_DOMAINS.has(clean)) return true;
  for (const blocked of SPAM_OR_NOISE_DOMAINS) {
    if (clean.endsWith(`.${blocked}`)) return true;
  }
  return false;
}

function isSafePublicHttpUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
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
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripHtmlForMatching(raw: string): string {
  // Preserve SEO <meta content="..."> and structured JSON hydration blocks (__NEXT_DATA__, application/ld+json)
  // so modern SPAs (Replit, Render, Vercel, Next.js) do not lose email/handle evidence before matching.
  const metaContents: string[] = [];
  for (const m of raw.matchAll(/<meta\b[^>]*content=["']([^"']{3,400})["'][^>]*>/gi)) {
    if (m[1]) metaContents.push(m[1]);
  }
  const structuredJsonBlocks: string[] = [];
  for (const m of raw.matchAll(
    /<script\b[^>]+(?:id=["']__NEXT_DATA__["']|type=["']application\/ld\+json["'])[^>]*>([\s\S]{0,45000}?)<\/script>/gi
  )) {
    if (m[1]) structuredJsonBlocks.push(m[1]);
  }

  const visible = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#64;|&#x40;|\\u0040/gi, '@')
    .replace(/\s+/g, ' ')
    .trim();

  const extra = `${metaContents.join(' ')} ${structuredJsonBlocks.join(' ')}`
    .replace(/\\u0040/gi, '@')
    .replace(/\s+/g, ' ')
    .trim();

  return extra ? `${visible} ${extra}`.trim() : visible;
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, num) => String.fromCharCode(Number(num) || 32))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapDuckDuckGoHref(href: string): string {
  const cleanHref = href.replace(/&amp;/g, '&').trim();
  if (!cleanHref) return '';
  if (cleanHref.startsWith('//')) {
    return unwrapDuckDuckGoHref(`https:${cleanHref}`);
  }
  try {
    const parsed = new URL(
      cleanHref.startsWith('http')
        ? cleanHref
        : `https://duckduckgo.com${cleanHref.startsWith('/') ? '' : '/'}${cleanHref}`
    );
    const uddg = parsed.searchParams.get('uddg');
    if (uddg && /^https?:\/\//i.test(uddg)) {
      return uddg;
    }
    if (
      parsed.hostname.includes('duckduckgo.com') &&
      parsed.pathname === '/y.js'
    ) {
      return '';
    }
    return /^https?:\/\//i.test(cleanHref) ? cleanHref : '';
  } catch {
    return '';
  }
}

function extractDomain(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function detectFileFormat(urlStr: string, title = '', snippet = ''): DorkFileFormat {
  const pathLower = (() => {
    try {
      return new URL(urlStr).pathname.toLowerCase();
    } catch {
      return urlStr.toLowerCase();
    }
  })();

  if (pathLower.endsWith('.pdf')) return 'PDF';
  if (/\.(xlsx|xls|ods)$/.test(pathLower)) return 'XLSX';
  if (/\.(csv|tsv)$/.test(pathLower)) return 'CSV';
  if (/\.(docx|doc|rtf|odt)$/.test(pathLower)) return 'DOCX';
  if (/\.(txt|md)$/.test(pathLower)) return 'TXT';
  if (/\.(sql|sqlite|db)$/.test(pathLower)) return 'SQL';
  if (/\.(json|ndjson|jsonl)$/.test(pathLower)) return 'JSON';
  if (/\.xml$/.test(pathLower)) return 'XML';
  if (/\.log$/.test(pathLower)) return 'LOG';
  if (/\.(zip|tar|gz|7z|rar)$/.test(pathLower)) return 'ARCHIVE';
  if (/\.(js|ts|py|env|yml|yaml|conf|ini|sh)$/.test(pathLower)) return 'CODE';

  const domain = extractDomain(urlStr);
  if (
    domain.includes('github.com') ||
    domain.includes('gist.github.com') ||
    domain.includes('gitlab.com') ||
    domain.includes('sourcegraph.com') ||
    domain.includes('pastebin.com') ||
    domain.includes('rentry.co')
  ) {
    return 'CODE';
  }
  if (domain.includes('web.archive.org')) return 'ARCHIVE';

  const combo = `${title} ${snippet}`.toLowerCase();
  if (combo.includes('[pdf]') || combo.includes('filetype:pdf')) return 'PDF';
  if (combo.includes('[xls') || combo.includes('spreadsheet')) return 'XLSX';
  if (combo.includes('[doc') || combo.includes('.docx')) return 'DOCX';
  return 'WEB';
}

function classifyHitCategory(
  urlStr: string,
  fileType: DorkFileFormat,
  hintCategory?: DorkResourceCategory
): DorkResourceCategory {
  if (
    fileType === 'PDF' ||
    fileType === 'XLSX' ||
    fileType === 'CSV' ||
    fileType === 'DOCX' ||
    fileType === 'TXT' ||
    fileType === 'SQL' ||
    fileType === 'JSON' ||
    fileType === 'XML' ||
    fileType === 'LOG'
  ) {
    return 'Files & Documents';
  }
  if (fileType === 'CODE') {
    return 'Code & Pastes';
  }
  if (fileType === 'ARCHIVE') {
    return 'Archives & Records';
  }
  const domain = extractDomain(urlStr);
  if (
    domain.includes('github.com') ||
    domain.includes('gitlab.com') ||
    domain.includes('sourcegraph.com') ||
    domain.includes('pastebin.com') ||
    domain.includes('gist.github.com') ||
    domain.includes('codepen.io')
  ) {
    return 'Code & Pastes';
  }
  if (
    domain.includes('web.archive.org') ||
    domain.includes('crt.sh') ||
    domain.includes('whois') ||
    domain.includes('court') ||
    domain.includes('gov.')
  ) {
    return 'Archives & Records';
  }
  return hintCategory || 'Websites & Mentions';
}

export function derivePhoneVariants(rawTarget: string): {
  e164: string;
  national: string;
  digits: string;
  variants: string[];
} {
  const digits = rawTarget.replace(/\D/g, '');
  const prefixMatches = [
    '971',
    '972',
    '977',
    '966',
    '880',
    '852',
    '358',
    '353',
    '351',
    '91',
    '92',
    '94',
    '86',
    '84',
    '82',
    '81',
    '66',
    '65',
    '64',
    '63',
    '62',
    '61',
    '60',
    '55',
    '52',
    '49',
    '47',
    '46',
    '44',
    '41',
    '39',
    '34',
    '33',
    '31',
    '27',
    '1',
  ];

  let prefix = '';
  for (const p of prefixMatches) {
    if (digits.startsWith(p) && digits.length - p.length >= 6) {
      prefix = p;
      break;
    }
  }

  const national = prefix ? digits.slice(prefix.length) : digits;
  const e164 = digits ? `+${digits}` : rawTarget.trim();

  const variantSet = new Set<string>();
  const add = (v: string) => {
    const clean = v.trim();
    if (clean.length >= 6) variantSet.add(clean);
  };

  add(rawTarget);
  add(e164);
  add(digits);
  add(national);
  if (national.length >= 8 && !national.startsWith('0')) {
    add(`0${national}`);
  }

  if (prefix) {
    add(`+${prefix} ${national}`);
    add(`+${prefix}-${national}`);
  }

  if (national.length === 10) {
    const p5a = national.slice(0, 5);
    const p5b = national.slice(5);
    const p3a = national.slice(0, 3);
    const p3b = national.slice(3, 6);
    const p4 = national.slice(6);

    add(`${p5a} ${p5b}`);
    add(`${p5a}-${p5b}`);
    add(`${p3a}-${p3b}-${p4}`);
    add(`${p3a} ${p3b} ${p4}`);
    add(`${p3a}.${p3b}.${p4}`);
    add(`(${p3a}) ${p3b}-${p4}`);
    if (prefix) {
      add(`+${prefix} ${p5a} ${p5b}`);
      add(`+${prefix}-${p5a}-${p5b}`);
      add(`+${prefix} ${p3a} ${p3b} ${p4}`);
      add(`+${prefix}-${p3a}-${p3b}-${p4}`);
    }
  } else if (national.length >= 7) {
    add(national.replace(/(\d{3,4})(?=\d)/g, '$1 ').trim());
    add(national.replace(/(\d{3,4})(?=\d)/g, '$1-').trim());
  }

  return {
    e164,
    national,
    digits,
    variants: Array.from(variantSet),
  };
}

function buildQueriesForTarget(
  target: string,
  targetType: TargetType,
  extraTerms: string[] = []
): { queries: GoogleDorkQuery[]; variantsUsed: string[] } {
  const cleanExtra = Array.from(
    new Set(
      extraTerms
        .map((t) => t.trim())
        .filter((t) => t.length >= 3 && t.toLowerCase() !== target.toLowerCase())
    )
  ).slice(0, 4);

  const mk = (
    id: string,
    category: DorkResourceCategory,
    title: string,
    description: string,
    query: string
  ): GoogleDorkQuery => ({
    id,
    category,
    title,
    description,
    query,
    googleUrl: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
  });

  if (targetType === 'phone') {
    const { e164, national, digits, variants } = derivePhoneVariants(target);
    const spaced5 =
      national.length === 10 ? `${national.slice(0, 5)} ${national.slice(5)}` : variants[2] || national;
    const dashed334 =
      national.length === 10
        ? `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
        : variants[3] || national;
    const dotted334 =
      national.length === 10
        ? `${national.slice(0, 3)}.${national.slice(3, 6)}.${national.slice(6)}`
        : national;
    const parenUs =
      national.length === 10
        ? `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`
        : national;
    const zeroPref = national.startsWith('0') ? national : `0${national}`;

    const coreExpr = `("${e164}" OR "${national}" OR "${digits}" OR "${spaced5}" OR "${dashed334}")`;
    const fullVariantsExpr = `("${e164}" OR "${national}" OR "${spaced5}" OR "${dashed334}" OR "${dotted334}" OR "${parenUs}" OR "${zeroPref}")`;

    const queries: GoogleDorkQuery[] = [
      mk(
        'phone-all-variants',
        'Websites & Mentions',
        'Exhaustive Number Format Sweep',
        'Matches E.164, national, zero-prefixed, spaced, dashed, dot, and area-code patterns globally.',
        fullVariantsExpr
      ),
      mk(
        'phone-spreadsheets-dbs',
        'Files & Documents',
        'Spreadsheets, CSV Rosters & SQL/JSON Exports',
        'Hunts publicly indexed XLS/XLSX/CSV contact sheets, JSON configs, and SQL dumps.',
        `(filetype:xlsx OR filetype:xls OR filetype:csv OR filetype:sql OR filetype:json OR filetype:xml) ${coreExpr}`
      ),
      mk(
        'phone-pdfs-docs',
        'Files & Documents',
        'Public PDFs, Word Docs, CVs & Text Logs',
        'Finds exposed resumes, invoices, tender documents, DOCX files, and raw TXT logs.',
        `(filetype:pdf OR filetype:docx OR filetype:doc OR filetype:txt OR filetype:rtf OR filetype:log) ${coreExpr}`
      ),
      mk(
        'phone-open-dirs',
        'Archives & Records',
        'Open Directories, Contact & Staff Pages',
        'Searches open Apache/Nginx directory listings and staff/member/contact URLs.',
        `(intitle:"index of" OR inurl:contact OR inurl:directory OR inurl:staff OR inurl:members OR inurl:resume OR "tel:${e164}") ("${e164}" OR "${national}" OR "${spaced5}")`
      ),
      mk(
        'phone-caller-dirs',
        'Websites & Mentions',
        'Business Directories & Caller Reputation Boards',
        'Checks public business listings, Truecaller/Sync.me caches, Justdial, IndiaMART, YellowPages, and caller directories.',
        `(site:truecaller.com OR site:justdial.com OR site:indiamart.com OR site:sulekha.com OR site:tradeindia.com OR site:sync.me OR site:whocalledme.com OR site:shouldianswer.com OR site:yellowpages.com) ("${national}" OR "${digits}" OR "${spaced5}" OR "${e164}")`
      ),
      mk(
        'phone-social-messaging',
        'Websites & Mentions',
        'Messaging Links, WhatsApp, Telegram & Social Mentions',
        'Surfaces public Telegram, WhatsApp click-to-chat, LinkedIn, Facebook, X, Instagram, and YouTube links.',
        `(site:wa.me OR site:api.whatsapp.com OR site:t.me OR site:linkedin.com OR site:facebook.com OR site:instagram.com OR site:x.com OR site:youtube.com) ("${e164}" OR "${national}" OR "${digits}")`
      ),
      mk(
        'phone-code-pastes',
        'Code & Pastes',
        'Pastebin, GitHub, Gist & Public Code Leaks',
        'Detects accidental commits, Gist snippets, Pastebin entries, and Rentry/Ghostbin dumps.',
        `(site:pastebin.com OR site:gist.github.com OR site:github.com OR site:gitlab.com OR site:rentry.co OR site:controlc.com) ${coreExpr}`
      ),
      mk(
        'phone-gov-tenders-records',
        'Archives & Records',
        'Official Gazettes, Filings, Notices & Registries',
        'Locates government portals, academic notices, legal filings, GST/MCA directories, and merchant registrations.',
        `(site:.gov.* OR site:.gov.in OR site:.nic.in OR site:.edu OR site:.org OR inurl:tender OR inurl:notice OR inurl:invoice) ("${national}" OR "${e164}" OR "${spaced5}")`
      ),
      mk(
        'phone-cloud-docs',
        'Files & Documents',
        'Public Cloud Shares, Forms & Indexed Sheets',
        'Searches public Google Docs/Sheets/Drive, Notion, Scribd, SlideShare, and Dropbox links mentioning this number.',
        `(site:docs.google.com OR site:drive.google.com OR site:notion.site OR site:scribd.com OR site:slideshare.net OR site:dropbox.com) ("${national}" OR "${e164}" OR "${spaced5}")`
      ),
      mk(
        'phone-buckets-configs',
        'Archives & Records',
        'Cloud Storage Buckets & Exposed Config Exports',
        'Checks AWS S3, Azure Blob, GCS buckets, Firebase JSON endpoints, and exposed SQLite/env exports.',
        `(site:s3.amazonaws.com OR site:blob.core.windows.net OR site:storage.googleapis.com OR site:firebaseio.com) ("${national}" OR "${e164}" OR "${digits}")`
      ),
    ];

    if (cleanExtra.length > 0) {
      queries.push(
        mk(
          'phone-correlated-pivot',
          'Websites & Mentions',
          'Correlated Identifier & Handle Pivot',
          `Cross-references phone variants with linked handles/terms: ${cleanExtra.join(', ')}`,
          `("${national}" OR "${e164}") (${cleanExtra.map((t) => `"${t}"`).join(' OR ')})`
        )
      );
    }

    return { queries, variantsUsed: variants };
  }

  if (targetType === 'email') {
    const emailDomain = target.split('@')[1] || '';
    const safeExtraEmails = cleanExtra.filter((t) => t.includes('@'));
    const pivotTerms = Array.from(new Set([target, ...safeExtraEmails])).slice(0, 4);
    const pivotExpr = pivotTerms.map((t) => `"${t}"`).join(' OR ');
    const isCorpDomain = Boolean(
      emailDomain && !FREE_MAIL_DOMAINS.has(emailDomain.toLowerCase())
    );
    const corpScopedTerm = `"${target}"`;

    const queries: GoogleDorkQuery[] = [
      mk(
        'email-exact-web',
        'Websites & Mentions',
        'Exact Email Web Footprints',
        'Finds every public webpage, forum thread, bio, or directory citing the exact email address.',
        `"${target}"`
      ),
      mk(
        'email-files-docs',
        'Files & Documents',
        'Exposed PDFs, Spreadsheets, SQL & Env Files',
        'Locates the exact email inside downloadable PDFs, XLSX/CSV exports, SQL backups, and ENV files.',
        `(filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:docx OR filetype:sql OR filetype:txt OR filetype:log OR filetype:json) ${corpScopedTerm}`
      ),
      mk(
        'email-pastes-code',
        'Code & Pastes',
        'GitHub, Replit, Render, Lovable, Cloud Deploys & Pastes',
        'Checks public repositories, Replit/Lovable/CodePen/Glitch apps, Render/Vercel/Netlify hosts, and paste sites for the exact email.',
        `(site:github.com OR site:gist.github.com OR site:gitlab.com OR site:replit.com OR site:render.com OR site:onrender.com OR site:lovable.dev OR site:lovable.app OR site:vercel.app OR site:netlify.app OR site:pastebin.com OR site:npmjs.com) (${pivotExpr})`
      ),
      mk(
        'email-saas-platforms',
        'Websites & Mentions',
        'Canva, Quora, Wix, Zoho, QuillBot & SaaS Mentions',
        'Searches Canva, Quora, Wix, Zoho, QuillBot, Notion, Figma, Atlassian, and Trello public pages citing the exact email.',
        `(site:canva.com OR site:quora.com OR site:wix.com OR site:wixsite.com OR site:zoho.com OR site:quillbot.com OR site:notion.so OR site:figma.com OR site:trello.com OR site:atlassian.com) (${pivotExpr})`
      ),
      mk(
        'email-social-profiles',
        'Websites & Mentions',
        'Social Media, Gaming, Docs & Community Mentions',
        'Searches LinkedIn, Reddit, X, Chess.com, CrazyGames, Plex, Patreon, Linktree, and Google Docs/Drive public shares.',
        `(site:linkedin.com OR site:reddit.com OR site:medium.com OR site:x.com OR site:chess.com OR site:crazygames.com OR site:plex.tv OR site:itch.io OR site:linktr.ee OR site:docs.google.com) (${pivotExpr})`
      ),
      mk(
        'email-open-dirs',
        'Archives & Records',
        'Open Directories, Staff Rosters & Mailing Lists',
        'Detects indexed Apache/Nginx folders, public mailing list archives, and staff lists containing the exact email.',
        `(intitle:"index of" OR inurl:lists OR inurl:pipermail OR inurl:directory OR inurl:contact) "${target}"`
      ),
    ];

    if (isCorpDomain) {
      queries.push(
        mk(
          'email-corp-domain',
          'Archives & Records',
          `Corporate Domain & Org Exposure (${emailDomain})`,
          'Enumerates public files and portals belonging to the custom email domain.',
          `site:${emailDomain} "${target}" (filetype:pdf OR filetype:xlsx OR filetype:csv OR inurl:contact OR inurl:team OR intitle:"index of")`
        )
      );
    }

    return { queries, variantsUsed: [target, ...(emailDomain ? [emailDomain] : [])] };
  }

  if (targetType === 'username') {
    const clean = target.replace(/^@/, '').trim();
    const quotedHandle = `"${clean}"`;
    const atHandle = `"@${clean}"`;
    const queries: GoogleDorkQuery[] = [
      mk(
        'user-exact-mentions',
        'Websites & Mentions',
        'Global Handle & @Mention Sweep',
        'Discovers websites, blogs, comments, and forum posts mentioning this handle.',
        `(${quotedHandle} OR ${atHandle}) -site:facebook.com/login`
      ),
      mk(
        'user-files-docs',
        'Files & Documents',
        'Published Papers, Resumes, PDFs & Datasets',
        'Hunts PDFs, DOCX portfolios, CSV datasets, and TXT notes authored under this handle.',
        `(filetype:pdf OR filetype:docx OR filetype:csv OR filetype:xlsx OR filetype:txt OR filetype:json) (${quotedHandle} OR ${atHandle})`
      ),
      mk(
        'user-code-pastes',
        'Code & Pastes',
        'Code Forges, Replit, Render, Vercel & Packages',
        'Surfaces GitHub/GitLab repos, Replit/Glitch/CodePen sandboxes, Render/Vercel/Netlify hosts, and Pastebin.',
        `(site:github.com OR site:gist.github.com OR site:gitlab.com OR site:replit.com OR site:onrender.com OR site:render.com OR site:vercel.app OR site:netlify.app OR site:glitch.com OR site:codepen.io OR site:pastebin.com OR site:npmjs.com OR site:pypi.org OR site:huggingface.co) ${quotedHandle}`
      ),
      mk(
        'user-gaming-creator',
        'Websites & Mentions',
        'Gaming, Esports & Creator Networks',
        'Searches CrazyGames, Roblox, Steam, Itch.io, Twitch, Kick, Chess.com, Patreon, and Linktree profiles.',
        `(site:crazygames.com OR site:roblox.com OR site:steamcommunity.com OR site:itch.io OR site:twitch.tv OR site:kick.com OR site:chess.com OR site:lichess.org OR site:patreon.com OR site:linktr.ee) (${quotedHandle} OR ${atHandle})`
      ),
      mk(
        'user-inurl-profiles',
        'Websites & Mentions',
        'URL Path Profiles Across Platforms',
        'Matches clean `/u/`, `/user/`, `/~handle`, or author URLs indexed on the open web.',
        `inurl:"/${clean}" (inurl:user OR inurl:u OR inurl:profile OR inurl:author OR inurl:members)`
      ),
      mk(
        'user-forums-communities',
        'Archives & Records',
        'Forums, Q&A Archives & Social Threads',
        'Searches Reddit, Bluesky, Mastodon, Hacker News, StackOverflow, Medium, Telegram, and archived threads.',
        `(site:reddit.com OR site:bsky.app OR site:mastodon.social OR site:t.me OR site:news.ycombinator.com OR site:stackoverflow.com OR site:medium.com OR site:dev.to) ${quotedHandle}`
      ),
    ];

    if (cleanExtra.length > 0) {
      queries.push(
        mk(
          'user-linked-pivot',
          'Websites & Mentions',
          'Cross-Linked Email & Alias Pivot',
          `Correlates handle with discovered profile metadata: ${cleanExtra.join(', ')}`,
          `${quotedHandle} (${cleanExtra.map((t) => `"${t}"`).join(' OR ')})`
        )
      );
    }

    return { queries, variantsUsed: [clean, `@${clean}`] };
  }

  if (targetType === 'domain') {
    const cleanDomain = target.replace(/^https?:\/\//i, '').split('/')[0].toLowerCase();
    const queries: GoogleDorkQuery[] = [
      mk(
        'domain-subdomains',
        'Archives & Records',
        'Subdomain & Staging Enumeration',
        'Finds indexed subdomains excluding primary www host.',
        `site:*.${cleanDomain} -www.${cleanDomain}`
      ),
      mk(
        'domain-files',
        'Files & Documents',
        'Exposed Documents, Spreadsheets & Backups',
        'Scans domain for public PDFs, XLSX/CSV datasets, SQL backups, TXT, and JSON files.',
        `site:${cleanDomain} (filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:docx OR filetype:sql OR filetype:json OR filetype:txt OR filetype:log)`
      ),
      mk(
        'domain-open-dirs',
        'Archives & Records',
        'Open Directory Listings & Sensitive Routes',
        'Checks for exposed directory indexes, admin portals, config paths, and API docs.',
        `site:${cleanDomain} (intitle:"index of" OR inurl:admin OR inurl:api OR inurl:swagger OR inurl:config OR inurl:backup OR ext:env OR ext:yml)`
      ),
      mk(
        'domain-code-leaks',
        'Code & Pastes',
        'External Code, Gist & Pastebin Mentions',
        'Searches GitHub, GitLab, and Pastebin for tokens, endpoints, or references to this domain.',
        `(site:github.com OR site:gist.github.com OR site:gitlab.com OR site:pastebin.com) "${cleanDomain}"`
      ),
      mk(
        'domain-external-mentions',
        'Websites & Mentions',
        'Third-Party Web Mentions & Reports',
        'Finds external press, security advisories, and forum discussions referencing this domain.',
        `"${cleanDomain}" -site:${cleanDomain}`
      ),
      mk(
        'domain-cloud-buckets',
        'Files & Documents',
        'Cloud Buckets, Backups & S3/GCS Mirrors',
        'Scans AWS S3, GCS, Azure Blob, and Firebase storage paths mentioning this domain.',
        `(site:s3.amazonaws.com OR site:storage.googleapis.com OR site:blob.core.windows.net OR site:firebaseio.com) "${cleanDomain}"`
      ),
    ];

    return { queries, variantsUsed: [cleanDomain] };
  }

  // IP address dorks
  const cleanIp = target.trim();
  const queries: GoogleDorkQuery[] = [
    mk(
      'ip-exact-mentions',
      'Websites & Mentions',
      'Direct IP References & Indexed Hosts',
      'Finds direct IP citations, HTTP server banners, reverse proxies, and host logs.',
      `"${cleanIp}"`
    ),
    mk(
      'ip-files-logs',
      'Files & Documents',
      'Exposed Logs, Configs, Text & JSON Dumps',
      'Locates server logs, network inventories, PCAP/TXT notes, and configs mentioning this IP.',
      `(filetype:log OR filetype:txt OR filetype:json OR filetype:csv OR filetype:conf OR filetype:yml OR filetype:pdf) "${cleanIp}"`
    ),
    mk(
      'ip-code-pastes',
      'Code & Pastes',
      'GitHub, Gist & Pastebin IP Leaks',
      'Identifies hardcoded IP endpoints in public repos, CI configs, and paste sites.',
      `(site:github.com OR site:gist.github.com OR site:pastebin.com OR site:gitlab.com) "${cleanIp}"`
    ),
    mk(
      'ip-threat-records',
      'Archives & Records',
      'Threat Intelligence, Shodan, Censys & BGP Mirrors',
      'Checks public network observatory caches and BGP/WHOIS mirrors.',
      `(site:shodan.io OR site:search.censys.io OR site:bgp.he.net OR site:ipinfo.io OR site:abuseipdb.com OR site:virustotal.com) "${cleanIp}"`
    ),
  ];

  return { queries, variantsUsed: [cleanIp] };
}

async function fetchTextTimeout(
  url: string,
  timeoutMs = 5200,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean; status: number; text: string }> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept:
          'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } catch {
    return { ok: false, status: 0, text: '' };
  }
}

async function fetchJsonTimeout<T>(
  url: string,
  timeoutMs = 5000,
  headers: Record<string, string> = {}
): Promise<{ ok: boolean; data?: T }> {
  const res = await fetchTextTimeout(url, timeoutMs, {
    Accept: 'application/json',
    ...headers,
  });
  if (!res.ok || !res.text) return { ok: false };
  try {
    return { ok: true, data: JSON.parse(res.text) as T };
  } catch {
    return { ok: false };
  }
}

function parseDuckDuckGoHtml(
  html: string,
  matchedQuery: string,
  hintCategory?: DorkResourceCategory
): GoogleDorkHit[] {
  if (!html) return [];
  const hits: GoogleDorkHit[] = [];

  // 1. DuckDuckGo HTML format: <a rel="nofollow" class="result__a" href="...">Title</a>
  const anchorRegex =
    /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const snippetRegex =
    /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

  const snippets: string[] = [];
  let sMatch: RegExpExecArray | null;
  while ((sMatch = snippetRegex.exec(html)) !== null) {
    snippets.push(decodeHtmlEntities(sMatch[1] || sMatch[2] || ''));
  }

  let match: RegExpExecArray | null;
  let idx = 0;
  while ((match = anchorRegex.exec(html)) !== null && hits.length < 15) {
    const rawHref = match[1];
    const title = decodeHtmlEntities(match[2]);
    const url = unwrapDuckDuckGoHref(rawHref);
    if (!url || !title || extractDomain(url).includes('duckduckgo.com')) {
      idx += 1;
      continue;
    }
    const domain = extractDomain(url);
    const snippet = snippets[idx] || `Indexed web match on ${domain}`;
    const fileType = detectFileFormat(url, title, snippet);
    hits.push({
      id: `ddg-${idx}-${Buffer.from(url).toString('base64url').slice(0, 14)}`,
      title,
      url,
      domain,
      snippet,
      category: classifyHitCategory(url, fileType, hintCategory),
      fileType,
      sourceEngine: 'DuckDuckGo Dork',
      matchedQuery,
    });
    idx += 1;
  }

  if (hits.length > 0) return hits;

  // 2. Fallback: DuckDuckGo Lite format (<a rel="nofollow" href="..." class='result-link'>)
  const liteRegex =
    /<a[^>]*href="([^"]+)"[^>]*class=['"][^'"]*result-link[^'"]*['"][^>]*>([\s\S]*?)<\/a>/gi;
  const liteSnippets: string[] = [];
  const liteSnipRegex = /<td[^>]*class=['"][^'"]*result-snippet[^'"]*['"][^>]*>([\s\S]*?)<\/td>/gi;
  let ls: RegExpExecArray | null;
  while ((ls = liteSnipRegex.exec(html)) !== null) {
    liteSnippets.push(decodeHtmlEntities(ls[1] || ''));
  }

  let lIdx = 0;
  while ((match = liteRegex.exec(html)) !== null && hits.length < 15) {
    const url = unwrapDuckDuckGoHref(match[1]);
    const title = decodeHtmlEntities(match[2]);
    if (!url || !title || extractDomain(url).includes('duckduckgo.com')) {
      lIdx += 1;
      continue;
    }
    const domain = extractDomain(url);
    const snippet = liteSnippets[lIdx] || `Indexed web match on ${domain}`;
    const fileType = detectFileFormat(url, title, snippet);
    hits.push({
      id: `ddgl-${lIdx}-${Buffer.from(url).toString('base64url').slice(0, 14)}`,
      title,
      url,
      domain,
      snippet,
      category: classifyHitCategory(url, fileType, hintCategory),
      fileType,
      sourceEngine: 'DuckDuckGo Dork',
      matchedQuery,
    });
    lIdx += 1;
  }

  return hits;
}

async function queryDuckDuckGoDork(
  query: string,
  hintCategory?: DorkResourceCategory
): Promise<GoogleDorkHit[]> {
  const htmlUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await fetchTextTimeout(htmlUrl, 5200, {
    Referer: 'https://html.duckduckgo.com/',
  });
  let parsed = res.ok ? parseDuckDuckGoHtml(res.text, query, hintCategory) : [];
  if (parsed.length === 0) {
    const liteUrl = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
    const liteRes = await fetchTextTimeout(liteUrl, 4800, {
      Referer: 'https://lite.duckduckgo.com/',
    });
    if (liteRes.ok) {
      parsed = parseDuckDuckGoHtml(liteRes.text, query, hintCategory);
    }
  }
  return parsed;
}

async function queryGoogleCustomSearch(
  query: string,
  hintCategory?: DorkResourceCategory
): Promise<GoogleDorkHit[]> {
  const apiKey = process.env.GOOGLE_CSE_API_KEY?.trim();
  const cx = process.env.GOOGLE_CSE_CX?.trim();
  if (!apiKey || !cx) return [];

  const res = await fetchJsonTimeout<{
    items?: Array<{
      title?: string;
      link?: string;
      snippet?: string;
      displayLink?: string;
    }>;
  }>(
    `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(apiKey)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(query)}&num=10`,
    5200
  );
  if (!res.ok || !Array.isArray(res.data?.items)) return [];

  return res.data.items
    .filter((i) => i.link && i.title)
    .map((item, idx) => {
      const url = item.link!;
      const title = item.title!;
      const snippet = item.snippet || '';
      const fileType = detectFileFormat(url, title, snippet);
      return {
        id: `gcse-${idx}-${Buffer.from(url).toString('base64url').slice(0, 14)}`,
        title,
        url,
        domain: item.displayLink || extractDomain(url),
        snippet,
        category: classifyHitCategory(url, fileType, hintCategory),
        fileType,
        sourceEngine: 'Google CSE' as const,
        matchedQuery: query,
      };
    });
}

async function queryGitHubPublicSearch(term: string): Promise<GoogleDorkHit[]> {
  const clean = term.trim();
  if (!clean || clean.length < 4) return [];

  const quoted = `"${clean}"`;
  const [repoRes, issueRes, commitRes] = await Promise.all([
    fetchJsonTimeout<{
      items?: Array<{
        full_name: string;
        html_url: string;
        description?: string;
        updated_at?: string;
      }>;
    }>(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(quoted)}&per_page=6`,
      4500,
      { 'User-Agent': 'Parmanu-OSINT/3.1' }
    ),
    fetchJsonTimeout<{
      items?: Array<{
        title: string;
        html_url: string;
        repository_url?: string;
        created_at?: string;
        body?: string;
      }>;
    }>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(quoted)}&per_page=6`,
      4500,
      { 'User-Agent': 'Parmanu-OSINT/3.1' }
    ),
    clean.includes('@')
      ? fetchJsonTimeout<{
          items?: Array<{
            sha: string;
            html_url: string;
            commit?: {
              message?: string;
              author?: { name?: string; email?: string; date?: string };
            };
            repository?: { full_name?: string };
          }>;
        }>(
          `https://api.github.com/search/commits?q=${encodeURIComponent(`author-email:${clean}`)}&per_page=6`,
          4500,
          {
            'User-Agent': 'Parmanu-OSINT/3.1',
            Accept: 'application/vnd.github.cloak-preview+json, application/vnd.github+json',
          }
        )
      : Promise.resolve({ ok: false, data: undefined }),
  ]);

  const hits: GoogleDorkHit[] = [];
  if (repoRes.ok && Array.isArray(repoRes.data?.items)) {
    for (const r of repoRes.data.items) {
      const desc = (r.description || '').replace(/\s+/g, ' ').trim();
      hits.push({
        id: `ghr-${Buffer.from(r.html_url).toString('base64url').slice(0, 14)}`,
        title: `GitHub Repository: ${r.full_name}`,
        url: r.html_url,
        domain: 'github.com',
        snippet: desc,
        category: 'Code & Pastes',
        fileType: 'CODE',
        sourceEngine: 'GitHub Code Search',
        matchedQuery: `site:github.com ${quoted}`,
        timestamp: r.updated_at,
      });
    }
  }
  if (issueRes.ok && Array.isArray(issueRes.data?.items)) {
    for (const issue of issueRes.data.items) {
      const bodyClean = (issue.body || '').replace(/\s+/g, ' ').trim();
      hits.push({
        id: `ghi-${Buffer.from(issue.html_url).toString('base64url').slice(0, 14)}`,
        title: issue.title,
        url: issue.html_url,
        domain: 'github.com',
        snippet: bodyClean.slice(0, 220),
        category: 'Code & Pastes',
        fileType: 'CODE',
        sourceEngine: 'GitHub Code Search',
        matchedQuery: `site:github.com ${quoted}`,
        timestamp: issue.created_at,
      });
    }
  }
  if (commitRes.ok && Array.isArray(commitRes.data?.items)) {
    for (const c of commitRes.data.items) {
      const repoName = c.repository?.full_name || 'GitHub Commit';
      const authorEmail = c.commit?.author?.email || '';
      const authorName = c.commit?.author?.name || '';
      const msg = (c.commit?.message || '').split('\n')[0]?.trim() || '';
      hits.push({
        id: `ghc-${Buffer.from(c.html_url).toString('base64url').slice(0, 14)}`,
        title: `Commit in ${repoName}: ${msg.slice(0, 72)}`,
        url: c.html_url,
        domain: 'github.com',
        snippet: `${authorName}${authorEmail ? ` <${authorEmail}>` : ''} · ${msg}`.slice(0, 220),
        category: 'Code & Pastes',
        fileType: 'CODE',
        sourceEngine: 'GitHub Code Search',
        matchedQuery: `author-email:${clean}`,
        timestamp: c.commit?.author?.date,
      });
    }
  }
  return hits;
}

async function querySourcegraphCode(term: string): Promise<GoogleDorkHit[]> {
  const clean = term.trim();
  if (!clean || clean.length < 4) return [];

  try {
    const res = await fetch('https://sourcegraph.com/.api/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': BROWSER_UA,
      },
      body: JSON.stringify({
        query:
          'query ($q: String!) { search(query: $q) { results { results { ... on FileMatch { file { path url } repository { name } lineMatches { preview lineNumber } } } } } }',
        variables: { q: `"${clean}" count:12` },
      }),
      signal: AbortSignal.timeout(5200),
    });
    if (!res.ok) return [];
    const json = (await res.json()) as {
      data?: {
        search?: {
          results?: {
            results?: Array<{
              file?: { path?: string; url?: string };
              repository?: { name?: string };
              lineMatches?: Array<{ preview?: string; lineNumber?: number }>;
            }>;
          };
        };
      };
    };

    const items = json?.data?.search?.results?.results;
    if (!Array.isArray(items)) return [];

    const hits: GoogleDorkHit[] = [];
    for (const item of items.slice(0, 12)) {
      const fileUrl = item.file?.url;
      const filePath = item.file?.path;
      const repo = item.repository?.name || 'public repository';
      if (!fileUrl || !filePath) continue;
      const fullUrl = fileUrl.startsWith('http')
        ? fileUrl
        : `https://sourcegraph.com${fileUrl}`;
      const lineSnippets = (item.lineMatches || [])
        .map((lm) => `${lm.lineNumber ? `L${lm.lineNumber}: ` : ''}${(lm.preview || '').trim()}`)
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ');

      hits.push({
        id: `sg-${Buffer.from(fullUrl).toString('base64url').slice(0, 14)}`,
        title: `${repo} — ${filePath}`,
        url: fullUrl,
        domain: 'sourcegraph.com',
        snippet: lineSnippets || `Indexed source file matching "${clean}" in ${repo}`,
        category: 'Code & Pastes',
        fileType: 'CODE',
        sourceEngine: 'Sourcegraph Code Search',
        matchedQuery: `"${clean}"`,
      });
    }
    return hits;
  } catch {
    return [];
  }
}

async function queryStackOverflowSearch(
  target: string,
  targetType: TargetType
): Promise<GoogleDorkHit[]> {
  const clean = target.trim();
  if (!clean || clean.length < 4) return [];

  let q = `"${clean}"`;
  if (targetType === 'phone') {
    const { national } = derivePhoneVariants(clean);
    if (national.length >= 9) {
      q = national;
    }
  }

  const res = await fetchJsonTimeout<{
    items?: Array<{
      question_id?: number;
      title?: string;
      link?: string;
      body?: string;
      creation_date?: number;
    }>;
  }>(
    `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(
      q
    )}&site=stackoverflow&filter=withbody&pagesize=6`,
    5000
  );

  if (!res.ok || !Array.isArray(res.data?.items)) return [];
  const hits: GoogleDorkHit[] = [];
  for (const item of res.data.items) {
    if (!item.link || !item.title) continue;
    const bodyText = stripHtmlForMatching(item.body || '').slice(0, 240);
    hits.push({
      id: `so-${item.question_id || hits.length}`,
      title: decodeHtmlEntities(item.title),
      url: item.link,
      domain: 'stackoverflow.com',
      snippet: bodyText || decodeHtmlEntities(item.title),
      category: 'Code & Pastes',
      fileType: 'WEB',
      sourceEngine: 'StackOverflow Search',
      matchedQuery: `site:stackoverflow.com "${clean}"`,
      timestamp: item.creation_date
        ? new Date(item.creation_date * 1000).toISOString()
        : undefined,
    });
  }
  return hits;
}

async function queryHackerNews(term: string): Promise<GoogleDorkHit[]> {
  const clean = term.trim();
  if (!clean || clean.length < 4) return [];
  const res = await fetchJsonTimeout<{
    hits?: Array<{
      objectID: string;
      title?: string;
      story_title?: string;
      url?: string;
      story_url?: string;
      comment_text?: string;
      created_at?: string;
      author?: string;
    }>;
  }>(
    `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(`"${clean}"`)}&hitsPerPage=6`,
    4500
  );
  if (!res.ok || !Array.isArray(res.data?.hits)) return [];

  return res.data.hits
    .map((h) => {
      const itemUrl =
        h.url ||
        h.story_url ||
        `https://news.ycombinator.com/item?id=${h.objectID}`;
      const title =
        h.title ||
        h.story_title ||
        `Hacker News discussion by ${h.author || 'member'}`;
      const snippet = h.comment_text
        ? decodeHtmlEntities(h.comment_text).slice(0, 180)
        : `Hacker News archive match for "${clean}"`;
      const fileType = detectFileFormat(itemUrl, title, snippet);
      return {
        id: `hn-${h.objectID}`,
        title,
        url: itemUrl,
        domain: extractDomain(itemUrl) || 'news.ycombinator.com',
        snippet,
        category: classifyHitCategory(itemUrl, fileType, 'Websites & Mentions'),
        fileType,
        sourceEngine: 'Hacker News' as const,
        matchedQuery: `site:news.ycombinator.com "${clean}"`,
        timestamp: h.created_at,
      };
    })
    .slice(0, 6);
}

async function queryRedditPublic(term: string): Promise<GoogleDorkHit[]> {
  const clean = term.trim();
  if (!clean || clean.length < 4) return [];
  const res = await fetchJsonTimeout<{
    data?: {
      children?: Array<{
        data?: {
          id?: string;
          title?: string;
          permalink?: string;
          selftext?: string;
          subreddit_name_prefixed?: string;
          created_utc?: number;
        };
      }>;
    };
  }>(
    `https://www.reddit.com/search.json?q=${encodeURIComponent(`"${clean}"`)}&limit=6&sort=relevance`,
    4500,
    { 'User-Agent': 'Parmanu-OSINT/3.1 (public research)' }
  );

  if (!res.ok || !Array.isArray(res.data?.data?.children)) return [];

  const hits: GoogleDorkHit[] = [];
  for (const child of res.data.data.children) {
    const d = child.data;
    if (!d?.title || !d?.permalink) continue;
    const url = `https://www.reddit.com${d.permalink}`;
    hits.push({
      id: `reddit-${d.id || hits.length}`,
      title: `${d.title}${d.subreddit_name_prefixed ? ` (${d.subreddit_name_prefixed})` : ''}`,
      url,
      domain: 'reddit.com',
      snippet:
        (d.selftext || '').replace(/\s+/g, ' ').slice(0, 180) ||
        `Public Reddit mention matching "${clean}"`,
      category: 'Websites & Mentions',
      fileType: 'WEB',
      sourceEngine: 'Reddit Search',
      matchedQuery: `site:reddit.com "${clean}"`,
      timestamp: d.created_utc
        ? new Date(d.created_utc * 1000).toISOString()
        : undefined,
    });
  }
  return hits;
}

async function queryWaybackCdx(domainOrHost: string): Promise<GoogleDorkHit[]> {
  const clean = domainOrHost
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
  if (!clean || !clean.includes('.') || FREE_MAIL_DOMAINS.has(clean)) {
    return [];
  }

  const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=*.${encodeURIComponent(clean)}/*&output=json&fl=timestamp,original,mimetype,statuscode&filter=statuscode:200&collapse=urlkey&limit=30`;
  const res = await fetchJsonTimeout<string[][]>(cdxUrl, 5200);
  if (!res.ok || !Array.isArray(res.data) || res.data.length < 2) return [];

  const rows = res.data.slice(1);
  // Prioritize interesting files / documents / endpoints first
  const sorted = [...rows].sort((a, b) => {
    const interesting = /\.(pdf|xlsx?|csv|docx?|txt|sql|json|xml|log|env|yml)(\?|$)/i;
    const aInt = interesting.test(a[1] || '') ? 1 : 0;
    const bInt = interesting.test(b[1] || '') ? 1 : 0;
    return bInt - aInt;
  });

  const hits: GoogleDorkHit[] = [];
  for (const row of sorted.slice(0, 10)) {
    const [ts, origUrl, mime] = row;
    if (!origUrl) continue;
    const fileType = detectFileFormat(origUrl);
    const archiveUrl = `https://web.archive.org/web/${ts}/${origUrl}`;
    const formattedTs =
      ts && ts.length >= 8
        ? `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`
        : undefined;
    hits.push({
      id: `wb-${ts}-${Buffer.from(origUrl).toString('base64url').slice(0, 12)}`,
      title: `Archived Record: ${origUrl.replace(/^https?:\/\//i, '').slice(0, 88)}`,
      url: archiveUrl,
      domain: extractDomain(origUrl) || clean,
      snippet: `Wayback Machine snapshot (${mime || 'indexed asset'}${formattedTs ? `, captured ${formattedTs}` : ''})`,
      category:
        fileType === 'WEB'
          ? 'Archives & Records'
          : classifyHitCategory(origUrl, fileType, 'Archives & Records'),
      fileType,
      sourceEngine: 'Wayback CDX',
      matchedQuery: `site:${clean}`,
      timestamp: formattedTs,
    });
  }
  return hits;
}

async function queryArchiveOrgSearch(term: string): Promise<GoogleDorkHit[]> {
  const clean = term.trim();
  if (!clean || clean.length < 4) return [];
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(`"${clean}"`)}&fl[]=identifier&fl[]=title&fl[]=description&fl[]=mediatype&fl[]=publicdate&rows=8&output=json`;
  const res = await fetchJsonTimeout<{
    response?: {
      docs?: Array<{
        identifier?: string;
        title?: string;
        description?: string | string[];
        mediatype?: string;
        publicdate?: string;
      }>;
    };
  }>(url, 5000);

  const docs = res.data?.response?.docs;
  if (!res.ok || !Array.isArray(docs)) return [];

  return docs
    .filter((d) => d.identifier)
    .map((d, idx) => {
      const itemUrl = `https://archive.org/details/${encodeURIComponent(d.identifier!)}`;
      const title = d.title || d.identifier!;
      const descRaw = Array.isArray(d.description)
        ? d.description.join(' ')
        : d.description || '';
      const snippet =
        decodeHtmlEntities(descRaw).slice(0, 180) ||
        `Internet Archive ${d.mediatype || 'record'} mentioning "${clean}"`;
      const isDoc = /texts|pdf|data/i.test(d.mediatype || '');
      return {
        id: `ia-${idx}-${Buffer.from(d.identifier!).toString('base64url').slice(0, 12)}`,
        title,
        url: itemUrl,
        domain: 'archive.org',
        snippet,
        category: isDoc ? ('Files & Documents' as const) : ('Archives & Records' as const),
        fileType: isDoc ? ('PDF' as const) : ('ARCHIVE' as const),
        sourceEngine: 'Archive.org Search' as const,
        matchedQuery: `site:archive.org "${clean}"`,
        timestamp: d.publicdate,
      };
    });
}

export async function queryBingRssDork(
  query: string,
  hintCategory?: DorkResourceCategory
): Promise<GoogleDorkHit[]> {
  const rssUrl = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&count=12`;
  const res = await fetchTextTimeout(rssUrl, 4800, {
    Accept: 'application/rss+xml, application/xml, text/xml',
  });
  if (!res.ok || !res.text || !res.text.includes('<item>')) return [];

  const hits: GoogleDorkHit[] = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  let idx = 0;

  while ((m = itemRegex.exec(res.text)) !== null && hits.length < 12) {
    const block = m[1];
    const extractTag = (tag: string) => {
      const tm = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(block);
      if (!tm) return '';
      return decodeHtmlEntities(
        tm[1].replace(/^<!\[CDATA\[/, '').replace(/\]\]>$/, '')
      );
    };

    const title = extractTag('title');
    const url = extractTag('link');
    const description = extractTag('description');
    const pubDate = extractTag('pubDate');
    if (!url || !/^https?:\/\//i.test(url) || !title) {
      idx += 1;
      continue;
    }

    let isoTs: string | undefined;
    if (pubDate) {
      const parsedDate = new Date(pubDate);
      if (!Number.isNaN(parsedDate.getTime())) {
        isoTs = parsedDate.toISOString();
      }
    }

    const domain = extractDomain(url);
    const fileType = detectFileFormat(url, title, description);
    hits.push({
      id: `bing-${idx}-${Buffer.from(url).toString('base64url').slice(0, 14)}`,
      title,
      url,
      domain,
      snippet: description || `Indexed Bing Search record on ${domain}`,
      category: classifyHitCategory(url, fileType, hintCategory),
      fileType,
      sourceEngine: 'Bing Search Index',
      matchedQuery: query,
      timestamp: isoTs,
    });
    idx += 1;
  }

  return hits;
}

async function queryCrtShDork(domainOrHost: string): Promise<GoogleDorkHit[]> {
  const clean = domainOrHost
    .replace(/^https?:\/\//i, '')
    .split('/')[0]
    .trim()
    .toLowerCase();
  if (!clean || !clean.includes('.') || FREE_MAIL_DOMAINS.has(clean)) {
    return [];
  }

  const res = await fetchJsonTimeout<
    Array<{
      id?: number;
      name_value?: string;
      common_name?: string;
      issuer_name?: string;
      entry_timestamp?: string;
      not_before?: string;
    }>
  >(`https://crt.sh/?q=%25.${encodeURIComponent(clean)}&output=json`, 5200);

  if (!res.ok || !Array.isArray(res.data)) return [];

  const seenHosts = new Set<string>();
  const hits: GoogleDorkHit[] = [];

  for (const cert of res.data.slice(0, 60)) {
    const names = (cert.name_value || cert.common_name || '')
      .split(/\s+/)
      .map((s) => s.replace(/^\*\./, '').trim().toLowerCase())
      .filter((s) => s && s.endsWith(clean));

    for (const host of names) {
      if (seenHosts.has(host)) continue;
      seenHosts.add(host);
      hits.push({
        id: `crt-${cert.id || hits.length}-${Buffer.from(host).toString('base64url').slice(0, 10)}`,
        title: `TLS Subdomain Record: ${host}`,
        url: `https://crt.sh/?q=${encodeURIComponent(host)}`,
        domain: host,
        snippet: `Certificate Transparency log entry (${cert.issuer_name ? cert.issuer_name.split(',')[0] : 'Public CA'})`,
        category: 'Archives & Records',
        fileType: 'ARCHIVE',
        sourceEngine: 'crt.sh Certificate Log',
        matchedQuery: `site:*.${clean}`,
        timestamp: cert.entry_timestamp || cert.not_before,
      });
      if (hits.length >= 10) return hits;
    }
  }

  return hits;
}

async function queryGoogleSearchGroundingDork(params: {
  target: string;
  targetType: TargetType;
  queries: GoogleDorkQuery[];
  mode: 'full' | 'phone-fast';
}): Promise<{ hits: GoogleDorkHit[]; active: boolean }> {
  const grounded = await runGeminiGoogleSearchDork({
    target: params.target,
    targetType: params.targetType,
    queries: params.queries.map((q) => q.query),
    mode: params.mode,
  });

  const hits: GoogleDorkHit[] = grounded.hits.map((g, idx) => {
    const fileType = detectFileFormat(g.url, g.title, g.snippet);
    return {
      id: `gsg-${idx}-${Buffer.from(g.url).toString('base64url').slice(0, 14)}`,
      title: g.title,
      url: g.url,
      domain: extractDomain(g.url) || 'google.com',
      snippet: g.snippet,
      category: classifyHitCategory(g.url, fileType, 'Websites & Mentions'),
      fileType,
      sourceEngine: 'Google Search Grounding',
      matchedQuery: g.matchedQuery,
    };
  });

  return { hits, active: grounded.active };
}

interface TargetMatchResult {
  matched: boolean;
  evidence: string;
  score: number;
}

function extractExcerptAround(text: string, index: number, length: number): string {
  const start = Math.max(0, index - 55);
  const end = Math.min(text.length, index + length + 75);
  const raw = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return `${start > 0 ? '...' : ''}${raw}${end < text.length ? '...' : ''}`;
}

function matchTextAgainstTarget(
  rawText: string,
  urlStr: string,
  target: string,
  targetType: TargetType,
  extraTerms: string[] = []
): TargetMatchResult {
  const cleanText = rawText.replace(/\s+/g, ' ').trim();
  const combined = `${urlStr} ${cleanText}`;
  if (!combined.trim()) return { matched: false, evidence: '', score: 0 };

  if (targetType === 'phone') {
    const { digits, national } = derivePhoneVariants(target);
    const patterns: RegExp[] = [];
    const buildFlexibleDigitRegex = (d: string) => {
      if (d.length < 8) return null;
      // Allow single-character separators (space, dash, dot, parens) inside digit runs
      const parts = d.split('').map((ch) => escapeRegExp(ch));
      const body = parts.join('[\\s.\\-()]{0,2}');
      return new RegExp(`(?:^|\\D)(?:\\+?${body})(?=\\D|$)`, 'i');
    };

    if (digits.length >= 9) {
      const rxFull = buildFlexibleDigitRegex(digits);
      if (rxFull) patterns.push(rxFull);
    }
    if (national.length >= 10 || (national === digits && national.length >= 8)) {
      const rxNat = buildFlexibleDigitRegex(national);
      if (rxNat) patterns.push(rxNat);
    }

    const haystack = cleanText || combined;
    for (let i = 0; i < patterns.length; i++) {
      const m = patterns[i].exec(haystack);
      if (m) {
        return {
          matched: true,
          evidence: extractExcerptAround(haystack, m.index, m[0].length),
          score: i === 0 ? 100 : 92,
        };
      }
    }
    return { matched: false, evidence: '', score: 0 };
  }

  if (targetType === 'email') {
    const emailLower = target.trim().toLowerCase();
    const normalizedCombined = combined
      .replace(/%40/gi, '@')
      .replace(/&#64;|&#x40;|\\u0040/gi, '@');
    const [localPart = '', emailDomain = ''] = emailLower.split('@');
    const exactRx = new RegExp(
      `(?:^|[^a-z0-9._+-])${escapeRegExp(emailLower)}(?=$|[^a-z0-9.-])`,
      'i'
    );
    const exactMatch = exactRx.exec(normalizedCombined);
    if (exactMatch) {
      return {
        matched: true,
        evidence: extractExcerptAround(normalizedCombined, exactMatch.index, exactMatch[0].length),
        score: 100,
      };
    }

    if (localPart && emailDomain) {
      const obfRx = new RegExp(
        `(?:^|[^a-z0-9._+-])${escapeRegExp(localPart)}\\s*(?:\\[at\\]|\\(at\\)|\\sat\\s|@)\\s*${escapeRegExp(emailDomain)}(?=$|[^a-z0-9.-])`,
        'i'
      );
      const obfMatch = obfRx.exec(normalizedCombined);
      if (obfMatch) {
        return {
          matched: true,
          evidence: extractExcerptAround(normalizedCombined, obfMatch.index, obfMatch[0].length),
          score: 88,
        };
      }
    }

    // Correlated verified handle match (when email scan discovered verified handles e.g. from GitHub/Gravatar/Duolingo)
    let urlPathname = '';
    try {
      urlPathname = new URL(urlStr).pathname.toLowerCase();
    } catch {
      urlPathname = urlStr.toLowerCase();
    }
    for (const termRaw of extraTerms) {
      const cleanTerm = termRaw.replace(/^@/, '').trim();
      if (cleanTerm.length < 4 || cleanTerm.includes('@')) continue;
      const urlHandleRx = new RegExp(
        `(?:^|[/@~])${escapeRegExp(cleanTerm.toLowerCase())}(?:$|[/?.&_-])`,
        'i'
      );
      if (urlHandleRx.test(urlPathname)) {
        return {
          matched: true,
          evidence: `Correlated verified handle @${cleanTerm} in URL path`,
          score: 86,
        };
      }
      const atMentionRx = new RegExp(`@${escapeRegExp(cleanTerm)}(?=$|[^a-z0-9_])`, 'i');
      const atM = atMentionRx.exec(normalizedCombined);
      if (atM) {
        return {
          matched: true,
          evidence: extractExcerptAround(normalizedCombined, atM.index, atM[0].length),
          score: 84,
        };
      }
    }
    return { matched: false, evidence: '', score: 0 };
  }

  if (targetType === 'username') {
    const clean = target.replace(/^@/, '').trim();
    if (!clean) return { matched: false, evidence: '', score: 0 };

    // Strongest match: URL path explicitly identifies handle or @handle mention
    let pathname = '';
    try {
      pathname = new URL(urlStr).pathname.toLowerCase();
    } catch {
      pathname = urlStr.toLowerCase();
    }
    const urlHandleRx = new RegExp(
      `(?:^|[/@~])${escapeRegExp(clean.toLowerCase())}(?:$|[/?.&_-])`,
      'i'
    );
    const atMentionRx = new RegExp(
      `@${escapeRegExp(clean)}(?=$|[^a-z0-9_])`,
      'i'
    );
    const wordBoundaryRx = new RegExp(
      `(?:^|[^a-z0-9_])${escapeRegExp(clean)}(?=$|[^a-z0-9_])`,
      'i'
    );

    const urlMatch = urlHandleRx.exec(pathname);
    if (urlMatch) {
      return {
        matched: true,
        evidence: `URL path match: ${pathname}`,
        score: 96,
      };
    }
    const atMatch = atMentionRx.exec(cleanText);
    if (atMatch) {
      return {
        matched: true,
        evidence: extractExcerptAround(cleanText, atMatch.index, atMatch[0].length),
        score: 94,
      };
    }

    // For short handles <= 4 chars, avoid generic English word collisions unless matched in URL or @handle
    if (clean.length <= 4) {
      return { matched: false, evidence: '', score: 0 };
    }

    const wbMatch = wordBoundaryRx.exec(cleanText);
    if (wbMatch) {
      return {
        matched: true,
        evidence: extractExcerptAround(cleanText, wbMatch.index, wbMatch[0].length),
        score: 84,
      };
    }
    return { matched: false, evidence: '', score: 0 };
  }

  if (targetType === 'domain') {
    const cleanDomain = target
      .replace(/^https?:\/\//i, '')
      .split('/')[0]
      .toLowerCase();
    const host = extractDomain(urlStr);
    if (host === cleanDomain || host.endsWith(`.${cleanDomain}`)) {
      return {
        matched: true,
        evidence: `Verified host ${host}`,
        score: 96,
      };
    }
    const domRx = new RegExp(
      `(?:^|[^a-z0-9.-])${escapeRegExp(cleanDomain)}(?=$|[^a-z0-9-])`,
      'i'
    );
    const domM = domRx.exec(combined);
    if (domM) {
      return {
        matched: true,
        evidence: extractExcerptAround(combined, domM.index, domM[0].length),
        score: 90,
      };
    }
    return { matched: false, evidence: '', score: 0 };
  }

  // IP address
  const cleanIp = target.trim();
  const ipRx = new RegExp(
    `(?:^|[^0-9a-f:.])${escapeRegExp(cleanIp)}(?=$|[^0-9a-f:.])`,
    'i'
  );
  const ipM = ipRx.exec(combined);
  if (ipM) {
    return {
      matched: true,
      evidence: extractExcerptAround(combined, ipM.index, ipM[0].length),
      score: 98,
    };
  }
  return { matched: false, evidence: '', score: 0 };
}

async function resolveRedirectAndVerifyLivePage(
  hit: GoogleDorkHit,
  target: string,
  targetType: TargetType,
  snippetAlreadyMatched: TargetMatchResult,
  extraTerms: string[] = []
): Promise<GoogleDorkHit | null> {
  if (!isSafePublicHttpUrl(hit.url)) return null;

  const isRedirectUrl = hit.url.includes('vertexaisearch.cloud.google.com');
  const isDirectDoc = /\.(pdf|xlsx?|csv|docx?|sql|zip|tar|gz)(\?|$)/i.test(hit.url);

  // Authoritative structured API records (GitHub Issues/Repos if snippet/title matched, crt.sh, Wayback CDX)
  if (
    hit.sourceEngine === 'crt.sh Certificate Log' ||
    hit.sourceEngine === 'Wayback CDX'
  ) {
    return {
      ...hit,
      verified: true,
      verificationMethod:
        hit.sourceEngine === 'crt.sh Certificate Log'
          ? 'ct-log'
          : 'wayback-snapshot',
      matchedEvidence: hit.snippet,
      confidenceScore: 95,
    };
  }

  // If this is a direct file URL (.pdf, .xlsx, etc.) whose snippet/URL already matched, verify HEAD 200 (or keep if bot-blocked)
  if (isDirectDoc && snippetAlreadyMatched.matched && !isRedirectUrl) {
    try {
      const headRes = await fetch(hit.url, {
        method: 'HEAD',
        headers: { 'User-Agent': BROWSER_UA },
        redirect: 'follow',
        signal: AbortSignal.timeout(3000),
      });
      if (headRes.status === 404 || headRes.status === 410) {
        return null;
      }
    } catch {
      // Allow search-indexed direct document if HEAD times out
    }
    return {
      ...hit,
      verified: true,
      verificationMethod: 'snippet-exact-match',
      matchedEvidence: snippetAlreadyMatched.evidence,
      confidenceScore: snippetAlreadyMatched.score,
    };
  }

  // Live fetch to resolve Google Grounding redirects and/or confirm exact target presence in live HTML/text
  let finalUrl = hit.url;
  let finalDomain = hit.domain;
  let status = 0;
  let plainBody = '';

  try {
    const res = await fetch(hit.url, {
      method: 'GET',
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(3800),
    });

    status = res.status;
    if (res.url && isSafePublicHttpUrl(res.url)) {
      finalUrl = res.url;
      finalDomain = extractDomain(finalUrl) || finalDomain;
    }

    if (isBlockedNoiseDomain(finalDomain)) {
      return null;
    }

    if (status === 404 || status === 410) {
      return null;
    }

    const contentType = (res.headers.get('content-type') || '').toLowerCase();
    if (
      res.ok &&
      (contentType.includes('text/') ||
        contentType.includes('json') ||
        contentType.includes('xml') ||
        !contentType)
    ) {
      const reader = res.body?.getReader();
      if (reader) {
        const chunks: Uint8Array[] = [];
        let bytesRead = 0;
        const cap = 160 * 1024;
        while (bytesRead < cap) {
          const { done, value } = await reader.read();
          if (done || !value) break;
          chunks.push(value);
          bytesRead += value.byteLength;
        }
        void reader.cancel().catch(() => {});
        const rawHtml = Buffer.concat(chunks).toString('utf8');
        plainBody = stripHtmlForMatching(rawHtml);
      } else {
        const raw = await res.text();
        plainBody = stripHtmlForMatching(raw.slice(0, 160 * 1024));
      }
    }
  } catch {
    // Live fetch timed out or blocked
  }

  // Re-evaluate final resolved URL & fetched body
  const fileType = detectFileFormat(finalUrl, hit.title, hit.snippet);
  const category = classifyHitCategory(finalUrl, fileType, hit.category);

  if (plainBody) {
    const bodyMatch = matchTextAgainstTarget(
      plainBody,
      finalUrl,
      target,
      targetType,
      extraTerms
    );
    if (bodyMatch.matched) {
      return {
        ...hit,
        url: finalUrl,
        domain: finalDomain,
        fileType,
        category,
        snippet:
          hit.snippet && !hit.snippet.startsWith('Indexed ')
            ? hit.snippet
            : bodyMatch.evidence,
        verified: true,
        verificationMethod: 'live-page-match',
        matchedEvidence: bodyMatch.evidence,
        confidenceScore: Math.max(bodyMatch.score, 95),
      };
    }
    // Live HTTP 200 returned full readable non-SPA page and target was NOT found anywhere on it
    // Note: Do NOT drop Google Search Grounding SPA/JS-rendered pages just because raw HTML shell lacked client-hydrated text
    const isGroundingHit =
      hit.sourceEngine === 'Google Search Grounding' || hit.sourceEngine === 'Google CSE';
    if (
      status >= 200 &&
      status < 300 &&
      plainBody.length > 400 &&
      !snippetAlreadyMatched.matched &&
      !isGroundingHit
    ) {
      return null;
    }
  }

  // If the search engine's own real snippet/title/URL already strictly confirmed the target (and page wasn't 404/410)
  // e.g. LinkedIn / Instagram / Replit blocking headless fetch with 403/999 while Google Grounding/GitHub/Sourcegraph returned exact text
  const stillUnresolvedRedirect = finalUrl.includes('vertexaisearch.cloud.google.com');
  if (snippetAlreadyMatched.matched && !stillUnresolvedRedirect && !isBlockedNoiseDomain(finalDomain)) {
    const isApi =
      hit.sourceEngine === 'GitHub Code Search' ||
      hit.sourceEngine === 'Sourcegraph Code Search' ||
      hit.sourceEngine === 'StackOverflow Search' ||
      hit.sourceEngine === 'Archive.org Search' ||
      hit.sourceEngine === 'Hacker News' ||
      hit.sourceEngine === 'Reddit Search';
    return {
      ...hit,
      url: finalUrl,
      domain: finalDomain,
      fileType,
      category,
      verified: true,
      verificationMethod: isApi ? 'api-exact-match' : 'snippet-exact-match',
      matchedEvidence: snippetAlreadyMatched.evidence,
      confidenceScore: snippetAlreadyMatched.score,
    };
  }

  // Otherwise unverified -> strictly drop!
  return null;
}

function isSyntheticPlaceholderSnippet(snippet: string): boolean {
  return /^(Indexed web match on|Indexed Bing Search record on|Verified live Google Search grounding result|Hacker News archive match|Public Reddit mention matching|Public GitHub repository matching|Internet Archive .* mentioning)/i.test(
    snippet.trim()
  );
}

export async function runDeepGoogleDorking(params: {
  target: string;
  targetType: TargetType;
  extraTerms?: string[];
  strictPivot?: string;
  mode?: 'full' | 'phone-fast';
}): Promise<GoogleDorkResponse> {
  const t0 = Date.now();
  const target = params.target.trim();
  const targetType = params.targetType;
  const mode = params.mode || 'full';

  const customPivot = (params.strictPivot || '').trim();
  const combinedExtraTerms = Array.from(
    new Set([
      ...(customPivot ? [customPivot] : []),
      ...(params.extraTerms || []),
    ])
  ).slice(0, 6);

  const { queries, variantsUsed } = buildQueriesForTarget(
    target,
    targetType,
    combinedExtraTerms
  );

  const dorksToExecute: GoogleDorkQuery[] = [];
  if (targetType === 'phone') {
    const { e164, national, variants } = derivePhoneVariants(target);
    const spaced5 =
      national.length === 10
        ? `${national.slice(0, 5)} ${national.slice(5)}`
        : variants[1] || national;
    const dashed =
      national.length === 10
        ? `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
        : variants[2] || national;

    dorksToExecute.push(
      {
        id: 'live-phone-web',
        category: 'Websites & Mentions',
        title: 'Live Multi-Variant Footprint',
        description: 'Live web query across all number variants',
        query: `"${e164}" OR "${national}" OR "${spaced5}" OR "${dashed}"`,
        googleUrl: queries[0]?.googleUrl || '',
      },
      {
        id: 'live-phone-files',
        category: 'Files & Documents',
        title: 'Live Exposed File & Document Discovery',
        description: 'Live PDF, XLSX, CSV, DOCX, TXT, SQL file search',
        query: `(filetype:pdf OR filetype:xlsx OR filetype:csv OR filetype:docx OR filetype:txt OR filetype:sql) ("${national}" OR "${e164}" OR "${spaced5}")`,
        googleUrl: queries[1]?.googleUrl || '',
      },
      {
        id: 'live-phone-pastes-dirs',
        category: 'Websites & Mentions',
        title: 'Live Directories, Pastes & Social Mentions',
        description: 'Public listings, Pastebin, GitHub, and messaging mentions',
        query: `("${national}" OR "${e164}") (site:justdial.com OR site:indiamart.com OR site:pastebin.com OR site:github.com OR site:t.me OR site:linkedin.com OR contact OR directory)`,
        googleUrl: queries[4]?.googleUrl || '',
      },
      {
        id: 'live-phone-records',
        category: 'Archives & Records',
        title: 'Live Government, PDF & Notice Records',
        description: 'Public tenders, PDF filings, invoices, and org records',
        query: `("${national}" OR "${spaced5}") (filetype:pdf OR invoice OR tender OR notice OR ".gov" OR ".org")`,
        googleUrl: queries[7]?.googleUrl || '',
      }
    );
  } else {
    dorksToExecute.push(...queries.slice(0, mode === 'full' ? 6 : 2));
  }

  const enginesQueried = [
    'Google Search Grounding',
    'DuckDuckGo Live Dorks',
    'Bing Search Index',
    'Sourcegraph Code Search',
    'GitHub Public Search',
    'StackOverflow Search',
    'Archive.org Search',
    'Hacker News Archive',
    'Reddit Search',
  ];
  if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) {
    enginesQueried.unshift('Google Custom Search API');
  }

  const searchTerm =
    targetType === 'phone'
      ? derivePhoneVariants(target).national
      : targetType === 'username'
      ? target.replace(/^@/, '')
      : target;

  const domainForWayback =
    targetType === 'domain'
      ? target
      : targetType === 'email'
      ? target.split('@')[1] || ''
      : '';

  if (domainForWayback && !FREE_MAIL_DOMAINS.has(domainForWayback.toLowerCase())) {
    enginesQueried.push('Wayback Machine CDX', 'crt.sh Certificate Log');
  }

  const groundingPromise = queryGoogleSearchGroundingDork({
    target,
    targetType,
    queries: customPivot
      ? [
          {
            id: 'custom-pivot-grounding',
            category: 'Websites & Mentions',
            title: 'Custom Pivot Search',
            description: 'Strict pivot query',
            query: `"${searchTerm}" ${customPivot}`,
            googleUrl: `https://www.google.com/search?q=${encodeURIComponent(
              `"${searchTerm}" ${customPivot}`
            )}`,
          },
          ...queries,
        ]
      : queries,
    mode,
  });

  const bingDorks = dorksToExecute.slice(0, mode === 'full' ? 4 : 2);
  const nonGroundingTasks: Array<Promise<GoogleDorkHit[]>> = [
    ...dorksToExecute.slice(0, 2).map((q) => queryDuckDuckGoDork(q.query, q.category)),
    ...bingDorks.map((q) => queryBingRssDork(q.query, q.category)),
    querySourcegraphCode(searchTerm),
    queryGitHubPublicSearch(searchTerm),
    queryStackOverflowSearch(target, targetType),
    queryArchiveOrgSearch(searchTerm),
    queryHackerNews(searchTerm),
    queryRedditPublic(searchTerm),
  ];

  if (targetType === 'phone') {
    const { e164 } = derivePhoneVariants(target);
    if (e164 && e164 !== searchTerm) {
      nonGroundingTasks.push(querySourcegraphCode(e164));
      nonGroundingTasks.push(queryGitHubPublicSearch(e164));
      nonGroundingTasks.push(queryArchiveOrgSearch(e164));
    }
  }

  const activePivotQuery = customPivot || combinedExtraTerms[0];
  if (activePivotQuery && activePivotQuery.length >= 3) {
    const pivotQuery = `"${searchTerm}" ${activePivotQuery.includes(':') || activePivotQuery.includes(' OR ') ? activePivotQuery : `"${activePivotQuery}"`}`;
    nonGroundingTasks.push(
      queryDuckDuckGoDork(pivotQuery, 'Websites & Mentions'),
      queryBingRssDork(pivotQuery, 'Websites & Mentions')
    );
  }

  if (process.env.GOOGLE_CSE_API_KEY && process.env.GOOGLE_CSE_CX) {
    nonGroundingTasks.push(queryGoogleCustomSearch(queries[0].query, queries[0].category));
    if (queries[1]) {
      nonGroundingTasks.push(queryGoogleCustomSearch(queries[1].query, queries[1].category));
    }
  }

  if (domainForWayback && !FREE_MAIL_DOMAINS.has(domainForWayback.toLowerCase())) {
    nonGroundingTasks.push(
      queryWaybackCdx(domainForWayback),
      queryCrtShDork(domainForWayback)
    );
  }

  const [groundingSettled, ...otherSettled] = await Promise.allSettled([
    groundingPromise,
    ...nonGroundingTasks,
  ]);

  const rawHits: GoogleDorkHit[] = [];
  if (groundingSettled.status === 'fulfilled') {
    rawHits.push(...groundingSettled.value.hits);
    if (!groundingSettled.value.active) {
      const idx = enginesQueried.indexOf('Google Search Grounding');
      if (idx >= 0) enginesQueried.splice(idx, 1);
    }
  }

  for (const res of otherSettled) {
    if (res.status === 'fulfilled' && Array.isArray(res.value)) {
      rawHits.push(...res.value);
    }
  }

  // Deduplicate candidates before running live verification pass
  const dedupedRaw = new Map<string, GoogleDorkHit>();
  for (const hit of rawHits) {
    if (!hit.url || !isSafePublicHttpUrl(hit.url)) continue;
    const dom = extractDomain(hit.url);
    if (isBlockedNoiseDomain(dom)) continue;
    const canonical = hit.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    if (!dedupedRaw.has(canonical)) {
      dedupedRaw.set(canonical, hit);
    }
  }

  // Pre-score each candidate against exact target string (and verified extra handles) before live verification
  const candidatesWithPreCheck = Array.from(dedupedRaw.values()).map((hit) => {
    const cleanSnippet = isSyntheticPlaceholderSnippet(hit.snippet) ? '' : hit.snippet;
    const preMatch = matchTextAgainstTarget(
      `${hit.title} ${cleanSnippet}`,
      hit.url,
      target,
      targetType,
      combinedExtraTerms
    );
    return { hit, preMatch };
  });

  // Prioritize candidates likely to confirm (authoritative logs/APIs, pre-matched snippets, and Google Grounding up to cap 72)
  const sortedForVerify = candidatesWithPreCheck
    .sort((a, b) => {
      const isAuth = (src: GoogleDorkHit['sourceEngine']) =>
        src === 'crt.sh Certificate Log' ||
        src === 'Wayback CDX' ||
        src === 'Sourcegraph Code Search' ||
        src === 'GitHub Code Search' ||
        src === 'StackOverflow Search'
          ? 1
          : 0;
      const aAuth = isAuth(a.hit.sourceEngine);
      const bAuth = isAuth(b.hit.sourceEngine);
      if (bAuth !== aAuth) return bAuth - aAuth;
      if (b.preMatch.score !== a.preMatch.score) return b.preMatch.score - a.preMatch.score;
      const isGsg = (src: GoogleDorkHit['sourceEngine']) =>
        src === 'Google Search Grounding' || src === 'Google CSE' ? 1 : 0;
      return isGsg(b.hit.sourceEngine) - isGsg(a.hit.sourceEngine);
    })
    .slice(0, 72);

  // Strict parallel verification pass (live HTTP resolution + HTML/snippet exact verification)
  const verifiedSettled = await Promise.allSettled(
    sortedForVerify.map(({ hit, preMatch }) =>
      resolveRedirectAndVerifyLivePage(
        hit,
        target,
        targetType,
        preMatch,
        combinedExtraTerms
      )
    )
  );

  const verifiedMap = new Map<string, GoogleDorkHit>();
  for (const item of verifiedSettled) {
    if (item.status !== 'fulfilled' || !item.value) continue;
    const hit = item.value;
    if (isBlockedNoiseDomain(hit.domain)) continue;

    // Optional strict pivot operator filtering if user passed custom pivot text
    if (customPivot && !customPivot.includes(':') && !customPivot.includes(' OR ')) {
      const pivotLower = customPivot.toLowerCase();
      const hay = `${hit.title} ${hit.url} ${hit.snippet} ${hit.matchedEvidence || ''}`.toLowerCase();
      if (!hay.includes(pivotLower)) continue;
    }

    const canonical = hit.url.replace(/#.*$/, '').replace(/\/$/, '').toLowerCase();
    const existing = verifiedMap.get(canonical);
    if (
      !existing ||
      (hit.confidenceScore || 0) > (existing.confidenceScore || 0)
    ) {
      verifiedMap.set(canonical, hit);
    }
  }

  const droppedUnverifiedCount = Math.max(
    0,
    dedupedRaw.size - verifiedMap.size
  );

  // Sort: Highest confidence & verified method first, then Files & Documents -> Code -> Archives -> Web
  const categoryRank: Record<DorkResourceCategory, number> = {
    'Files & Documents': 0,
    'Code & Pastes': 1,
    'Archives & Records': 2,
    'Websites & Mentions': 3,
  };

  const hits = Array.from(verifiedMap.values())
    .sort((a, b) => {
      const scoreDiff = (b.confidenceScore || 0) - (a.confidenceScore || 0);
      if (scoreDiff !== 0) return scoreDiff;
      return categoryRank[a.category] - categoryRank[b.category];
    })
    .slice(0, 80);

  return {
    target,
    targetType,
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    variantsUsed,
    enginesQueried,
    queries,
    hits,
    summary: {
      totalHits: hits.length,
      filesAndDocs: hits.filter((h) => h.category === 'Files & Documents').length,
      codeAndPastes: hits.filter((h) => h.category === 'Code & Pastes').length,
      websitesAndMentions: hits.filter((h) => h.category === 'Websites & Mentions')
        .length,
      archivesAndRecords: hits.filter((h) => h.category === 'Archives & Records')
        .length,
      compiledQueries: queries.length,
      droppedUnverifiedCount,
    },
  };
}
