import React, { useState } from 'react';
import {
  Box,
  Code2,
  Database,
  FileCode2,
  GitBranch,
  Globe,
  KeyRound,
  Mail,
  MessageSquare,
  Phone,
  Server,
  ShieldAlert,
  User,
} from 'lucide-react';

interface PlatformMarkProps {
  platform: string;
  domain?: string;
  url?: string;
  size?: 'sm' | 'md';
}

const KNOWN_PLATFORM_DOMAINS: Array<[string, string]> = [
  ['github', 'github.com'],
  ['gitlab', 'gitlab.com'],
  ['npm', 'npmjs.com'],
  ['docker', 'hub.docker.com'],
  ['google', 'google.com'],
  ['gmail', 'gmail.com'],
  ['ghunt', 'google.com'],
  ['gravatar', 'gravatar.com'],
  ['keybase', 'keybase.io'],
  ['dev community', 'dev.to'],
  ['dev.to', 'dev.to'],
  ['hacker news', 'news.ycombinator.com'],
  ['hugging face', 'huggingface.co'],
  ['codeberg', 'codeberg.org'],
  ['lichess', 'lichess.org'],
  ['chess.com', 'chess.com'],
  ['pypi', 'pypi.org'],
  ['reddit', 'reddit.com'],
  ['wordpress', 'wordpress.com'],
  ['openpgp', 'keys.openpgp.org'],
  ['instagram', 'instagram.com'],
  ['snapchat', 'snapchat.com'],
  ['amazon', 'amazon.com'],
  ['quora', 'quora.com'],
  ['canva', 'canva.com'],
  ['adobe', 'adobe.com'],
  ['linkedin', 'linkedin.com'],
  ['dropbox', 'dropbox.com'],
  ['chegg', 'chegg.com'],
  ['dubsmash', 'dubsmash.com'],
  ['myfitnesspal', 'myfitnesspal.com'],
  ['dailymotion', 'dailymotion.com'],
  ['wattpad', 'wattpad.com'],
  ['mathway', 'mathway.com'],
  ['imgur', 'imgur.com'],
  ['edmodo', 'edmodo.com'],
  ['animoto', 'animoto.com'],
  ['zynga', 'zynga.com'],
  ['zomato', 'zomato.com'],
  ['bigbasket', 'bigbasket.com'],
  ['dominos', 'dominos.co.in'],
  ['dunzo', 'dunzo.com'],
  ['upstox', 'upstox.com'],
  ['airindia', 'airindia.com'],
  ['apollo', 'apollo.io'],
  ['twitter', 'x.com'],
  ['facebook', 'facebook.com'],
  ['goodreads', 'goodreads.com'],
  ['microsoft', 'microsoft.com'],
  ['zoho', 'zoho.com'],
  ['typeform', 'typeform.com'],
  ['bitly', 'bitly.com'],
  ['bitbucket', 'bitbucket.org'],
  ['unacademy', 'unacademy.com'],
  ['duolingo', 'duolingo.com'],
  ['wix', 'wix.com'],
  ['patreon', 'patreon.com'],
  ['tumblr', 'tumblr.com'],
  ['spotify', 'spotify.com'],
  ['movieboxpro', 'movieboxpro.app'],
  ['hulu', 'hulu.com'],
  ['nike', 'nike.com'],
  ['clickup', 'clickup.com'],
  ['voxer', 'voxer.com'],
  ['vsco', 'vsco.co'],
  ['typing.com', 'typing.com'],
  ['quizizz', 'quizizz.com'],
  ['w3schools', 'w3schools.com'],
  ['siriusxm', 'siriusxm.com'],
  ['oddle', 'oddle.me'],
  ['jiosaavn', 'jiosaavn.com'],
  ['replit', 'replit.com'],
  ['render', 'render.com'],
  ['crazygames', 'crazygames.com'],
  ['unavatar', 'unavatar.io'],
  ['quillbot', 'quillbot.com'],
  ['plex', 'plex.tv'],
  ['lovable', 'lovable.dev'],
  ['proton', 'proton.me'],
  ['libravatar', 'libravatar.org'],
  ['ubuntu pgp', 'ubuntu.com'],
  ['mailvelope', 'mailvelope.com'],
  ['lastpass', 'lastpass.com'],
  ['plurk', 'plurk.com'],
  ['rambler', 'rambler.ru'],
  ['any.do', 'any.do'],
  ['freelancer', 'freelancer.com'],
  ['mail.ru', 'mail.ru'],
  ['hudsonrock', 'hudsonrock.com'],
  ['x (twitter)', 'x.com'],
  ['vivino', 'vivino.com'],
  ['komoot', 'komoot.com'],
  ['vercel', 'vercel.com'],
  ['netlify', 'netlify.com'],
  ['fly.io', 'fly.io'],
  ['railway', 'railway.app'],
  ['cloudflare pages', 'pages.cloudflare.com'],
  ['glitch', 'glitch.com'],
  ['codepen', 'codepen.io'],
  ['codesandbox', 'codesandbox.io'],
  ['stackblitz', 'stackblitz.com'],
  ['observable', 'observablehq.com'],
  ['hashnode', 'hashnode.com'],
  ['daily.dev', 'daily.dev'],
  ['peerlist', 'peerlist.io'],
  ['leetcode', 'leetcode.com'],
  ['codeforces', 'codeforces.com'],
  ['codechef', 'codechef.com'],
  ['atcoder', 'atcoder.jp'],
  ['hackerrank', 'hackerrank.com'],
  ['exercism', 'exercism.org'],
  ['geeksforgeeks', 'geeksforgeeks.org'],
  ['dagshub', 'dagshub.com'],
  ['weights & biases', 'wandb.ai'],
  ['civitai', 'civitai.com'],
  ['replicate', 'replicate.com'],
  ['sourcehut', 'sr.ht'],
  ['gitee', 'gitee.com'],
  ['launchpad', 'launchpad.net'],
  ['sourceforge', 'sourceforge.net'],
  ['notabug', 'notabug.org'],
  ['crates.io', 'crates.io'],
  ['rubygems', 'rubygems.org'],
  ['packagist', 'packagist.org'],
  ['nuget', 'nuget.org'],
  ['hex.pm', 'hex.pm'],
  ['stackoverflow', 'stackoverflow.com'],
  ['wakatime', 'wakatime.com'],
  ['roblox', 'roblox.com'],
  ['minecraft', 'minecraft.net'],
  ['steam', 'store.steampowered.com'],
  ['itch.io', 'itch.io'],
  ['gamejolt', 'gamejolt.com'],
  ['newgrounds', 'newgrounds.com'],
  ['kongregate', 'kongregate.com'],
  ['speedrun', 'speedrun.com'],
  ['osu!', 'osu.ppy.sh'],
  ['twitch', 'twitch.tv'],
  ['kick', 'kick.com'],
  ['tetr.io', 'ch.tetr.io'],
  ['monkeytype', 'monkeytype.com'],
  ['boardgamegeek', 'boardgamegeek.com'],
  ['scratch', 'scratch.mit.edu'],
  ['modrinth', 'modrinth.com'],
  ['curseforge', 'curseforge.com'],
  ['hackerone', 'hackerone.com'],
  ['bugcrowd', 'bugcrowd.com'],
  ['tryhackme', 'tryhackme.com'],
  ['ctftime', 'ctftime.org'],
  ['root-me', 'root-me.org'],
  ['cryptohack', 'cryptohack.org'],
  ['hackaday', 'hackaday.io'],
  ['codewars', 'codewars.com'],
  ['deviantart', 'deviantart.com'],
  ['artstation', 'artstation.com'],
  ['behance', 'behance.net'],
  ['dribbble', 'dribbble.com'],
  ['unsplash', 'unsplash.com'],
  ['flickr', 'flickr.com'],
  ['sketchfab', 'sketchfab.com'],
  ['giphy', 'giphy.com'],
  ['tenor', 'tenor.com'],
  ['pixabay', 'pixabay.com'],
  ['lottiefiles', 'lottiefiles.com'],
  ['soundcloud', 'soundcloud.com'],
  ['bandcamp', 'bandcamp.com'],
  ['mixcloud', 'mixcloud.com'],
  ['vimeo', 'vimeo.com'],
  ['last.fm', 'last.fm'],
  ['audiomack', 'audiomack.com'],
  ['myanimelist', 'myanimelist.net'],
  ['anilist', 'anilist.co'],
  ['letterboxd', 'letterboxd.com'],
  ['bluesky', 'bsky.app'],
  ['mastodon', 'mastodon.social'],
  ['youtube', 'youtube.com'],
  ['telegram', 't.me'],
  ['tiktok', 'tiktok.com'],
  ['threads', 'threads.net'],
  ['pinterest', 'pinterest.com'],
  ['buymeacoffee', 'buymeacoffee.com'],
  ['ko-fi', 'ko-fi.com'],
  ['gumroad', 'gumroad.com'],
  ['linktree', 'linktr.ee'],
  ['bento.me', 'bento.me'],
  ['carrd', 'carrd.co'],
  ['about.me', 'about.me'],
  ['bio.link', 'bio.link'],
  ['open collective', 'opencollective.com'],
  ['medium', 'medium.com'],
  ['substack', 'substack.com'],
  ['blogger', 'blogger.com'],
  ['archive of our own', 'archiveofourown.org'],
  ['slideshare', 'slideshare.net'],
  ['speakerdeck', 'speakerdeck.com'],
  ['product hunt', 'producthunt.com'],
  ['lobste.rs', 'lobste.rs'],
  ['archive.org', 'archive.org'],
  ['pastebin', 'pastebin.com'],
  ['wikipedia', 'wikipedia.org'],
  ['openstreetmap', 'openstreetmap.org'],
  ['tradingview', 'tradingview.com'],
  ['stocktwits', 'stocktwits.com'],
  ['instructables', 'instructables.com'],
  ['thingiverse', 'thingiverse.com'],
  ['printables', 'printables.com'],
  ['pinboard', 'pinboard.in'],
  ['freecodecamp', 'freecodecamp.org'],
  ['codecademy', 'codecademy.com'],
  ['odysee', 'odysee.com'],
  ['rumble', 'rumble.com'],
  ['fandom', 'fandom.com'],
  ['trakt', 'trakt.tv'],
  ['slashdot', 'slashdot.org'],
  ['habr', 'habr.com'],
  ['disqus', 'disqus.com'],
  ['notion', 'notion.so'],
  ['deno deploy', 'deno.com'],
  ['surge.sh', 'surge.sh'],
  ['koyeb', 'koyeb.com'],
  ['venmo', 'venmo.com'],
  ['cash app', 'cash.app'],
  ['pexels', 'pexels.com'],
  ['flipboard', 'flipboard.com'],
  ['untappd', 'untappd.com'],
  ['minds', 'minds.com'],
  ['orcid', 'orcid.org'],
  ['firefox accounts', 'accounts.firefox.com'],
  ['firebase hosting', 'firebase.google.com'],
  ['heroku', 'heroku.com'],
  ['pythonanywhere', 'pythonanywhere.com'],
  ['gitbook', 'gitbook.com'],
  ['read the docs', 'readthedocs.org'],
  ['neocities', 'neocities.org'],
  ['gitea', 'gitea.com'],
  ['framagit', 'framagit.org'],
  ['arch linux aur', 'aur.archlinux.org'],
  ['metacpan', 'metacpan.org'],
  ['snapcraft', 'snapcraft.io'],
  ['terraform', 'registry.terraform.io'],
  ['artifacthub', 'artifacthub.io'],
  ['drupal', 'drupal.org'],
  ['figma', 'figma.com'],
  ['anaconda', 'anaconda.org'],
  ['clojars', 'clojars.org'],
  ['cocoapods', 'cocoapods.org'],
  ['pub.dev', 'pub.dev'],
  ['ollama', 'ollama.com'],
  ['poe', 'poe.com'],
  ['flowgpt', 'flowgpt.com'],
  ['fedora', 'fedoraproject.org'],
  ['debian salsa', 'salsa.debian.org'],
  ['gnome', 'gitlab.gnome.org'],
  ['kde invent', 'invent.kde.org'],
  ['disroot', 'git.disroot.org'],
  ['0xacab', '0xacab.org'],
  ['topcoder', 'topcoder.com'],
  ['spoj', 'spoj.com'],
  ['kattis', 'open.kattis.com'],
  ['dmoj', 'dmoj.ca'],
  ['codingame', 'codingame.com'],
  ['project euler', 'projecteuler.net'],
  ['devpost', 'devpost.com'],
  ['hackster', 'hackster.io'],
  ['hackthebox', 'hackthebox.com'],
  ['intigriti', 'intigriti.com'],
  ['yeswehack', 'yeswehack.com'],
  ['immunefi', 'immunefi.com'],
  ['pentesterlab', 'pentesterlab.com'],
  ['mozilla add-ons', 'addons.mozilla.org'],
  ['weblate', 'weblate.org'],
  ['crowdin', 'crowdin.com'],
  ['transifex', 'transifex.com'],
  ['superuser', 'superuser.com'],
  ['askubuntu', 'askubuntu.com'],
  ['serverfault', 'serverfault.com'],
  ['stackexchange', 'stackexchange.com'],
  ['kahoot', 'kahoot.com'],
  ['quizlet', 'quizlet.com'],
  ['khan academy', 'khanacademy.org'],
  ['coursera', 'coursera.org'],
  ['udemy', 'udemy.com'],
  ['edx', 'edx.org'],
  ['skillshare', 'skillshare.com'],
  ['brilliant', 'brilliant.org'],
  ['memrise', 'memrise.com'],
  ['sololearn', 'sololearn.com'],
  ['poki', 'poki.com'],
  ['armor games', 'armorgames.com'],
  ['miniclip', 'miniclip.com'],
  ['psnprofiles', 'psnprofiles.com'],
  ['xboxgamertag', 'xboxgamertag.com'],
  ['fortnitetracker', 'fortnitetracker.com'],
  ['op.gg', 'op.gg'],
  ['faceit', 'faceit.com'],
  ['liquipedia', 'liquipedia.net'],
  ['nexus mods', 'nexusmods.com'],
  ['vrchat', 'vrchat.com'],
  ['steamladder', 'steamladder.com'],
  ['retroachievements', 'retroachievements.org'],
  ['trackmania', 'trackmania.io'],
  ['kitsu', 'kitsu.app'],
  ['shikimori', 'shikimori.one'],
  ['audius', 'audius.co'],
  ['discogs', 'discogs.com'],
  ['anime-planet', 'anime-planet.com'],
  ['mydramalist', 'mydramalist.com'],
  ['storygraph', 'thestorygraph.com'],
  ['librarything', 'librarything.com'],
  ['royal road', 'royalroad.com'],
  ['scribble hub', 'scribblehub.com'],
  ['webnovel', 'webnovel.com'],
  ['tmdb', 'themoviedb.org'],
  ['genius', 'genius.com'],
  ['rateyourmusic', 'rateyourmusic.com'],
  ['musescore', 'musescore.com'],
  ['bandlab', 'bandlab.com'],
  ['reverbnation', 'reverbnation.com'],
  ['freesound', 'freesound.org'],
  ['promodj', 'promodj.com'],
  ['hearthis', 'hearthis.at'],
  ['500px', '500px.com'],
  ['polywork', 'polywork.com'],
  ['read.cv', 'read.cv'],
  ['layers.to', 'layers.to'],
  ['youpic', 'youpic.com'],
  ['contently', 'contently.com'],
  ['clippings.me', 'clippings.me'],
  ['crevado', 'crevado.com'],
  ['coroflot', 'coroflot.com'],
  ['carbonmade', 'carbonmade.com'],
  ['playcanvas', 'playcanvas.com'],
  ['fosstodon', 'fosstodon.org'],
  ['infosec.exchange', 'infosec.exchange'],
  ['hachyderm', 'hachyderm.io'],
  ['techhub', 'techhub.social'],
  ['mstdn.social', 'mstdn.social'],
  ['mas.to', 'mas.to'],
  ['chaos.social', 'chaos.social'],
  ['ioc.exchange', 'ioc.exchange'],
  ['defcon.social', 'defcon.social'],
  ['kolektiva', 'kolektiva.social'],
  ['universeodon', 'universeodon.com'],
  ['sfba.social', 'sfba.social'],
  ['fediscience', 'fediscience.org'],
  ['vivaldi', 'vivaldi.net'],
  ['lemmy.world', 'lemmy.world'],
  ['lemmy.ml', 'lemmy.ml'],
  ['programming.dev', 'programming.dev'],
  ['sh.itjust.works', 'sh.itjust.works'],
  ['beehaw', 'beehaw.org'],
  ['feddit.org', 'feddit.org'],
  ['sopuli.xyz', 'sopuli.xyz'],
  ['lemm.ee', 'lemm.ee'],
  ['wikimedia', 'wikimedia.org'],
  ['wikidata', 'wikidata.org'],
  ['wikibooks', 'wikibooks.org'],
  ['wikiversity', 'wikiversity.org'],
  ['wikisource', 'wikisource.org'],
  ['wiktionary', 'wiktionary.org'],
  ['wikinews', 'wikinews.org'],
  ['wikivoyage', 'wikivoyage.org'],
  ['micro.blog', 'micro.blog'],
  ['bear blog', 'bearblog.dev'],
  ['write.as', 'write.as'],
  ['beacons', 'beacons.ai'],
  ['xda', 'xdaforums.com'],
  ['9gag', '9gag.com'],
  ['imgflip', 'imgflip.com'],
  ['vero', 'vero.co'],
  ['gab', 'gab.com'],
  ['bitcointalk', 'bitcointalk.org'],
  ['opensea', 'opensea.io'],
  ['warpcast', 'warpcast.com'],
  ['strava', 'strava.com'],
  ['alltrails', 'alltrails.com'],
  ['komoot', 'komoot.com'],
  ['couchsurfing', 'couchsurfing.com'],
  ['vivino', 'vivino.com'],
  ['tripadvisor', 'tripadvisor.com'],
  ['poshmark', 'poshmark.com'],
  ['depop', 'depop.com'],
  ['etsy', 'etsy.com'],
  ['fiverr', 'fiverr.com'],
  ['paypal', 'paypal.com'],
  ['trello', 'trello.com'],
  ['calendly', 'calendly.com'],
  ['webflow', 'webflow.com'],
  ['framer', 'framer.com'],
  ['samsung', 'samsung.com'],
  ['shopify', 'shopify.com'],
  ['beehiiv', 'beehiiv.com'],
  ['atlassian', 'atlassian.com'],
  ['ebay', 'ebay.com'],
];

export function resolveSiteDomain(
  platform: string,
  domain?: string,
  url?: string
): string | null {
  if (domain && domain.includes('.')) {
    return domain.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0].toLowerCase();
  }
  if (url) {
    try {
      const host = new URL(url).hostname.replace(/^www\./i, '').toLowerCase();
      if (host && host.includes('.')) return host;
    } catch {
      // ignore invalid URL
    }
  }
  const low = platform.toLowerCase();
  for (const [needle, host] of KNOWN_PLATFORM_DOMAINS) {
    if (low.includes(needle)) return host;
  }
  const domainMatch = low.match(/([a-z0-9-]+\.[a-z]{2,}(?:\.[a-z]{2,})?)/);
  if (domainMatch && !low.includes('e.164') && !low.includes('ip node')) {
    return domainMatch[1];
  }
  return null;
}

export function PlatformMark({
  platform,
  domain,
  url,
  size = 'md',
}: PlatformMarkProps) {
  const [faviconErr, setFaviconErr] = useState(false);
  const low = platform.toLowerCase();
  const resolvedDomain = resolveSiteDomain(platform, domain, url);

  let Icon: React.ComponentType<{ className?: string }> = Globe;
  let accent = 'bg-slate-50 text-slate-700 border-slate-200/80';

  if (low.includes('github')) {
    Icon = GitBranch;
    accent = 'bg-slate-900 text-white border-slate-900';
  } else if (low.includes('gitlab')) {
    Icon = Code2;
    accent = 'bg-orange-50 text-orange-600 border-orange-200/70';
  } else if (low.includes('npm')) {
    Icon = Box;
    accent = 'bg-rose-50 text-rose-600 border-rose-200/70';
  } else if (low.includes('docker')) {
    Icon = Server;
    accent = 'bg-blue-50 text-blue-600 border-blue-200/70';
  } else if (low.includes('google') || low.includes('gmail') || low.includes('ghunt')) {
    Icon = Mail;
    accent = 'bg-blue-50 text-blue-600 border-blue-200/70';
  } else if (low.includes('gravatar')) {
    Icon = User;
    accent = 'bg-indigo-50 text-indigo-600 border-indigo-200/70';
  } else if (low.includes('keybase')) {
    Icon = KeyRound;
    accent = 'bg-amber-50 text-amber-600 border-amber-200/70';
  } else if (low.includes('reddit') || low.includes('hacker')) {
    Icon = MessageSquare;
    accent = 'bg-violet-50 text-violet-600 border-violet-200/70';
  } else if (low.includes('dev') || low.includes('pypi') || low.includes('replit') || low.includes('hugging')) {
    Icon = FileCode2;
    accent = 'bg-slate-100 text-slate-800 border-slate-200';
  } else if (low.includes('domain') || low.includes('mail domain') || low.includes('ip')) {
    Icon = Server;
    accent = 'bg-blue-50 text-blue-600 border-blue-200/70';
  } else if (low.includes('telecom') || low.includes('phone') || low.includes('ignorant')) {
    Icon = Phone;
    accent = 'bg-emerald-50 text-emerald-600 border-emerald-200/70';
  } else if (low.includes('breach') || low.includes('leak')) {
    Icon = ShieldAlert;
    accent = 'bg-rose-50 text-rose-600 border-rose-200/70';
  } else {
    Icon = Database;
  }

  const boxClass = size === 'sm' ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-xl';
  const imgClass = size === 'sm' ? 'w-4.5 h-4.5' : 'w-5 h-5';
  const iconClass = size === 'sm' ? 'w-4 h-4' : 'w-[18px] h-[18px]';

  if (resolvedDomain && !faviconErr && !low.includes('phoneinfoga')) {
    return (
      <span
        className={`${boxClass} bg-white border border-slate-200/90 shadow-2xs flex items-center justify-center shrink-0 overflow-hidden`}
      >
        <img
          src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(
            resolvedDomain
          )}&sz=64`}
          alt={`${platform} icon`}
          referrerPolicy="no-referrer"
          onError={() => setFaviconErr(true)}
          className={`${imgClass} object-contain rounded-sm`}
        />
      </span>
    );
  }

  return (
    <span
      className={`${boxClass} border flex items-center justify-center shrink-0 ${accent}`}
    >
      <Icon className={iconClass} />
    </span>
  );
}
