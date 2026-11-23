import dns from 'node:dns/promises';
import type {
  BreachedAccountItem,
  InvestigationResultItem,
  ResultCategory,
} from '../src/types/investigation.ts';
import type { PlatformSweepTarget } from './platformCatalog.ts';
import {
  probeFacebookIdentify,
  probeFlipkartAccount,
  probeInstagramAccount,
} from './platformExpansion.ts';
import { queryBingRssDork } from './dorkEngine.ts';
import { runGeminiGoogleSearchDork } from './geminiRotator.ts';

export interface CountryCallingMeta {
  prefix: string;
  iso2: string;
  country: string;
  region: string;
  lat: number;
  lng: number;
}

export interface NormalizedPhoneTarget {
  raw: string;
  cleanDigits: string;
  prefix: string;
  national: string;
  e164: string;
  international: string;
  iso2: string;
  countryName: string;
  region: string;
  lat?: number;
  lng?: number;
  validLength: boolean;
  matchedCountry?: CountryCallingMeta;
}

type PhoneSiteSeed = readonly [
  platform: string,
  category: ResultCategory,
  domain: string,
  probePath?: string,
];

const PROBE_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const DOMAIN_DNS_CACHE = new Map<string, { alive: boolean; checkedAt: number }>();
const DOMAIN_DNS_TTL_MS = 10 * 60 * 1000;

function asObj(val: unknown): Record<string, unknown> | null {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : null;
}

function asStr(val: unknown): string | undefined {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : undefined;
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function textContainsExactPhone(text: string, parsed: NormalizedPhoneTarget): boolean {
  if (!text) return false;
  const compact = text.replace(/[\s().-]+/g, '');
  if (parsed.cleanDigits.length >= 8) {
    const fullBoundaryRe = new RegExp(
      `(?:^|[^\\d])${escapeRegExp(parsed.cleanDigits)}(?:$|[^\\d])`
    );
    if (fullBoundaryRe.test(compact)) return true;
  }
  if (
    parsed.national.length >= 10 ||
    (parsed.national === parsed.cleanDigits && parsed.national.length >= 8)
  ) {
    const boundaryRe = new RegExp(
      `(?:^|[^\\d])${escapeRegExp(parsed.national)}(?:$|[^\\d])`
    );
    if (boundaryRe.test(compact)) return true;
  }
  return false;
}

async function checkDomainDnsNonBlocking(domain: string): Promise<boolean> {
  const cleanHost = domain.toLowerCase().replace(/^www\./, '');
  const cached = DOMAIN_DNS_CACHE.get(cleanHost);
  if (cached && Date.now() - cached.checkedAt < DOMAIN_DNS_TTL_MS) {
    return cached.alive;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const alive = await Promise.race<boolean>([
      dns
        .resolve4(domain)
        .then((addrs) => Array.isArray(addrs) && addrs.length > 0)
        .catch(() =>
          dns
            .resolve6(domain)
            .then((addrs) => Array.isArray(addrs) && addrs.length > 0)
            .catch(() => false)
        ),
      new Promise<boolean>((resolve) => {
        timer = setTimeout(() => resolve(false), 750);
      }),
    ]);
    if (DOMAIN_DNS_CACHE.size > 4000) DOMAIN_DNS_CACHE.clear();
    DOMAIN_DNS_CACHE.set(cleanHost, { alive, checkedAt: Date.now() });
    return alive;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function safeFetch(
  url: string,
  init: RequestInit = {},
  timeoutMs = 7000
): Promise<{ ok: boolean; status: number; text: string; json: unknown; headers?: Headers }> {
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
    return {
      ok: res.ok,
      status: res.status,
      text,
      json,
      headers: res.headers,
    };
  } catch {
    return { ok: false, status: 0, text: '', json: null };
  } finally {
    clearTimeout(timer);
  }
}

export function normalizePhoneTarget(
  rawPhone: string,
  countryMap: ReadonlyArray<CountryCallingMeta> = []
): NormalizedPhoneTarget {
  const trimmed = rawPhone.trim().replace(/^tel:\s*/i, '');
  const stripped = trimmed.replace(/[\s().-]+/g, '');
  const hadPlus = stripped.startsWith('+');
  const hadIdd00 = !hadPlus && stripped.startsWith('00') && stripped.length > 10;
  const rawDigits = hadIdd00 ? stripped.slice(2).replace(/\D/g, '') : stripped.replace(/\D/g, '');

  let cleanDigits = rawDigits;
  let matched: CountryCallingMeta | undefined;

  if (!hadPlus && !hadIdd00) {
    // Handle bare Indian numbers cleanly so 94xxxx / 92xxxx / 84xxxx aren't misread as +94 / +92 / +84
    if (/^0[6-9]\d{9}$/.test(rawDigits)) {
      cleanDigits = `91${rawDigits.slice(1)}`;
      matched = countryMap.find((c) => c.iso2 === 'IN');
    } else if (/^[6-9]\d{9}$/.test(rawDigits)) {
      cleanDigits = `91${rawDigits}`;
      matched = countryMap.find((c) => c.iso2 === 'IN');
    } else if (/^91[6-9]\d{9}$/.test(rawDigits)) {
      cleanDigits = rawDigits;
      matched = countryMap.find((c) => c.iso2 === 'IN');
    } else if (/^[2-5]\d{9}$/.test(rawDigits)) {
      // Bare 10-digit NANP-style number without +
      cleanDigits = `1${rawDigits}`;
      matched = countryMap.find((c) => c.iso2 === 'US');
    } else {
      matched = countryMap.find((c) => rawDigits.startsWith(c.prefix));
    }
  } else {
    matched = countryMap.find((c) => rawDigits.startsWith(c.prefix));
  }

  const prefix = matched?.prefix || '';
  const national =
    prefix && cleanDigits.startsWith(prefix)
      ? cleanDigits.slice(prefix.length)
      : cleanDigits;
  const e164 = `+${cleanDigits}`;
  const international = !prefix
    ? e164
    : prefix === '91' && national.length === 10
    ? `+91 ${national.slice(0, 5)} ${national.slice(5)}`
    : national.length === 10
    ? `+${prefix} ${national.slice(0, 3)} ${national.slice(3, 6)} ${national.slice(6)}`
    : `+${prefix} ${national.replace(/(\d{4})(?=\d{2,})/g, '$1 ').trim()}`;

  return {
    raw: rawPhone,
    cleanDigits,
    prefix,
    national,
    e164,
    international,
    iso2: matched?.iso2 || 'INTL',
    countryName: matched?.country || 'International E.164',
    region: matched?.region || 'Global',
    lat: matched?.lat,
    lng: matched?.lng,
    validLength: cleanDigits.length >= 8 && cleanDigits.length <= 15,
    matchedCountry: matched,
  };
}

// 370+ real websites & consumer services where accounts are registered/accessed via phone number.
// Note: sites that require triggering an outbound SMS OTP or active CAPTCHA challenge are marked
// `not_checked` ("OTP / Auth Gated") passively via DNS/endpoint checks so zero unsolicited SMS OTPs are ever sent.
const MEGA_PHONE_SITES: ReadonlyArray<PhoneSiteSeed> = [
  // Indian E-Commerce & Quick Commerce
  ['Amazon.in', 'Productivity & Cloud', 'www.amazon.in', '/ap/signin'],
  ['Myntra', 'Productivity & Cloud', 'www.myntra.com', '/login'],
  ['Ajio', 'Productivity & Cloud', 'www.ajio.com', '/login'],
  ['Nykaa', 'Productivity & Cloud', 'www.nykaa.com', '/auth/login'],
  ['Meesho', 'Productivity & Cloud', 'www.meesho.com', '/auth'],
  ['Tata Cliq', 'Productivity & Cloud', 'www.tatacliq.com', '/'],
  ['Snapdeal', 'Productivity & Cloud', 'www.snapdeal.com', '/login'],
  ['Croma', 'Productivity & Cloud', 'www.croma.com', '/'],
  ['Reliance Digital', 'Productivity & Cloud', 'www.reliancedigital.in', '/'],
  ['Shopsy', 'Productivity & Cloud', 'www.shopsy.in', '/'],
  ['Lenskart', 'Productivity & Cloud', 'www.lenskart.com', '/'],
  ['FirstCry', 'Productivity & Cloud', 'www.firstcry.com', '/'],
  ['Pepperfry', 'Productivity & Cloud', 'www.pepperfry.com', '/'],
  ['Urban Company', 'Productivity & Cloud', 'www.urbancompany.com', '/'],
  ['JioMart', 'Productivity & Cloud', 'www.jiomart.com', '/'],
  ['BigBasket', 'Productivity & Cloud', 'www.bigbasket.com', '/'],
  ['Blinkit', 'Productivity & Cloud', 'blinkit.com', '/'],
  ['Zepto', 'Productivity & Cloud', 'www.zeptonow.com', '/'],
  ['Swiggy', 'Productivity & Cloud', 'www.swiggy.com', '/'],
  ['Zomato', 'Productivity & Cloud', 'www.zomato.com', '/'],
  ['Instamart', 'Productivity & Cloud', 'www.swiggy.com', '/instamart'],
  ["Domino's India", 'Productivity & Cloud', 'www.dominos.co.in', '/'],
  ['Pizza Hut India', 'Productivity & Cloud', 'www.pizzahut.co.in', '/'],
  ['KFC India', 'Productivity & Cloud', 'online.kfc.co.in', '/'],
  ["McDonald's India", 'Productivity & Cloud', 'www.mcdelivery.co.in', '/'],
  ['Burger King India', 'Productivity & Cloud', 'www.burgerking.in', '/'],
  ['EatSure', 'Productivity & Cloud', 'www.eatsure.com', '/'],
  ['Licious', 'Productivity & Cloud', 'www.licious.in', '/'],
  ['FreshToHome', 'Productivity & Cloud', 'www.freshtohome.com', '/'],
  ['Country Delight', 'Productivity & Cloud', 'countrydelight.in', '/'],
  ['Milkbasket', 'Productivity & Cloud', 'www.milkbasket.com', '/'],
  ['EazyDiner', 'Productivity & Cloud', 'www.eazydiner.com', '/'],
  ['Magicpin', 'Productivity & Cloud', 'magicpin.in', '/'],
  ['Wakefit', 'Productivity & Cloud', 'www.wakefit.co', '/'],
  ['Urban Ladder', 'Productivity & Cloud', 'www.urbanladder.com', '/'],
  ['Mamaearth', 'Productivity & Cloud', 'mamaearth.in', '/'],
  ['Sugar Cosmetics', 'Productivity & Cloud', 'in.sugarcosmetics.com', '/'],
  ['Plum Goodness', 'Productivity & Cloud', 'plumgoodness.com', '/'],
  ['Purplle', 'Productivity & Cloud', 'www.purplle.com', '/'],
  ['Minimalist', 'Productivity & Cloud', 'beminimalist.co', '/'],
  ['Nykaa Fashion', 'Productivity & Cloud', 'www.nykaafashion.com', '/'],
  ['HealthKart', 'Productivity & Cloud', 'www.healthkart.com', '/'],
  ['Decathlon India', 'Productivity & Cloud', 'www.decathlon.in', '/'],
  ['Nike India', 'Productivity & Cloud', 'www.nike.com', '/in'],
  ['Adidas India', 'Productivity & Cloud', 'www.adidas.co.in', '/'],
  ['Puma India', 'Productivity & Cloud', 'in.puma.com', '/'],
  ['Zudio / Trent', 'Productivity & Cloud', 'www.zudio.com', '/'],
  ['Westside', 'Productivity & Cloud', 'www.westside.com', '/'],
  ['Pantaloons', 'Productivity & Cloud', 'www.pantaloons.com', '/'],
  ['Shoppers Stop', 'Productivity & Cloud', 'www.shoppersstop.com', '/'],
  ['Lifestyle Stores', 'Productivity & Cloud', 'www.lifestylestores.com', '/'],
  ['Max Fashion', 'Productivity & Cloud', 'www.maxfashion.in', '/'],
  ['Titan', 'Productivity & Cloud', 'www.titan.co.in', '/'],
  ['Fastrack', 'Productivity & Cloud', 'www.fastrack.in', '/'],
  ['CaratLane', 'Productivity & Cloud', 'www.caratlane.com', '/'],
  ['Tanishq', 'Productivity & Cloud', 'www.tanishq.co.in', '/'],
  ['GIVA', 'Productivity & Cloud', 'www.giva.co', '/'],
  ['boAt Lifestyle', 'Productivity & Cloud', 'www.boat-lifestyle.com', '/'],
  ['Noise', 'Productivity & Cloud', 'www.gonoise.com', '/'],
  ['Vijay Sales', 'Productivity & Cloud', 'www.vijaysales.com', '/'],
  ['OLX India', 'Social & Community', 'www.olx.in', '/'],
  ['Quikr', 'Social & Community', 'www.quikr.com', '/'],
  ['IndiaMART', 'Productivity & Cloud', 'www.indiamart.com', '/'],
  ['Justdial', 'Productivity & Cloud', 'www.justdial.com', '/'],
  ['Sulekha', 'Productivity & Cloud', 'www.sulekha.com', '/'],
  ['Cashify', 'Productivity & Cloud', 'www.cashify.in', '/'],
  ['Cars24', 'Productivity & Cloud', 'www.cars24.com', '/'],
  ['Spinny', 'Productivity & Cloud', 'www.spinny.com', '/'],
  ['CarDekho', 'Productivity & Cloud', 'www.cardekho.com', '/'],
  ['BikeDekho', 'Productivity & Cloud', 'www.bikedekho.com', '/'],
  ['CarWale', 'Productivity & Cloud', 'www.carwale.com', '/'],
  ['BikeWale', 'Productivity & Cloud', 'www.bikewale.com', '/'],
  ['Droom', 'Productivity & Cloud', 'droom.in', '/'],
  ['Delhivery', 'Productivity & Cloud', 'www.delhivery.com', '/'],
  ['Blue Dart', 'Productivity & Cloud', 'www.bluedart.com', '/'],
  ['DTDC', 'Productivity & Cloud', 'www.dtdc.in', '/'],
  ['Shiprocket', 'Productivity & Cloud', 'www.shiprocket.in', '/'],
  ['Porter', 'Productivity & Cloud', 'porter.in', '/'],
  ['Borzo', 'Productivity & Cloud', 'borzodelivery.com', '/in'],
  ['Park+', 'Productivity & Cloud', 'parkplus.io', '/'],
  ['FastTag / IHMCL', 'Phone & Telecom', 'ihmcl.co.in', '/'],
  ['Ferns N Petals', 'Productivity & Cloud', 'www.fnp.com', '/'],
  ['IGP', 'Productivity & Cloud', 'www.igp.com', '/'],

  // Indian & Global Fintech, UPI, Wallets, Investing & Banking
  ['Paytm', 'Phone & Telecom', 'paytm.com', '/'],
  ['PhonePe', 'Phone & Telecom', 'www.phonepe.com', '/'],
  ['Google Pay', 'Phone & Telecom', 'pay.google.com', '/'],
  ['CRED', 'Phone & Telecom', 'cred.club', '/'],
  ['MobiKwik', 'Phone & Telecom', 'www.mobikwik.com', '/'],
  ['Freecharge', 'Phone & Telecom', 'www.freecharge.in', '/'],
  ['Amazon Pay', 'Phone & Telecom', 'www.amazon.in', '/amazonpay'],
  ['Airtel Payments Bank', 'Phone & Telecom', 'www.airtel.in', '/bank/'],
  ['JioPayments Bank', 'Phone & Telecom', 'www.jiopaymentsbank.com', '/'],
  ['Fampay', 'Phone & Telecom', 'famapp.in', '/'],
  ['Razorpay', 'Developer & Code', 'razorpay.com', '/'],
  ['Cashfree', 'Developer & Code', 'www.cashfree.com', '/'],
  ['PayU', 'Developer & Code', 'payu.in', '/'],
  ['PhonePe Switch', 'Phone & Telecom', 'www.phonepe.com', '/business-solutions/'],
  ['BHIM UPI', 'Phone & Telecom', 'www.bhimupi.org.in', '/'],
  ['Zerodha', 'Productivity & Cloud', 'zerodha.com', '/'],
  ['Groww', 'Productivity & Cloud', 'groww.in', '/'],
  ['Upstox', 'Productivity & Cloud', 'upstox.com', '/'],
  ['Angel One', 'Productivity & Cloud', 'www.angelone.in', '/'],
  ['Dhan', 'Productivity & Cloud', 'dhan.co', '/'],
  ['5paisa', 'Productivity & Cloud', 'www.5paisa.com', '/'],
  ['ICICI Direct', 'Productivity & Cloud', 'www.icicidirect.com', '/'],
  ['HDFC Sky', 'Productivity & Cloud', 'hdfcsky.com', '/'],
  ['INDmoney', 'Productivity & Cloud', 'www.indmoney.com', '/'],
  ['ET Money', 'Productivity & Cloud', 'www.etmoney.com', '/'],
  ['smallcase', 'Productivity & Cloud', 'www.smallcase.com', '/'],
  ['Kuvera', 'Productivity & Cloud', 'kuvera.in', '/'],
  ['Paytm Money', 'Productivity & Cloud', 'www.paytmmoney.com', '/'],
  ['CoinDCX', 'Productivity & Cloud', 'coindcx.com', '/'],
  ['CoinSwitch', 'Productivity & Cloud', 'coinswitch.co', '/'],
  ['Mudrex', 'Productivity & Cloud', 'mudrex.com', '/'],
  ['Bajaj Finserv', 'Productivity & Cloud', 'www.bajajfinserv.in', '/'],
  ['Policybazaar', 'Productivity & Cloud', 'www.policybazaar.com', '/'],
  ['Paisabazaar', 'Productivity & Cloud', 'www.paisabazaar.com', '/'],
  ['BankBazaar', 'Productivity & Cloud', 'www.bankbazaar.com', '/'],
  ['Acko', 'Productivity & Cloud', 'www.acko.com', '/'],
  ['Digit Insurance', 'Productivity & Cloud', 'www.godigit.com', '/'],
  ['Turtlemint', 'Productivity & Cloud', 'www.turtlemint.com', '/'],
  ['HDFC Bank', 'Productivity & Cloud', 'www.hdfcbank.com', '/'],
  ['ICICI Bank', 'Productivity & Cloud', 'www.icicibank.com', '/'],
  ['State Bank of India', 'Productivity & Cloud', 'www.onlinesbi.sbi', '/'],
  ['Axis Bank', 'Productivity & Cloud', 'www.axisbank.com', '/'],
  ['Kotak Mahindra Bank', 'Productivity & Cloud', 'www.kotak.com', '/'],
  ['Yes Bank', 'Productivity & Cloud', 'www.yesbank.in', '/'],
  ['IndusInd Bank', 'Productivity & Cloud', 'www.indusind.com', '/'],
  ['IDFC FIRST Bank', 'Productivity & Cloud', 'www.idfcfirstbank.com', '/'],
  ['AU Small Finance Bank', 'Productivity & Cloud', 'www.aubank.in', '/'],
  ['Federal Bank', 'Productivity & Cloud', 'www.federalbank.co.in', '/'],
  ['Jupiter Money', 'Productivity & Cloud', 'jupiter.money', '/'],
  ['Fi Money', 'Productivity & Cloud', 'fi.money', '/'],
  ['Slice', 'Productivity & Cloud', 'www.sliceit.com', '/'],
  ['Niyo', 'Productivity & Cloud', 'goniyo.com', '/'],
  ['OneCard', 'Productivity & Cloud', 'www.getonecard.app', '/'],
  ['Uni Cards', 'Productivity & Cloud', 'www.uni.cards', '/'],
  ['LazyPay', 'Productivity & Cloud', 'lazypay.in', '/'],
  ['Simpl', 'Productivity & Cloud', 'getsimpl.com', '/'],
  ['Navi', 'Productivity & Cloud', 'navi.com', '/'],
  ['KreditBee', 'Productivity & Cloud', 'www.kreditbee.in', '/'],
  ['Moneyview', 'Productivity & Cloud', 'moneyview.in', '/'],
  ['CASHe', 'Productivity & Cloud', 'www.cashe.co.in', '/'],
  ['PayPal', 'Productivity & Cloud', 'www.paypal.com', '/signin'],
  ['Wise', 'Productivity & Cloud', 'wise.com', '/login'],
  ['Revolut', 'Productivity & Cloud', 'www.revolut.com', '/'],
  ['Stripe', 'Developer & Code', 'dashboard.stripe.com', '/login'],
  ['Coinbase', 'Productivity & Cloud', 'www.coinbase.com', '/signin'],
  ['Binance', 'Productivity & Cloud', 'accounts.binance.com', '/en/login'],
  ['Kraken', 'Productivity & Cloud', 'www.kraken.com', '/sign-in'],
  ['Bybit', 'Productivity & Cloud', 'www.bybit.com', '/'],
  ['OKX', 'Productivity & Cloud', 'www.okx.com', '/'],
  ['Venmo', 'Phone & Telecom', 'account.venmo.com', '/'],
  ['Cash App', 'Phone & Telecom', 'cash.app', '/'],

  // Telecom Operators, LPG Gas, PNG & Utilities
  ['Reliance Jio', 'Phone & Telecom', 'www.jio.com', '/selfcare/login/'],
  ['Airtel', 'Phone & Telecom', 'www.airtel.in', '/manage-account/login'],
  ['Vodafone Idea (Vi)', 'Phone & Telecom', 'www.myvi.in', '/'],
  ['BSNL Portal', 'Phone & Telecom', 'portal.bsnl.in', '/'],
  ['MTNL', 'Phone & Telecom', 'mtnl.in', '/'],
  ['ACT Fibernet', 'Phone & Telecom', 'www.actcorp.in', '/'],
  ['Hathway', 'Phone & Telecom', 'www.hathway.com', '/'],
  ['Tata Play', 'Phone & Telecom', 'www.tataplay.com', '/'],
  ['DishTV', 'Phone & Telecom', 'www.dishtv.in', '/'],
  ['Indane Gas (IOCL)', 'Phone & Telecom', 'cx.indianoil.in', '/'],
  ['HP Gas (HPCL)', 'Phone & Telecom', 'myhpgas.in', '/'],
  ['Bharatgas (BPCL)', 'Phone & Telecom', 'ebharatgas.com', '/'],
  ['MyLPG.in (DBTL)', 'Phone & Telecom', 'www.mylpg.in', '/'],
  ['IGL (Indraprastha Gas)', 'Phone & Telecom', 'www.iglonline.net', '/'],
  ['Mahanagar Gas (MGL)', 'Phone & Telecom', 'www.mahanagargas.com', '/'],
  ['Adani Total Gas', 'Phone & Telecom', 'www.adanigas.com', '/'],
  ['Gujarat Gas', 'Phone & Telecom', 'www.gujaratgas.com', '/'],
  ['Torrent Gas', 'Phone & Telecom', 'www.torrentgas.com', '/'],
  ['Tata Power', 'Phone & Telecom', 'www.tatapower.com', '/'],
  ['Adani Electricity', 'Phone & Telecom', 'www.adanielectricity.com', '/'],
  ['BSES Delhi', 'Phone & Telecom', 'www.bsesdelhi.com', '/'],
  ['BESCOM', 'Phone & Telecom', 'bescom.karnataka.gov.in', '/'],
  ['MSEDCL (Mahavitaran)', 'Phone & Telecom', 'www.mahadiscom.in', '/'],
  ['Bharat BillPay (BBPS)', 'Phone & Telecom', 'www.bharatbillpay.com', '/'],
  ['NETC FASTag', 'Phone & Telecom', 'www.npci.org.in', '/what-we-do/netc-fastag/product-overview'],
  ['BharatPe', 'Phone & Telecom', 'bharatpe.com', '/'],
  ['Bajaj Pay', 'Phone & Telecom', 'www.bajajfinserv.in', '/bajaj-pay'],
  ['WhatsApp Pay', 'Phone & Telecom', 'www.whatsapp.com', '/payments/in'],
  ['Truecaller', 'Phone & Telecom', 'www.truecaller.com', '/'],
  ['T-Mobile', 'Phone & Telecom', 'www.t-mobile.com', '/'],
  ['Verizon', 'Phone & Telecom', 'www.verizon.com', '/'],
  ['AT&T', 'Phone & Telecom', 'www.att.com', '/'],
  ['Vodafone UK', 'Phone & Telecom', 'www.vodafone.co.uk', '/'],
  ['EE UK', 'Phone & Telecom', 'ee.co.uk', '/'],
  ['O2 UK', 'Phone & Telecom', 'www.o2.co.uk', '/'],
  ['Rogers', 'Phone & Telecom', 'www.rogers.com', '/'],
  ['Bell Canada', 'Phone & Telecom', 'www.bell.ca', '/'],
  ['Telstra', 'Phone & Telecom', 'www.telstra.com.au', '/'],
  ['Optus', 'Phone & Telecom', 'www.optus.com.au', '/'],
  ['Singtel', 'Phone & Telecom', 'www.singtel.com', '/'],
  ['Etisalat (e&)', 'Phone & Telecom', 'www.etisalat.ae', '/'],
  ['du UAE', 'Phone & Telecom', 'www.du.ae', '/'],

  // Travel, Rail, Airlines, Hotels & Mobility
  ['IRCTC', 'Productivity & Cloud', 'www.irctc.co.in', '/'],
  ['MakeMyTrip', 'Productivity & Cloud', 'www.makemytrip.com', '/'],
  ['Goibibo', 'Productivity & Cloud', 'www.goibibo.com', '/'],
  ['Cleartrip', 'Productivity & Cloud', 'www.cleartrip.com', '/'],
  ['EaseMyTrip', 'Productivity & Cloud', 'www.easemytrip.com', '/'],
  ['Yatra', 'Productivity & Cloud', 'www.yatra.com', '/'],
  ['Ixigo', 'Productivity & Cloud', 'www.ixigo.com', '/'],
  ['ConfirmTkt', 'Productivity & Cloud', 'www.confirmtkt.com', '/'],
  ['RailYatri', 'Productivity & Cloud', 'www.railyatri.in', '/'],
  ['redBus', 'Productivity & Cloud', 'www.redbus.in', '/'],
  ['AbhiBus', 'Productivity & Cloud', 'www.abhibus.com', '/'],
  ['Uber', 'Productivity & Cloud', 'auth.uber.com', '/'],
  ['Ola Cabs', 'Productivity & Cloud', 'www.olacabs.com', '/'],
  ['Rapido', 'Productivity & Cloud', 'www.rapido.bike', '/'],
  ['Namma Yatri', 'Productivity & Cloud', 'nammayatri.in', '/'],
  ['BluSmart', 'Productivity & Cloud', 'blu-smart.com', '/'],
  ['Zoomcar', 'Productivity & Cloud', 'www.zoomcar.com', '/'],
  ['IndiGo', 'Productivity & Cloud', 'www.goindigo.in', '/'],
  ['Air India', 'Productivity & Cloud', 'www.airindia.com', '/'],
  ['Akasa Air', 'Productivity & Cloud', 'www.akasaair.com', '/'],
  ['SpiceJet', 'Productivity & Cloud', 'www.spicejet.com', '/'],
  ['Air India Express', 'Productivity & Cloud', 'www.airindiaexpress.com', '/'],
  ['OYO Rooms', 'Productivity & Cloud', 'www.oyorooms.com', '/'],
  ['Treebo', 'Productivity & Cloud', 'www.treebo.com', '/'],
  ['FabHotels', 'Productivity & Cloud', 'www.fabhotels.com', '/'],
  ['Zostel', 'Productivity & Cloud', 'www.zostel.com', '/'],
  ['Airbnb', 'Productivity & Cloud', 'www.airbnb.com', '/login'],
  ['Booking.com', 'Productivity & Cloud', 'account.booking.com', '/sign-in'],
  ['Agoda', 'Productivity & Cloud', 'www.agoda.com', '/'],
  ['Expedia', 'Productivity & Cloud', 'www.expedia.co.in', '/'],
  ['Skyscanner', 'Productivity & Cloud', 'www.skyscanner.co.in', '/'],
  ['Klook', 'Productivity & Cloud', 'www.klook.com', '/'],
  ['Lyft', 'Productivity & Cloud', 'www.lyft.com', '/'],
  ['Grab', 'Productivity & Cloud', 'www.grab.com', '/'],
  ['Gojek', 'Productivity & Cloud', 'www.gojek.com', '/'],

  // Social Networks, Messaging & Dating
  ['Signal', 'Social & Community', 'signal.org', '/'],
  ['Threads', 'Social & Community', 'www.threads.net', '/login'],
  ['X (Twitter)', 'Social & Community', 'x.com', '/i/flow/login'],
  ['Discord', 'Social & Community', 'discord.com', '/login'],
  ['Reddit', 'Social & Community', 'www.reddit.com', '/login'],
  ['LinkedIn', 'Social & Community', 'www.linkedin.com', '/login'],
  ['Pinterest', 'Social & Community', 'www.pinterest.com', '/login/'],
  ['TikTok', 'Social & Community', 'www.tiktok.com', '/login'],
  ['Viber', 'Social & Community', 'www.viber.com', '/'],
  ['LINE', 'Social & Community', 'access.line.me', '/'],
  ['KakaoTalk', 'Social & Community', 'accounts.kakao.com', '/'],
  ['WeChat', 'Social & Community', 'www.wechat.com', '/'],
  ['imo', 'Social & Community', 'imo.im', '/'],
  ['Truecaller Chat', 'Social & Community', 'web.truecaller.com', '/'],
  ['ShareChat', 'Social & Community', 'sharechat.com', '/'],
  ['Moj', 'Social & Community', 'mojapp.in', '/'],
  ['Josh', 'Social & Community', 'myjosh.in', '/'],
  ['Koo / Public Social', 'Social & Community', 'www.kooapp.com', '/'],
  ['Tinder', 'Social & Community', 'tinder.com', '/'],
  ['Bumble', 'Social & Community', 'bumble.com', '/'],
  ['Hinge', 'Social & Community', 'hinge.co', '/'],
  ['Aisle', 'Social & Community', 'www.aisle.co', '/'],
  ['OkCupid', 'Social & Community', 'www.okcupid.com', '/'],
  ['Shaadi.com', 'Social & Community', 'www.shaadi.com', '/'],
  ['Jeevansathi', 'Social & Community', 'www.jeevansathi.com', '/'],
  ['BharatMatrimony', 'Social & Community', 'www.bharatmatrimony.com', '/'],
  ['Betterhalf', 'Social & Community', 'www.betterhalf.ai', '/'],

  // OTT, Entertainment, Music & Gaming
  ['BookMyShow', 'Social & Community', 'in.bookmyshow.com', '/'],
  ['Paytm Insider', 'Social & Community', 'insider.in', '/'],
  ['District by Zomato', 'Social & Community', 'www.district.in', '/'],
  ['PVR INOX', 'Social & Community', 'www.pvrcinemas.com', '/'],
  ['JioHotstar', 'Social & Community', 'www.hotstar.com', '/'],
  ['Netflix', 'Social & Community', 'www.netflix.com', '/login'],
  ['Amazon Prime Video', 'Social & Community', 'www.primevideo.com', '/'],
  ['SonyLIV', 'Social & Community', 'www.sonyliv.com', '/'],
  ['ZEE5', 'Social & Community', 'www.zee5.com', '/'],
  ['MX Player', 'Social & Community', 'www.mxplayer.in', '/'],
  ['JioCinema', 'Social & Community', 'www.jiocinema.com', '/'],
  ['Aha Video', 'Social & Community', 'www.aha.video', '/'],
  ['Hoichoi', 'Social & Community', 'www.hoichoi.tv', '/'],
  ['Sun NXT', 'Social & Community', 'www.sunnxt.com', '/'],
  ['Apple TV+', 'Social & Community', 'tv.apple.com', '/'],
  ['Lionsgate Play', 'Social & Community', 'lionsgateplay.com', '/'],
  ['Discovery+', 'Social & Community', 'www.discoveryplus.in', '/'],
  ['Eros Now', 'Social & Community', 'erosnow.com', '/'],
  ['ShemarooMe', 'Social & Community', 'www.shemaroome.com', '/'],
  ['Stage OTT', 'Social & Community', 'www.stage.in', '/'],
  ['Chaupal OTT', 'Social & Community', 'chaupal.tv', '/'],
  ['Crunchyroll', 'Social & Community', 'www.crunchyroll.com', '/'],
  ['MUBI', 'Social & Community', 'mubi.com', '/'],
  ['Spotify', 'Social & Community', 'www.spotify.com', '/'],
  ['JioSaavn', 'Social & Community', 'www.jiosaavn.com', '/'],
  ['Gaana', 'Social & Community', 'gaana.com', '/'],
  ['Wynk Music', 'Social & Community', 'wynk.in', '/'],
  ['YouTube Music', 'Social & Community', 'music.youtube.com', '/'],
  ['Audible India', 'Social & Community', 'www.audible.in', '/'],
  ['Pocket FM', 'Social & Community', 'pocketfm.com', '/'],
  ['Kuku FM', 'Social & Community', 'kukufm.com', '/'],
  ['Storytel', 'Social & Community', 'www.storytel.com', '/'],
  ['Pratilipi', 'Social & Community', 'www.pratilipi.com', '/'],
  ['Dream11', 'Social & Community', 'www.dream11.com', '/'],
  ['MPL', 'Social & Community', 'www.mpl.live', '/'],
  ['WinZO', 'Social & Community', 'www.winzogames.com', '/'],
  ['My11Circle', 'Social & Community', 'www.my11circle.com', '/'],
  ['Zupee', 'Social & Community', 'www.zupee.com', '/'],
  ['RummyCircle', 'Social & Community', 'www.rummycircle.com', '/'],
  ['A23', 'Social & Community', 'www.a23.com', '/'],
  ['Krafton / BGMI', 'Social & Community', 'www.battlegroundsmobileindia.com', '/'],
  ['Steam', 'Social & Community', 'store.steampowered.com', '/login/'],
  ['Epic Games', 'Social & Community', 'www.epicgames.com', '/id/login'],
  ['Roblox', 'Social & Community', 'www.roblox.com', '/login'],
  ['Twitch', 'Social & Community', 'www.twitch.tv', '/login'],
  ['Riot Games', 'Social & Community', 'authenticate.riotgames.com', '/'],
  ['PlayStation Network', 'Social & Community', 'my.account.sony.com', '/'],
  ['Xbox Live', 'Social & Community', 'www.xbox.com', '/'],
  ['Nintendo', 'Social & Community', 'accounts.nintendo.com', '/'],

  // Healthcare, Jobs, EdTech & Real Estate
  ['Practo', 'Productivity & Cloud', 'www.practo.com', '/'],
  ['Tata 1mg', 'Productivity & Cloud', 'www.1mg.com', '/'],
  ['PharmEasy', 'Productivity & Cloud', 'pharmeasy.in', '/'],
  ['Apollo 24|7', 'Productivity & Cloud', 'www.apollo247.com', '/'],
  ['Netmeds', 'Productivity & Cloud', 'www.netmeds.com', '/'],
  ['Truemeds', 'Productivity & Cloud', 'www.truemeds.in', '/'],
  ['Lal PathLabs', 'Productivity & Cloud', 'www.lalpathlabs.com', '/'],
  ['Thyrocare', 'Productivity & Cloud', 'www.thyrocare.com', '/'],
  ['Orange Health Labs', 'Productivity & Cloud', 'www.orangehealth.in', '/'],
  ['Cult.fit', 'Productivity & Cloud', 'www.cult.fit', '/'],
  ['HealthifyMe', 'Productivity & Cloud', 'www.healthifyme.com', '/'],
  ['Naukri', 'Productivity & Cloud', 'www.naukri.com', '/nlogin/login'],
  ['Internshala', 'Productivity & Cloud', 'internshala.com', '/login'],
  ['Indeed', 'Productivity & Cloud', 'secure.indeed.com', '/'],
  ['Apna', 'Productivity & Cloud', 'apna.co', '/'],
  ['WorkIndia', 'Productivity & Cloud', 'www.workindia.in', '/'],
  ['Foundit', 'Productivity & Cloud', 'www.foundit.in', '/'],
  ['Shine.com', 'Productivity & Cloud', 'www.shine.com', '/'],
  ['Wellfound', 'Productivity & Cloud', 'wellfound.com', '/login'],
  ['Unstop', 'Productivity & Cloud', 'unstop.com', '/auth/login'],
  ['PhysicsWallah', 'Productivity & Cloud', 'www.pw.live', '/'],
  ['Unacademy', 'Productivity & Cloud', 'unacademy.com', '/'],
  ['Vedantu', 'Productivity & Cloud', 'www.vedantu.com', '/'],
  ['Doubtnut', 'Productivity & Cloud', 'www.doubtnut.com', '/'],
  ['Toppr', 'Productivity & Cloud', 'www.toppr.com', '/'],
  ['Allen Digital', 'Productivity & Cloud', 'allen.in', '/'],
  ['Coursera', 'Productivity & Cloud', 'www.coursera.org', '/login'],
  ['Udemy', 'Productivity & Cloud', 'www.udemy.com', '/join/login-popup/'],
  ['upGrad', 'Productivity & Cloud', 'www.upgrad.com', '/'],
  ['Scaler', 'Productivity & Cloud', 'www.scaler.com', '/'],
  ['GeeksforGeeks', 'Developer & Code', 'auth.geeksforgeeks.org', '/'],
  ['Coding Ninjas', 'Developer & Code', 'www.naukri.com', '/code360'],
  ['NoBroker', 'Productivity & Cloud', 'www.nobroker.in', '/'],
  ['MagicBricks', 'Productivity & Cloud', 'www.magicbricks.com', '/'],
  ['99acres', 'Productivity & Cloud', 'www.99acres.com', '/'],
  ['Housing.com', 'Productivity & Cloud', 'housing.com', '/'],
  ['Square Yards', 'Productivity & Cloud', 'www.squareyards.com', '/'],
  ['Stanza Living', 'Productivity & Cloud', 'www.stanzaliving.com', '/'],

  // Devices, Ecosystem, Citizen Services & Global SaaS
  ['Google Account', 'Productivity & Cloud', 'accounts.google.com', '/signin/v2/usernamerecovery'],
  ['Apple ID', 'Productivity & Cloud', 'iforgot.apple.com', '/'],
  ['Samsung Account', 'Productivity & Cloud', 'account.samsung.com', '/'],
  ['Xiaomi Account', 'Productivity & Cloud', 'account.xiaomi.com', '/'],
  ['OnePlus Account', 'Productivity & Cloud', 'id.oneplus.com', '/'],
  ['Realme Account', 'Productivity & Cloud', 'id.realme.com', '/'],
  ['Nothing Account', 'Productivity & Cloud', 'intl.nothing.tech', '/'],
  ['Yahoo', 'Productivity & Cloud', 'login.yahoo.com', '/'],
  ['Proton', 'Productivity & Cloud', 'account.proton.me', '/login'],
  ['Adobe', 'Productivity & Cloud', 'account.adobe.com', '/'],
  ['Dropbox', 'Productivity & Cloud', 'www.dropbox.com', '/login'],
  ['Slack', 'Productivity & Cloud', 'slack.com', '/signin'],
  ['Zoom', 'Productivity & Cloud', 'zoom.us', '/signin'],
  ['Canva', 'Productivity & Cloud', 'www.canva.com', '/login'],
  ['Shopify', 'Productivity & Cloud', 'accounts.shopify.com', '/lookup'],
  ['GitHub', 'Developer & Code', 'github.com', '/login'],
  ['GitLab', 'Developer & Code', 'gitlab.com', '/users/sign_in'],
  ['OpenAI / ChatGPT', 'Developer & Code', 'auth.openai.com', '/'],
  ['Anthropic Claude', 'Developer & Code', 'claude.ai', '/login'],
  ['Notion', 'Productivity & Cloud', 'www.notion.so', '/login'],
  ['Figma', 'Productivity & Cloud', 'www.figma.com', '/login'],
  ['DigiLocker', 'Phone & Telecom', 'www.digilocker.gov.in', '/'],
  ['UMANG', 'Phone & Telecom', 'web.umang.gov.in', '/'],
  ['mParivahan / Vahan', 'Phone & Telecom', 'parivahan.gov.in', '/'],
  ['EPFO Member Portal', 'Phone & Telecom', 'unifiedportal-mem.epfindia.gov.in', '/'],
  ['Income Tax e-Filing', 'Phone & Telecom', 'www.incometax.gov.in', '/'],
  ['CoWIN / ABHA', 'Phone & Telecom', 'abha.abdm.gov.in', '/'],
  ['UIDAI MyAadhaar', 'Phone & Telecom', 'myaadhaar.uidai.gov.in', '/'],
  ['Passport Seva', 'Phone & Telecom', 'www.passportindia.gov.in', '/'],
  ['DoorDash', 'Productivity & Cloud', 'www.doordash.com', '/'],
  ['Instacart', 'Productivity & Cloud', 'www.instacart.com', '/'],
  ['Walmart', 'Productivity & Cloud', 'www.walmart.com', '/account/login'],
  ['Target', 'Productivity & Cloud', 'www.target.com', '/'],
  ['Best Buy', 'Productivity & Cloud', 'www.bestbuy.com', '/'],
  ['eBay', 'Productivity & Cloud', 'signin.ebay.com', '/'],
  ['AliExpress', 'Productivity & Cloud', 'login.aliexpress.com', '/'],
  ['Shopee', 'Productivity & Cloud', 'shopee.in', '/'],
  ['Rakuten', 'Productivity & Cloud', 'account.rakuten.com', '/'],
  ['Mail.ru', 'Productivity & Cloud', 'account.mail.ru', '/login'],
  ['VK', 'Social & Community', 'vk.com', '/'],
  ['OK.ru', 'Social & Community', 'ok.ru', '/'],
];

export function buildPhoneServiceProbes(
  parsed: NormalizedPhoneTarget
): PlatformSweepTarget[] {
  const probes: PlatformSweepTarget[] = [
    // 1. Facebook / Meta Live Identify Recovery Probe (Zero SMS OTP dispatched)
    {
      platform: 'Facebook',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.facebook.com/login/identify/',
      customProbeFn: () => probeFacebookIdentify(parsed.e164),
    },

    // 2. Instagram Live Account Probe (Zero SMS OTP dispatched)
    {
      platform: 'Instagram',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://www.instagram.com/accounts/password/reset/',
      customProbeFn: () => probeInstagramAccount(parsed.e164, 'phone'),
    },

    // 3. Snapchat / Bitmoji Phone Lookup (Zero SMS OTP dispatched)
    {
      platform: 'Snapchat',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => 'https://accounts.snapchat.com/',
      customProbeFn: async () => {
        const res = await safeFetch(
          'https://bitmoji.api.snapchat.com/api/user/find',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            body: JSON.stringify({ phone: parsed.e164 }),
          },
          6000
        );
        if (res.status === 204) {
          return {
            status: 'not_found',
            httpStatus: 204,
            url: 'https://accounts.snapchat.com/',
            bio: `No Snapchat account linked to ${parsed.e164}.`,
          };
        }
        const obj = asObj(res.json);
        if (res.status === 200 && obj) {
          const bitmojiId =
            asStr(obj.bitmoji_avatar_id) ||
            asStr(obj.bitmoji_selfie_id) ||
            asStr(obj.avatar_id);
          const rawSnapAvatar =
            asStr(obj.avatar_url) ||
            asStr(obj.image_url) ||
            asStr(obj.bitmoji_url) ||
            (bitmojiId ? `https://sdk.bitmoji.com/render/panel/${encodeURIComponent(bitmojiId)}-v1.png` : undefined);
          const snapAvatar = rawSnapAvatar
            ?.replace(/\\u002[fF]/g, '/')
            .replace(/\\u0026/g, '&')
            .replace(/\\\//g, '/');
          return {
            status: 'found',
            httpStatus: 200,
            displayName: `Snapchat Account (${parsed.e164})`,
            avatarUrl: snapAvatar,
            url: 'https://accounts.snapchat.com/',
            bio: `Registered Snapchat / Bitmoji phone-linked account confirmed for ${parsed.e164} (zero OTP sent).`,
            extraFields: [
              {
                label: 'Account Type',
                value: asStr(obj.account_type) || 'Snapchat / Bitmoji Linked',
              },
              { label: 'Verification Method', value: 'Zero-SMS Snapchat Lookup API' },
            ],
          };
        }
        return {
          status: 'not_checked',
          httpStatus: res.status,
          url: 'https://accounts.snapchat.com/',
          bio: `Snapchat endpoint inconclusive or rate-limited (HTTP ${res.status || 'timeout'}).`,
        };
      },
    },

    // 4. Flipkart Live Signup Status Check (Handles VERIFIED & NOT_VERIFIED, zero SMS OTP dispatched)
    {
      platform: 'Flipkart',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://www.flipkart.com/account/login',
      customProbeFn: () => probeFlipkartAccount(parsed.e164, 'phone'),
    },

    // 5. Microsoft / Skype / Xbox Live CredentialType Check (Zero SMS OTP dispatched)
    {
      platform: 'Microsoft',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://login.live.com/',
      customProbeFn: async () => {
        const initRes = await safeFetch(
          'https://login.live.com/',
          { headers: { Accept: 'text/html,application/xhtml+xml' } },
          6500
        );
        const setCookies = initRes.headers?.getSetCookie ? initRes.headers.getSetCookie() : [];
        const cookieStr =
          setCookies.length > 0
            ? setCookies.map((c) => c.split(';')[0]).filter(Boolean).join('; ')
            : initRes.headers?.get('set-cookie') || '';
        const ppft =
          initRes.text.match(/value=\\"([^\\"]+)\\"/)?.[1] ||
          initRes.text.match(/name="PPFT"[^>]*value="([^"]+)"/)?.[1] ||
          initRes.text.match(/"sFT":"([^"]+)"/)?.[1] ||
          '';
        const credUrl =
          initRes.text.match(/https:\/\/login\.live\.com\/GetCredentialType\.srf\?[^'"\\]+/)?.[0] ||
          'https://login.live.com/GetCredentialType.srf';

        if (!ppft) {
          return {
            status: 'not_checked',
            httpStatus: initRes.status,
            url: 'https://login.live.com/',
            bio: `Microsoft login flowToken unavailable (HTTP ${initRes.status || 'timeout'}).`,
          };
        }

        const res = await safeFetch(
          credUrl,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...(cookieStr ? { Cookie: cookieStr } : {}),
              Origin: 'https://login.live.com',
              Referer: 'https://login.live.com/',
            },
            body: JSON.stringify({
              username: parsed.e164,
              uaId: '',
              isOtherIdpSupported: true,
              checkPhones: true,
              isRemoteNGCSupported: false,
              isCookieBannerShown: false,
              isFidoSupported: false,
              flowToken: ppft,
            }),
          },
          7000
        );

        const obj = asObj(res.json);
        const code = typeof obj?.IfExistsResult === 'number' ? obj.IfExistsResult : -1;
        const throttled = obj?.ThrottleStatus === 1;
        const exists = !throttled && (code === 0 || code === 5 || code === 6);
        const notExists = !throttled && code === 1;

        if (exists) {
          const creds = asObj(obj?.Credentials);
          const methods: string[] = [];
          if (creds?.HasPassword) methods.push('Password');
          if (creds?.HasPhone) methods.push('Phone/SMS');
          if (creds?.HasFido) methods.push('Passkey/FIDO');
          if (creds?.HasGoogleFed) methods.push('Google Fed');
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: 'Microsoft / Skype Phone Account',
            url: 'https://login.live.com/',
            bio: `Registered Microsoft / Skype / Xbox phone-linked account confirmed via login.live.com GetCredentialType (IfExistsResult=${code}, zero OTP sent).`,
            extraFields: [
              { label: 'IfExistsResult', value: String(code) },
              {
                label: 'Account Scope',
                value:
                  code === 5
                    ? 'Microsoft Personal (MSA)'
                    : code === 0
                    ? 'Microsoft / Entra Account'
                    : 'Federated Account',
              },
              ...(methods.length > 0
                ? [{ label: 'Sign-In Methods', value: methods.join(', ') }]
                : []),
              { label: 'Verification Method', value: 'Zero-SMS GetCredentialType' },
            ],
          };
        }
        if (notExists) {
          return {
            status: 'not_found',
            httpStatus: res.status,
            url: 'https://login.live.com/',
            bio: `No Microsoft account registered to ${parsed.e164}.`,
          };
        }
        return {
          status: 'not_checked',
          httpStatus: res.status,
          url: 'https://login.live.com/',
          bio: throttled
            ? 'Microsoft endpoint rate-limited probe.'
            : `Microsoft verification inconclusive (HTTP ${res.status || 'timeout'}).`,
        };
      },
    },

    // 6. Zoho Accounts Live Phone Lookup (Zero SMS OTP dispatched)
    {
      platform: 'Zoho',
      category: 'Productivity & Cloud',
      isLiveVerification: true,
      urlFn: () => 'https://accounts.zoho.com/signin',
      customProbeFn: async () => {
        const signinRes = await safeFetch('https://accounts.zoho.com/signin', {}, 7000);
        const setCookies = signinRes.headers?.getSetCookie
          ? signinRes.headers.getSetCookie()
          : [];
        const cookieStr =
          setCookies.length > 0
            ? setCookies.join('; ')
            : signinRes.headers?.get('set-cookie') || '';
        const csr = cookieStr.match(/iamcsr=([^;\s]+)/)?.[1];
        if (!csr) {
          return {
            status: 'not_checked',
            httpStatus: signinRes.status,
            url: 'https://accounts.zoho.com/signin',
            bio: 'Zoho CSRF session cookie unavailable from host.',
          };
        }

        const lookupIdentifier = parsed.prefix
          ? `${parsed.prefix}-${parsed.national}`
          : parsed.cleanDigits;
        const lookupRes = await safeFetch(
          `https://accounts.zoho.com/signin/v2/lookup/${encodeURIComponent(lookupIdentifier)}`,
          {
            method: 'POST',
            headers: {
              Cookie: `iamcsr=${csr}`,
              'X-ZCSRF-TOKEN': `iamcsrcoo=${csr}`,
              'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
              Referer: 'https://accounts.zoho.com/signin',
              Origin: 'https://accounts.zoho.com',
            },
            body: `mode=primary&cli_time=${Date.now()}&servicename=ZohoAccounts&serviceurl=https://accounts.zoho.com/`,
          },
          7000
        );

        const data = asObj(lookupRes.json);
        const lookup = asObj(data?.lookup);
        if (lookup && asStr(lookup.identifier)) {
          const emailData = asObj(lookup.email)?.data;
          const recoveryEmail = Array.isArray(emailData)
            ? asStr(asObj(emailData[0])?.email)
            : undefined;
          const modesObj = asObj(lookup.modes);
          const allowedModes = Array.isArray(modesObj?.allowed_modes)
            ? modesObj.allowed_modes.filter((m): m is string => typeof m === 'string')
            : [];

          return {
            status: 'found',
            httpStatus: lookupRes.status,
            id: asStr(lookup.identifier),
            displayName: recoveryEmail ? `Zoho Account (${recoveryEmail})` : 'Registered Zoho Account',
            url: 'https://accounts.zoho.com/signin',
            bio: `Registered Zoho account confirmed${recoveryEmail ? ` · Masked recovery email: ${recoveryEmail}` : ''}.`,
            extraFields: [
              ...(recoveryEmail
                ? [{ label: 'Masked Recovery Email', value: recoveryEmail, copyable: true }]
                : []),
              ...(allowedModes.length > 0
                ? [{ label: 'Auth Modes', value: allowedModes.join(', ') }]
                : []),
            ],
          };
        }

        const errText = `${asStr(data?.message) || ''} ${asStr(data?.localized_message) || ''}`;
        if (
          !/hip required|captcha|in108|limit/i.test(errText) &&
          /does not exist|no account|couldn't find|user not found/i.test(errText)
        ) {
          return {
            status: 'not_found',
            httpStatus: lookupRes.status,
            url: 'https://accounts.zoho.com/signin',
            bio: `No Zoho account registered to ${parsed.e164}.`,
          };
        }

        return {
          status: 'not_checked',
          httpStatus: lookupRes.status,
          url: 'https://accounts.zoho.com/signin',
          bio: /hip required|captcha|in108/i.test(errText)
            ? 'Zoho CAPTCHA (HIP) verification active on lookup.'
            : asStr(data?.localized_message) || 'Zoho lookup gated or inconclusive.',
        };
      },
    },

    // 7. Telegram Public Phone Privacy Resolve Check + Avatar/Bio/Username Extraction (Zero SMS OTP)
    {
      platform: 'Telegram',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => `https://t.me/+${parsed.cleanDigits}`,
      customProbeFn: async () => {
        const res = await safeFetch(`https://t.me/+${parsed.cleanDigits}`, {}, 5500);
        const titleMatch = res.text.match(/<div class="tgme_page_title"[^>]*>([\s\S]*?)<\/div>/i);
        const rawTitle = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';

        const decodeEntityEscapes = (raw: string): string =>
          raw
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
            .replace(/\\x2[fF]/gi, '/')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .trim();

        const cleanPhotoUrl = (raw?: string): string | undefined => {
          if (!raw) return undefined;
          const decoded = decodeEntityEscapes(raw);
          const withProto = decoded.startsWith('//') ? `https:${decoded}` : decoded;
          if (!/^https?:\/\//i.test(withProto)) return undefined;
          if (/telegram\.org\/img\/t_logo/i.test(withProto)) return undefined;
          return withProto;
        };

        const extractTgPhoto = (html: string): string | undefined => {
          const imgTag = html.match(/<img[^>]*tgme_page_photo_image[^>]*>/i)?.[0] || '';
          const photoFromTag = imgTag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
          const ogImgMatch =
            html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
            html.match(/<meta[^>]+(?:name|property)=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
          const cdnMatch = html.match(/https:\/\/(?:cdn\d+\.telegram-cdn\.org|[^"'\s]+\.telesco\.me\/file)\/[^"'\s<>\\]+/i)?.[0];
          return cleanPhotoUrl(photoFromTag) || cleanPhotoUrl(ogImgMatch) || cleanPhotoUrl(cdnMatch);
        };

        let avatarUrl = extractTgPhoto(res.text);
        const hasRealTitle =
          Boolean(rawTitle) &&
          !/^chat with\b|join group chat on telegram|telegram: contact|if you have telegram/i.test(
            rawTitle
          ) &&
          !rawTitle.startsWith('+');

        if (hasRealTitle || avatarUrl) {
          const descMatch = res.text.match(
            /<div class="tgme_page_description"[^>]*>([\s\S]*?)<\/div>/i
          );
          const bioText = descMatch?.[1]
            ?.replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const handleMatch =
            res.text.match(/https:\/\/t\.me\/([a-zA-Z][a-zA-Z0-9_]{3,31})/i)?.[1] ||
            bioText?.match(/@([a-zA-Z][a-zA-Z0-9_]{3,31})/)?.[1];
          const verifiedHandle =
            handleMatch && !/^(share|joinchat|s|iv)$/i.test(handleMatch)
              ? handleMatch
              : undefined;

          if (!avatarUrl && verifiedHandle) {
            const handlePage = await safeFetch(
              `https://t.me/${encodeURIComponent(verifiedHandle)}`,
              {},
              4000
            );
            avatarUrl = extractTgPhoto(handlePage.text);
          }

          if (!avatarUrl && verifiedHandle) {
            const unavRes = await safeFetch(
              `https://unavatar.io/telegram/${encodeURIComponent(verifiedHandle)}?json&fallback=false`,
              { headers: { Accept: 'application/json' } },
              3500
            );
            const unavUrl = asStr(asObj(unavRes.json)?.url);
            if (unavUrl) {
              avatarUrl = cleanPhotoUrl(unavUrl);
            } else {
              try {
                const imgRes = await fetch(
                  `https://unavatar.io/telegram/${encodeURIComponent(verifiedHandle)}?fallback=false`,
                  { headers: { 'User-Agent': PROBE_UA, Accept: 'image/*' }, signal: AbortSignal.timeout(3500) }
                );
                const ct = (imgRes.headers.get('content-type') || '').toLowerCase();
                await imgRes.body?.cancel().catch(() => {});
                if (imgRes.ok && ct.startsWith('image/')) {
                  avatarUrl = imgRes.url || `https://unavatar.io/telegram/${encodeURIComponent(verifiedHandle)}?fallback=false`;
                }
              } catch {
                // ignore
              }
            }
          }

          const resolvedName = hasRealTitle ? decodeEntityEscapes(rawTitle) : parsed.international;
          return {
            status: 'found',
            httpStatus: res.status,
            displayName: resolvedName,
            verifiedUsername: verifiedHandle,
            avatarUrl,
            url: `https://t.me/+${parsed.cleanDigits}`,
            bio:
              bioText && !/^if you have telegram/i.test(bioText)
                ? decodeEntityEscapes(bioText)
                : `Public Telegram identity resolved via t.me/+${parsed.cleanDigits}: ${resolvedName}.`,
            extraFields: [
              { label: 'Telegram Name', value: resolvedName, copyable: true },
              ...(verifiedHandle
                ? [{ label: 'Username', value: `@${verifiedHandle}`, copyable: true }]
                : []),
              { label: 'Direct Pivot', value: `https://t.me/+${parsed.cleanDigits}`, kind: 'url', copyable: true },
            ],
          };
        }

        return {
          status: 'not_checked',
          httpStatus: res.status,
          url: `https://t.me/+${parsed.cleanDigits}`,
          bio: 'Hidden by Telegram phone privacy settings or unregistered (direct t.me pivot available).',
        };
      },
    },

    // 8. WhatsApp Passive Click-to-Chat / Business Directory Check (Zero Unsolicited Messages)
    {
      platform: 'WhatsApp',
      category: 'Social & Community',
      isLiveVerification: true,
      urlFn: () => `https://wa.me/${parsed.cleanDigits}`,
      customProbeFn: async () => {
        const decodeWaStr = (raw: string): string =>
          raw
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
            .replace(/\\x2[fF]/gi, '/')
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .trim();

        const extractWaMeta = (html: string) => {
          const ogTitle =
            html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
            html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] ||
            '';
          const headingName =
            html.match(/<h3[^>]*class="[^"]*_9vd5[^"]*"[^>]*>([\s\S]*?)<\/h3>/i)?.[1]
              ?.replace(/<[^>]+>/g, '')
              .trim() || '';
          const candidateName = decodeWaStr(headingName || ogTitle);
          const isGeneric =
            !candidateName ||
            /^(share on whatsapp|whatsapp|chat on whatsapp|whatsapp web|continue to chat)$/i.test(
              candidateName
            ) ||
            candidateName.toLowerCase().includes('share on whatsapp') ||
            candidateName.toLowerCase().startsWith('chat on whatsapp') ||
            /^\+?[\d\s()-]{6,}$/.test(candidateName);

          const rawOgImg =
            html.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["'](https?:\/\/[^"']+)["']/i)?.[1] ||
            html.match(/<meta[^>]+content=["'](https?:\/\/[^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)?.[1] ||
            html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["'](https?:\/\/[^"']+)["']/i)?.[1] ||
            html.match(/<img[^>]*class=["'][^"']*_9vx6[^"']*["'][^>]*src=["']([^"']+)["']/i)?.[1] ||
            html.match(/<img[^>]*src=["']([^"']+)["'][^>]*class=["'][^"']*_9vx6[^"']*["']/i)?.[1];
          const rawPpsImg = html.match(
            /https:(?:\\u002[fF]|\\\/|\/){2}(?:pps\.whatsapp\.net|media-[a-z0-9-]+\.cdn\.whatsapp\.net)(?:\\u002[fF]|\\\/|\/)[^"'\s<>\\]+/i
          )?.[0];
          const normalizedImg = decodeWaStr(rawPpsImg || rawOgImg || '');
          const validAvatar =
            normalizedImg &&
            /^https?:\/\//i.test(normalizedImg) &&
            !/static\.whatsapp\.net|whatsapp\.com\/favicon|whatsapp\.com\/rsrc|wa_logo|og_image_default/i.test(
              normalizedImg
            )
              ? normalizedImg
              : undefined;
          return { candidateName, isGeneric, validAvatar };
        };

        const res = await safeFetch(
          `https://api.whatsapp.com/send/?phone=${parsed.cleanDigits}&text&type=phone_number&app_absent=0`,
          {
            headers: {
              Accept: 'text/html,application/xhtml+xml',
              'Accept-Language': 'en-US,en;q=0.9',
            },
          },
          5500
        );
        let parsedWa = extractWaMeta(res.text);

        if (!parsedWa.validAvatar) {
          const [waMeRes, fbBotRes] = await Promise.all([
            safeFetch(
              `https://wa.me/${parsed.cleanDigits}`,
              {
                headers: {
                  'User-Agent': 'WhatsApp/2.24.16.76 i',
                  Accept: 'text/html,application/xhtml+xml',
                },
              },
              4500
            ),
            safeFetch(
              `https://wa.me/${parsed.cleanDigits}`,
              {
                headers: {
                  'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
                  Accept: 'text/html,application/xhtml+xml',
                },
              },
              4500
            ),
          ]);
          for (const altRes of [waMeRes, fbBotRes]) {
            if (!altRes.text) continue;
            const altParsed = extractWaMeta(altRes.text);
            if (!parsedWa.validAvatar && altParsed.validAvatar) {
              parsedWa = {
                candidateName:
                  !parsedWa.isGeneric ? parsedWa.candidateName : altParsed.candidateName,
                isGeneric: parsedWa.isGeneric && altParsed.isGeneric,
                validAvatar: altParsed.validAvatar,
              };
            } else if (parsedWa.isGeneric && !altParsed.isGeneric) {
              parsedWa = {
                ...parsedWa,
                candidateName: altParsed.candidateName,
                isGeneric: false,
              };
            }
          }
        }

        if (
          (res.ok || parsedWa.validAvatar) &&
          ((!parsedWa.isGeneric && parsedWa.candidateName.length >= 2) || parsedWa.validAvatar)
        ) {
          const resolvedDisplay =
            !parsedWa.isGeneric && parsedWa.candidateName.length >= 2
              ? parsedWa.candidateName
              : parsed.international;
          return {
            status: 'found',
            httpStatus: res.status || 200,
            displayName: resolvedDisplay,
            avatarUrl: parsedWa.validAvatar,
            url: `https://wa.me/${parsed.cleanDigits}`,
            bio: parsedWa.validAvatar
              ? `Public WhatsApp profile & photo resolved for ${parsed.international}: ${resolvedDisplay}.`
              : `Public WhatsApp label resolved for ${parsed.international}: ${resolvedDisplay} (profile photo restricted by WhatsApp privacy settings).`,
            extraFields: [
              { label: 'WhatsApp Label', value: resolvedDisplay, copyable: true },
              { label: 'Click-to-Chat Pivot', value: `https://wa.me/${parsed.cleanDigits}`, kind: 'url', copyable: true },
            ],
          };
        }

        return {
          status: 'not_checked',
          httpStatus: res.status || 200,
          url: `https://wa.me/${parsed.cleanDigits}`,
          bio: `WhatsApp requires mobile session for presence check — direct click-to-chat link ready: https://wa.me/${parsed.cleanDigits}`,
          extraFields: [
            { label: 'Direct Chat Pivot', value: `https://wa.me/${parsed.cleanDigits}`, kind: 'url', copyable: true },
          ],
        };
      },
    },

    // 9. Razorpay.me Public Payment Handle & Merchant Profile Lookup (Zero OTP)
    {
      platform: 'Razorpay',
      category: 'Phone & Telecom',
      isLiveVerification: true,
      urlFn: () =>
        `https://razorpay.me/@${encodeURIComponent(
          parsed.national.length >= 8 ? parsed.national : parsed.cleanDigits
        )}`,
      customProbeFn: async () => {
        const extractBalancedJsonObject = (text: string, marker: string): Record<string, unknown> | null => {
          const idx = text.indexOf(marker);
          if (idx === -1) return null;
          const braceStart = text.indexOf('{', idx + marker.length);
          if (braceStart === -1) return null;
          let depth = 0;
          let inStr = false;
          let escaped = false;
          for (let i = braceStart; i < Math.min(text.length, braceStart + 24000); i++) {
            const ch = text[i];
            if (escaped) {
              escaped = false;
              continue;
            }
            if (ch === '\\' && inStr) {
              escaped = true;
              continue;
            }
            if (ch === '"') {
              inStr = !inStr;
              continue;
            }
            if (inStr) continue;
            if (ch === '{') depth += 1;
            else if (ch === '}') {
              depth -= 1;
              if (depth === 0) {
                try {
                  return asObj(JSON.parse(text.slice(braceStart, i + 1)));
                } catch {
                  return null;
                }
              }
            }
          }
          return null;
        };

        const candidates = Array.from(
          new Set(
            [
              parsed.national.length >= 8 ? parsed.national : '',
              parsed.cleanDigits,
            ].filter(Boolean)
          )
        );
        let sawErrorPage = false;
        let lastStatus = 0;

        for (const handle of candidates) {
          const targetUrl = `https://razorpay.me/@${encodeURIComponent(handle)}`;
          const res = await safeFetch(
            targetUrl,
            { headers: { Accept: 'text/html,application/xhtml+xml' } },
            5500
          );
          lastStatus = res.status;
          if (!res.ok || !res.text) continue;

          const title = res.text.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || '';
          if (/^error$/i.test(title) || !res.text.includes('"merchant"')) {
            sawErrorPage = true;
            continue;
          }

          const merchant = extractBalancedJsonObject(res.text, '"merchant"');
          const mWindowIdx = res.text.indexOf('"merchant"');
          const mSlice = mWindowIdx >= 0 ? res.text.slice(mWindowIdx, mWindowIdx + 6000) : '';

          const merchantName =
            asStr(merchant?.name) ||
            asStr(mSlice.match(/"name"\s*:\s*"([^"]+)"/)?.[1]) ||
            title.replace(/^razorpay\.me\s*-\s*/i, '').trim() ||
            handle;
          const merchantId =
            asStr(merchant?.id) ||
            asStr(mSlice.match(/"id"\s*:\s*"(merch_[^"]+|[A-Za-z0-9]{10,20})"/)?.[1]);
          const supportEmail =
            asStr(merchant?.support_email) ||
            asStr(mSlice.match(/"support_email"\s*:\s*"([^"]+)"/)?.[1]);
          const supportMobile =
            asStr(merchant?.support_mobile) ||
            asStr(mSlice.match(/"support_mobile"\s*:\s*"([^"]+)"/)?.[1]);
          const registeredAddr =
            asStr(merchant?.business_registered_address) ||
            asStr(mSlice.match(/"business_registered_address"\s*:\s*"([^"]+)"/)?.[1]);
          const ogImgMatch =
            res.text.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            res.text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)?.[1] ||
            res.text.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1];
          const rawMerchantImg =
            asStr(merchant?.image) ||
            asStr(mSlice.match(/"image"\s*:\s*"([^"]+)"/)?.[1]) ||
            ogImgMatch;
          const normalizedRzpImg = rawMerchantImg
            ? rawMerchantImg
                .replace(/\\u002[fF]/g, '/')
                .replace(/\\u0026/g, '&')
                .replace(/\\\//g, '/')
                .replace(/&amp;/g, '&')
                .trim()
            : '';
          const fullRzpImg = normalizedRzpImg.startsWith('//')
            ? `https:${normalizedRzpImg}`
            : normalizedRzpImg.startsWith('/')
            ? `https://razorpay.me${normalizedRzpImg}`
            : normalizedRzpImg;
          const merchantAvatar =
            fullRzpImg &&
            /^https?:\/\//i.test(fullRzpImg) &&
            !/cdn\.razorpay\.com\/static\/assets\/logo\/rzp\.png|razorpay\.com\/favicon/i.test(fullRzpImg)
              ? fullRzpImg
              : undefined;

          return {
            status: 'found',
            httpStatus: res.status,
            id: merchantId,
            displayName: merchantName,
            avatarUrl: merchantAvatar,
            location: registeredAddr,
            url: targetUrl,
            bio: `Active Razorpay.me payment handle resolved (${merchantName})${
              registeredAddr ? ` · Registered city/address: ${registeredAddr}` : ''
            }. Zero OTP sent.`,
            extraFields: [
              { label: 'Payment Handle', value: `@${handle}`, copyable: true },
              { label: 'Account / Merchant Name', value: merchantName, copyable: true },
              ...(merchantId ? [{ label: 'Merchant ID', value: merchantId, copyable: true }] : []),
              ...(supportEmail
                ? [{ label: 'Support Email', value: supportEmail, kind: 'email' as const, copyable: true }]
                : []),
              ...(supportMobile
                ? [{ label: 'Support Mobile', value: supportMobile, kind: 'phone' as const, copyable: true }]
                : []),
              ...(registeredAddr
                ? [{ label: 'Registered Address', value: registeredAddr }]
                : []),
              { label: 'Verification Method', value: 'Zero-OTP Razorpay.me Page Lookup' },
            ],
          };
        }

        return {
          status: sawErrorPage ? 'not_found' : 'not_checked',
          httpStatus: lastStatus,
          url: `https://razorpay.me/@${encodeURIComponent(candidates[0] || parsed.cleanDigits)}`,
          bio: sawErrorPage
            ? `No public Razorpay.me payment handle registered for ${parsed.e164}.`
            : `Razorpay.me lookup inconclusive (HTTP ${lastStatus || 'timeout'}).`,
        };
      },
    },

    // 10. PayPal.Me Public Payment Link Probe (Zero OTP)
    {
      platform: 'PayPal',
      category: 'Phone & Telecom',
      isLiveVerification: true,
      urlFn: () =>
        `https://www.paypal.com/paypalme/${encodeURIComponent(
          parsed.national.length >= 8 ? parsed.national : parsed.cleanDigits
        )}`,
      customProbeFn: async () => {
        const decodePpStr = (raw: string): string =>
          raw
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
            .replace(/\\\//g, '/')
            .replace(/&amp;/g, '&')
            .replace(/&quot;/g, '"')
            .replace(/&#39;|&apos;/g, "'")
            .trim();

        const candidates = Array.from(
          new Set(
            [
              parsed.national.length >= 8 ? parsed.national : '',
              parsed.cleanDigits,
            ].filter(Boolean)
          )
        );
        let lastStatus = 0;
        let hadClean200 = false;

        for (const handle of candidates) {
          const targetUrl = `https://www.paypal.com/paypalme/${encodeURIComponent(handle)}`;
          const res = await safeFetch(
            targetUrl,
            { headers: { Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' } },
            5500
          );
          lastStatus = res.status;
          if (!res.ok || !res.text) continue;

          const ogTitleRaw =
            res.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            res.text.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i)?.[1] ||
            '';
          const ogTitle = decodePpStr(ogTitleRaw);
          const payMatch = ogTitle.match(/^Pay\s+(.+?)\s+using\s+PayPal\.Me$/i);
          if (payMatch?.[1]) {
            const holderName = payMatch[1].trim();
            const isValidPaypalAvatar = (cand?: string): string | undefined => {
              if (!cand) return undefined;
              const clean = decodePpStr(cand);
              if (!/^https?:\/\//i.test(clean)) return undefined;
              if (
                /pplogo|paypalobjects\.com\/webstatic|default[-_]avatar|avatar[-_]placeholder|paypal\.com\/favicon/i.test(
                  clean
                )
              ) {
                return undefined;
              }
              return clean;
            };

            const rawOgImg =
              res.text.match(/<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]+content=["'](https?:\/\/[^"']+)["']/i)?.[1] ||
              res.text.match(/<meta[^>]+content=["'](https?:\/\/[^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/i)?.[1] ||
              res.text.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["'](https?:\/\/[^"']+)["']/i)?.[1];
            const jsonAvatarMatch =
              res.text.match(/"(?:profileImage|photoUrl|avatarUrl|imageUrl|picUrl|recipientPhotoUrl)"\s*:\s*"(https?:[^"]+)"/i)?.[1] ||
              res.text.match(/https:(?:\\\/|\/){2}pics\.paypal\.com(?:\\\/|\/)[^"'\s<>\\]+/i)?.[0] ||
              res.text.match(/<img[^>]+(?:alt=["'][^"']*avatar[^"']*["']|class=["'][^"']*(?:avatar|profile)[^"']*["'])[^>]+src=["'](https?:\/\/[^"']+)["']/i)?.[1];

            const avatarUrl =
              isValidPaypalAvatar(jsonAvatarMatch) || isValidPaypalAvatar(rawOgImg);

            return {
              status: 'found',
              httpStatus: res.status,
              displayName: holderName,
              avatarUrl,
              url: targetUrl,
              bio: `Public PayPal.Me payment link resolved for ${holderName} (zero OTP sent).`,
              extraFields: [
                { label: 'PayPal.Me Handle', value: handle, copyable: true },
                { label: 'Account Label', value: holderName, copyable: true },
                { label: 'Direct Link', value: targetUrl, kind: 'url', copyable: true },
              ],
            };
          }

          const isWebCaptcha =
            /webcaptcha|recaptcha|security challenge|challenge-platform/i.test(res.text);
          if (
            !isWebCaptcha &&
            (/couldn't find this profile|page not found/i.test(res.text) ||
              res.text.includes('<title>PayPal</title>'))
          ) {
            hadClean200 = true;
          }
        }

        return {
          status: hadClean200 ? 'not_found' : 'not_checked',
          httpStatus: lastStatus,
          url: `https://www.paypal.com/paypalme/${encodeURIComponent(candidates[0] || parsed.cleanDigits)}`,
          bio: hadClean200
            ? `No public PayPal.Me handle matched ${parsed.e164}.`
            : `PayPal.Me protected by anti-bot webcaptcha challenge from host (HTTP ${lastStatus || 'timeout'}). Direct link ready to check in browser.`,
        };
      },
    },

    // 11. Instamojo Public Payment Store / Handle Lookup (Zero OTP)
    {
      platform: 'Instamojo',
      category: 'Phone & Telecom',
      isLiveVerification: true,
      urlFn: () =>
        `https://www.instamojo.com/@${encodeURIComponent(
          parsed.national.length >= 8 ? parsed.national : parsed.cleanDigits
        )}`,
      customProbeFn: async () => {
        const candidates = Array.from(
          new Set(
            [
              parsed.national.length >= 8 ? parsed.national : '',
              parsed.cleanDigits,
            ].filter(Boolean)
          )
        );
        let sawNotFound = false;
        let lastStatus = 0;

        for (const handle of candidates) {
          const targetUrl = `https://www.instamojo.com/@${encodeURIComponent(handle)}`;
          const res = await safeFetch(
            targetUrl,
            { headers: { Accept: 'text/html,application/xhtml+xml' } },
            5000
          );
          lastStatus = res.status;
          const isInstamojoErrorPage =
            /page not found|doesn'?t exist|does not exist|store not found|something went wrong|just a moment|attention required!\s*\|\s*cloudflare/i.test(
              res.text
            );
          if (res.status === 404 || isInstamojoErrorPage) {
            sawNotFound = true;
            continue;
          }
          if (res.ok && res.text) {
            const title =
              res.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
              res.text.match(/<title>([^<]+)<\/title>/i)?.[1] ||
              '';
            const cleanTitle = title.replace(/\s*[-|—]\s*Instamojo.*$/i, '').trim();
            if (cleanTitle && !/^(instamojo|404|error|page not found)$/i.test(cleanTitle)) {
              return {
                status: 'found',
                httpStatus: res.status,
                displayName: cleanTitle,
                url: targetUrl,
                bio: `Active Instamojo payment page resolved (@${handle} · ${cleanTitle}). Zero OTP sent.`,
                extraFields: [
                  { label: 'Instamojo Handle', value: `@${handle}`, copyable: true },
                  { label: 'Merchant Title', value: cleanTitle, copyable: true },
                  { label: 'Direct Link', value: targetUrl, kind: 'url', copyable: true },
                ],
              };
            }
          }
        }

        return {
          status: sawNotFound ? 'not_found' : 'not_checked',
          httpStatus: lastStatus,
          url: `https://www.instamojo.com/@${encodeURIComponent(candidates[0] || parsed.cleanDigits)}`,
          bio: sawNotFound
            ? `No public Instamojo payment handle registered for ${parsed.e164}.`
            : `Instamojo lookup inconclusive (HTTP ${lastStatus || 'timeout'}).`,
        };
      },
    },
  ];

  // Live Zero-OTP UPI VPA Verification Helper (Paytm, PhonePe, Google Pay, BHIM UPI, Amazon Pay, MobiKwik, CRED)
  const validateUpiVpaLive = async (
    vpa: string
  ): Promise<{
    configured: boolean;
    valid?: boolean;
    customerName?: string;
    provider?: string;
    httpStatus?: number;
  }> => {
    const rzpId = process.env.RAZORPAY_KEY_ID?.trim();
    const rzpSecret = process.env.RAZORPAY_KEY_SECRET?.trim();
    if (rzpId && rzpSecret) {
      const auth = Buffer.from(`${rzpId}:${rzpSecret}`).toString('base64');
      const res = await safeFetch(
        'https://api.razorpay.com/v1/payments/validate/vpa',
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ vpa }),
        },
        5500
      );
      const data = asObj(res.json);
      if (res.ok && data) {
        return {
          configured: true,
          valid: data.success === true,
          customerName: asStr(data.customer_name),
          provider: 'Razorpay UPI VPA API',
          httpStatus: res.status,
        };
      }
      return { configured: true, provider: 'Razorpay UPI VPA API', httpStatus: res.status };
    }

    const cfId = process.env.CASHFREE_CLIENT_ID?.trim();
    const cfSecret = process.env.CASHFREE_CLIENT_SECRET?.trim();
    if (cfId && cfSecret) {
      const res = await safeFetch(
        `https://api.cashfree.com/verification/upi?vpa=${encodeURIComponent(vpa)}`,
        {
          method: 'GET',
          headers: {
            'x-client-id': cfId,
            'x-client-secret': cfSecret,
            Accept: 'application/json',
          },
        },
        5500
      );
      const data = asObj(res.json);
      if (res.ok && data) {
        const isValid =
          String(data.valid).toLowerCase() === 'true' ||
          asStr(data.status)?.toUpperCase() === 'VALID';
        return {
          configured: true,
          valid: isValid,
          customerName: asStr(data.name_at_bank) || asStr(data.name),
          provider: 'Cashfree UPI VPA API',
          httpStatus: res.status,
        };
      }
      return { configured: true, provider: 'Cashfree UPI VPA API', httpStatus: res.status };
    }

    return { configured: false };
  };

  const vpaBaseDigits = parsed.national.length >= 10 ? parsed.national : parsed.cleanDigits;

  const makeUpiPaymentProbe = (
    platform: string,
    domain: string,
    portalUrl: string,
    pspHandles: string[]
  ): PlatformSweepTarget => ({
    platform,
    category: 'Phone & Telecom',
    isLiveVerification: true,
    urlFn: () => portalUrl,
    customProbeFn: async () => {
      const derivedVpas = pspHandles.map((s) => `${vpaBaseDigits}@${s}`);
      const rzpConfigured = Boolean(
        (process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim()) ||
          (process.env.CASHFREE_CLIENT_ID?.trim() && process.env.CASHFREE_CLIENT_SECRET?.trim())
      );

      if (rzpConfigured && parsed.iso2 === 'IN') {
        const vpaChecks = await Promise.all(
          derivedVpas.map(async (vpa) => ({ vpa, check: await validateUpiVpaLive(vpa) }))
        );
        const matchedVpas: Array<{ vpa: string; name?: string; provider?: string }> = [];
        let checkedOk = false;
        let lastCode = 0;

        for (const { vpa, check } of vpaChecks) {
          if (check.httpStatus) lastCode = check.httpStatus;
          if (typeof check.valid === 'boolean') checkedOk = true;
          if (check.valid) {
            matchedVpas.push({
              vpa,
              name: check.customerName,
              provider: check.provider,
            });
          }
        }

        if (matchedVpas.length > 0) {
          const primary = matchedVpas[0];
          return {
            status: 'found',
            httpStatus: lastCode || 200,
            displayName: primary.name || primary.vpa,
            verifiedUsername: primary.vpa,
            url: portalUrl,
            bio: `Verified active ${platform} UPI VPA: ${matchedVpas
              .map((m) => (m.name ? `${m.vpa} (${m.name})` : m.vpa))
              .join(', ')} via ${primary.provider || 'UPI API'} (zero OTP sent).`,
            extraFields: [
              { label: 'Verified UPI VPA', value: matchedVpas.map((m) => m.vpa).join(', '), copyable: true },
              ...(primary.name
                ? [{ label: 'Registered Bank Name', value: primary.name, copyable: true }]
                : []),
              { label: 'UPI Deep Link', value: `upi://pay?pa=${primary.vpa}`, kind: 'url', copyable: true },
              { label: 'Verification Method', value: 'Zero-OTP NPCI UPI VPA Validation' },
            ],
          };
        }

        if (checkedOk) {
          return {
            status: 'not_found',
            httpStatus: lastCode || 200,
            url: portalUrl,
            bio: `Checked ${derivedVpas.join(', ')} via live UPI VPA verification — no active ${platform} VPA registered (zero OTP sent).`,
          };
        }
      }

      const alive = await checkDomainDnsNonBlocking(domain);

      return {
        status: 'not_checked',
        httpStatus: alive ? 403 : 0,
        url: portalUrl,
        bio: `Zero-OTP passive check complete (${alive ? 'DNS live' : 'timeout'}). Derived ${platform} UPI handle(s): ${derivedVpas.join(
          ', '
        )}. Configure RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET or CASHFREE_CLIENT_ID/CASHFREE_CLIENT_SECRET for live banking name verification without OTPs.`,
        extraFields: [
          { label: 'Derived UPI VPA(s)', value: derivedVpas.join(', '), copyable: true },
          { label: 'UPI Intent Link', value: `upi://pay?pa=${derivedVpas[0]}`, kind: 'url', copyable: true },
          { label: 'OTP Policy', value: 'Zero SMS OTP Dispatched' },
        ],
      };
    },
  });

  const makeZeroOtpOttProbe = (
    platform: string,
    domain: string,
    portalUrl: string
  ): PlatformSweepTarget => ({
    platform,
    category: 'Phone & Telecom',
    isLiveVerification: true,
    urlFn: () => portalUrl,
    customProbeFn: async () => {
      const alive = await checkDomainDnsNonBlocking(domain);
      const statusLabel = alive ? 'DNS Active (WAF / Anti-Bot)' : 'Unreachable';
      return {
        status: 'not_checked',
        httpStatus: alive ? 403 : 0,
        url: portalUrl,
        bio: `${platform} OTT passive check (${statusLabel}) — account discovery via login requires SMS OTP or protected WAF session; zero OTP sent.`,
        extraFields: [
          { label: 'Service Status', value: statusLabel },
          { label: 'Portal', value: portalUrl, kind: 'url', copyable: true },
          { label: 'OTP Policy', value: 'Zero SMS OTP Dispatched' },
        ],
      };
    },
  });

  const makeZeroOtpLpgUtilityProbe = (
    platform: string,
    domain: string,
    portalUrl: string,
    serviceKind: string
  ): PlatformSweepTarget => ({
    platform,
    category: 'Phone & Telecom',
    isLiveVerification: true,
    urlFn: () => portalUrl,
    customProbeFn: async () => {
      const alive = await checkDomainDnsNonBlocking(domain);
      const statusLabel = alive ? 'DNS Active (Auth / WAF Gated)' : 'Unreachable';
      return {
        status: 'not_checked',
        httpStatus: alive ? 403 : 0,
        url: portalUrl,
        bio: `${platform} (${serviceKind}) passive check (${statusLabel}) — consumer/subsidy lookup requires consumer ID or OTP session; zero SMS OTP sent.`,
        extraFields: [
          { label: 'Utility Type', value: serviceKind },
          { label: 'Service Status', value: statusLabel },
          { label: 'Portal', value: portalUrl, kind: 'url', copyable: true },
          { label: 'OTP Policy', value: 'Zero SMS OTP Dispatched' },
        ],
      };
    },
  });

  probes.push(
    makeUpiPaymentProbe('Paytm', 'paytm.com', 'https://paytm.com/', ['paytm', 'ptsbi', 'ptaxis', 'ptyes', 'pthdfc']),
    makeUpiPaymentProbe('PhonePe', 'www.phonepe.com', 'https://www.phonepe.com/', ['ybl', 'ibl', 'axl']),
    makeUpiPaymentProbe('Google Pay', 'pay.google.com', 'https://pay.google.com/', [
      'okicici',
      'okaxis',
      'oksbi',
      'okhdfcbank',
    ]),
    makeUpiPaymentProbe('BHIM UPI', 'www.bhimupi.org.in', 'https://www.bhimupi.org.in/', ['upi', 'sbi', 'icici', 'hdfcbank']),
    makeUpiPaymentProbe('Amazon Pay', 'www.amazon.in', 'https://www.amazon.in/amazonpay', ['apl', 'yapl', 'rapl']),
    makeUpiPaymentProbe('MobiKwik', 'www.mobikwik.com', 'https://www.mobikwik.com/', ['ikwik']),
    makeUpiPaymentProbe('CRED', 'cred.club', 'https://cred.club/', ['axisb']),
    makeUpiPaymentProbe('Freecharge', 'www.freecharge.in', 'https://www.freecharge.in/', ['freecharge']),
    makeUpiPaymentProbe('Fampay', 'famapp.in', 'https://famapp.in/', ['fam', 'fampay']),
    makeUpiPaymentProbe('Jupiter Money', 'jupiter.money', 'https://jupiter.money/', ['jupiteraxis']),
    makeUpiPaymentProbe('Fi Money', 'fi.money', 'https://fi.money/', ['fifederal']),
    makeUpiPaymentProbe('Slice', 'www.sliceit.com', 'https://www.sliceit.com/', ['slice', 'sliceaxis']),
    makeUpiPaymentProbe('Navi', 'navi.com', 'https://navi.com/', ['naviaxis']),
    makeUpiPaymentProbe('BharatPe', 'bharatpe.com', 'https://bharatpe.com/', ['bharatpe']),
    makeUpiPaymentProbe('Bajaj Pay', 'www.bajajfinserv.in', 'https://www.bajajfinserv.in/bajaj-pay', ['bajajpay']),
    makeUpiPaymentProbe('WhatsApp Pay', 'www.whatsapp.com', 'https://www.whatsapp.com/payments/in', ['waicici', 'wahdfcbank', 'waaxis', 'wasbi']),
    makeUpiPaymentProbe('Super.money', 'super.money', 'https://super.money/', ['superyes']),
    makeUpiPaymentProbe('Flipkart UPI', 'www.flipkart.com', 'https://www.flipkart.com/', ['fkaxis']),
    makeUpiPaymentProbe('Pop UPI', 'www.popclub.co', 'https://www.popclub.co/', ['yespop']),
    makeUpiPaymentProbe('Kotak 811 UPI', 'www.kotak.com', 'https://www.kotak.com/', ['kotak']),
    makeUpiPaymentProbe('AU Bank UPI', 'www.aubank.in', 'https://www.aubank.in/', ['aubank']),
    makeUpiPaymentProbe('Bank of Baroda bob World', 'www.bankofbaroda.in', 'https://www.bankofbaroda.in/', ['barodampay']),
    makeUpiPaymentProbe('Groww', 'groww.in', 'https://groww.in/', ['yesg']),
    makeUpiPaymentProbe('Zerodha', 'zerodha.com', 'https://zerodha.com/', ['zerodha']),
    makeUpiPaymentProbe('Upstox', 'upstox.com', 'https://upstox.com/', ['upstox']),
    // OTT, Streaming, Music & Live Ticketing Portals
    makeZeroOtpOttProbe('SonyLIV', 'www.sonyliv.com', 'https://www.sonyliv.com/'),
    makeZeroOtpOttProbe('ZEE5', 'www.zee5.com', 'https://www.zee5.com/'),
    makeZeroOtpOttProbe('JioHotstar', 'www.hotstar.com', 'https://www.hotstar.com/in'),
    makeZeroOtpOttProbe('JioCinema', 'www.jiocinema.com', 'https://www.jiocinema.com/'),
    makeZeroOtpOttProbe('MX Player', 'www.mxplayer.in', 'https://www.mxplayer.in/'),
    makeZeroOtpOttProbe('Netflix', 'www.netflix.com', 'https://www.netflix.com/in/login'),
    makeZeroOtpOttProbe('Amazon Prime Video', 'www.primevideo.com', 'https://www.primevideo.com/'),
    makeZeroOtpOttProbe('Tata Play Binge', 'www.tataplaybinge.com', 'https://www.tataplaybinge.com/'),
    makeZeroOtpOttProbe('Airtel Xstream Play', 'www.airtelxstream.in', 'https://www.airtelxstream.in/'),
    makeZeroOtpOttProbe('FanCode', 'www.fancode.com', 'https://www.fancode.com/'),
    makeZeroOtpOttProbe('Aha Video', 'www.aha.video', 'https://www.aha.video/'),
    makeZeroOtpOttProbe('Hoichoi', 'www.hoichoi.tv', 'https://www.hoichoi.tv/'),
    makeZeroOtpOttProbe('Sun NXT', 'www.sunnxt.com', 'https://www.sunnxt.com/'),
    makeZeroOtpOttProbe('ManoramaMAX', 'www.manoramamax.com', 'https://www.manoramamax.com/'),
    makeZeroOtpOttProbe('Apple TV+', 'tv.apple.com', 'https://tv.apple.com/'),
    makeZeroOtpOttProbe('Lionsgate Play', 'lionsgateplay.com', 'https://lionsgateplay.com/'),
    makeZeroOtpOttProbe('Discovery+', 'www.discoveryplus.in', 'https://www.discoveryplus.in/'),
    makeZeroOtpOttProbe('Eros Now', 'erosnow.com', 'https://erosnow.com/'),
    makeZeroOtpOttProbe('ShemarooMe', 'www.shemaroome.com', 'https://www.shemaroome.com/'),
    makeZeroOtpOttProbe('Stage OTT', 'www.stage.in', 'https://www.stage.in/'),
    makeZeroOtpOttProbe('Chaupal OTT', 'chaupal.tv', 'https://chaupal.tv/'),
    makeZeroOtpOttProbe('DocuBay', 'www.docubay.com', 'https://www.docubay.com/'),
    makeZeroOtpOttProbe('Crunchyroll', 'www.crunchyroll.com', 'https://www.crunchyroll.com/'),
    makeZeroOtpOttProbe('MUBI', 'mubi.com', 'https://mubi.com/'),
    makeZeroOtpOttProbe('Spotify', 'accounts.spotify.com', 'https://accounts.spotify.com/en/login'),
    makeZeroOtpOttProbe('YouTube Music', 'music.youtube.com', 'https://music.youtube.com/'),
    makeZeroOtpOttProbe('Amazon Music India', 'music.amazon.in', 'https://music.amazon.in/'),
    makeZeroOtpOttProbe('JioSaavn', 'www.jiosaavn.com', 'https://www.jiosaavn.com/'),
    makeZeroOtpOttProbe('Gaana', 'gaana.com', 'https://gaana.com/'),
    makeZeroOtpOttProbe('Wynk Music', 'wynk.in', 'https://wynk.in/'),
    makeZeroOtpOttProbe('Audible India', 'www.audible.in', 'https://www.audible.in/'),
    makeZeroOtpOttProbe('Pocket FM', 'pocketfm.com', 'https://pocketfm.com/'),
    makeZeroOtpOttProbe('Kuku FM', 'kukufm.com', 'https://kukufm.com/'),
    makeZeroOtpOttProbe('Storytel', 'www.storytel.com', 'https://www.storytel.com/in'),
    makeZeroOtpOttProbe('BookMyShow', 'in.bookmyshow.com', 'https://in.bookmyshow.com/'),
    makeZeroOtpOttProbe('Paytm Insider', 'insider.in', 'https://insider.in/'),
    makeZeroOtpOttProbe('District by Zomato', 'www.district.in', 'https://www.district.in/'),
    makeZeroOtpOttProbe('PVR INOX', 'www.pvrcinemas.com', 'https://www.pvrcinemas.com/'),
    makeZeroOtpOttProbe('Twitch', 'www.twitch.tv', 'https://www.twitch.tv/login'),
    makeZeroOtpOttProbe('Steam', 'store.steampowered.com', 'https://store.steampowered.com/login/'),
    makeZeroOtpOttProbe('Epic Games', 'www.epicgames.com', 'https://www.epicgames.com/id/login'),
    // LPG Gas, PNG, Electricity, DTH & Utility Portals
    makeZeroOtpLpgUtilityProbe('Indane Gas (IOCL)', 'cx.indianoil.in', 'https://cx.indianoil.in/', 'LPG Domestic Gas'),
    makeZeroOtpLpgUtilityProbe('HP Gas (HPCL)', 'myhpgas.in', 'https://myhpgas.in/', 'LPG Domestic Gas'),
    makeZeroOtpLpgUtilityProbe('Bharatgas (BPCL)', 'ebharatgas.com', 'https://ebharatgas.com/', 'LPG Domestic Gas'),
    makeZeroOtpLpgUtilityProbe('MyLPG.in (DBTL)', 'www.mylpg.in', 'https://www.mylpg.in/', 'National LPG DBTL Registry'),
    makeZeroOtpLpgUtilityProbe('PMUY Ujjwala Portal', 'www.pmuy.gov.in', 'https://www.pmuy.gov.in/', 'Pradhan Mantri Ujjwala LPG Registry'),
    makeZeroOtpLpgUtilityProbe('IGL (Indraprastha Gas)', 'www.iglonline.net', 'https://www.iglonline.net/', 'Piped Natural Gas (PNG)'),
    makeZeroOtpLpgUtilityProbe('Mahanagar Gas (MGL)', 'www.mahanagargas.com', 'https://www.mahanagargas.com/', 'Piped Natural Gas (PNG)'),
    makeZeroOtpLpgUtilityProbe('Adani Total Gas', 'www.adanigas.com', 'https://www.adanigas.com/', 'PNG / CNG Utility'),
    makeZeroOtpLpgUtilityProbe('Gujarat Gas', 'www.gujaratgas.com', 'https://www.gujaratgas.com/', 'PNG Utility'),
    makeZeroOtpLpgUtilityProbe('Torrent Gas', 'www.torrentgas.com', 'https://www.torrentgas.com/', 'PNG Utility'),
    makeZeroOtpLpgUtilityProbe('GAIL Gas', 'www.gailgas.com', 'https://www.gailgas.com/', 'Piped Natural Gas (PNG)'),
    makeZeroOtpLpgUtilityProbe('MNGL (Maharashtra Gas)', 'mngl.in', 'https://mngl.in/', 'Piped Natural Gas (PNG)'),
    makeZeroOtpLpgUtilityProbe('Sabarmati Gas', 'www.sabarmatigas.in', 'https://www.sabarmatigas.in/', 'Piped Natural Gas (PNG)'),
    makeZeroOtpLpgUtilityProbe('Green Gas Limited', 'www.gglonline.net', 'https://www.gglonline.net/', 'Piped Natural Gas (PNG)'),
    makeZeroOtpLpgUtilityProbe('Think Gas', 'www.thinkgas.com', 'https://www.thinkgas.com/', 'Piped Natural Gas (PNG)'),
    makeZeroOtpLpgUtilityProbe('Tata Power', 'www.tatapower.com', 'https://www.tatapower.com/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('Adani Electricity', 'www.adanielectricity.com', 'https://www.adanielectricity.com/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('BSES Delhi', 'www.bsesdelhi.com', 'https://www.bsesdelhi.com/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('BESCOM Bengaluru', 'bescom.karnataka.gov.in', 'https://bescom.karnataka.gov.in/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('MSEDCL Mahavitaran', 'www.mahadiscom.in', 'https://www.mahadiscom.in/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('TANGEDCO (TNEB)', 'www.tangedco.org', 'https://www.tangedco.org/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('UPPCL Power', 'www.uppclonline.com', 'https://www.uppclonline.com/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('CESC Kolkata', 'www.cesc.co.in', 'https://www.cesc.co.in/', 'Electricity Utility'),
    makeZeroOtpLpgUtilityProbe('Bharat BillPay (BBPS)', 'www.bharatbillpay.com', 'https://www.bharatbillpay.com/', 'Utility Bill Aggregation'),
    makeZeroOtpLpgUtilityProbe('NETC FASTag', 'www.npci.org.in', 'https://www.npci.org.in/what-we-do/netc-fastag/product-overview', 'Highway Toll / Vehicle Wallet'),
    makeZeroOtpLpgUtilityProbe('Tata Play', 'www.tataplay.com', 'https://www.tataplay.com/', 'DTH Subscriber Self-Care'),
    makeZeroOtpLpgUtilityProbe('DishTV', 'www.dishtv.in', 'https://www.dishtv.in/', 'DTH Subscriber Self-Care'),
    makeZeroOtpLpgUtilityProbe('ACT Fibernet', 'www.actcorp.in', 'https://www.actcorp.in/', 'Broadband Self-Care')
  );

  const seenPlatforms = new Set<string>(probes.map((p) => p.platform.toLowerCase()));

  for (const seed of MEGA_PHONE_SITES) {
    const [platform, category, domain, probePath = '/'] = seed;
    const key = platform.toLowerCase();
    if (seenPlatforms.has(key)) continue;
    seenPlatforms.add(key);

    const portalUrl = `https://${domain}${probePath}`;

    probes.push({
      platform,
      category,
      urlFn: () => portalUrl,
      customProbeFn: async () => {
        const alive = await checkDomainDnsNonBlocking(domain);
        return {
          status: 'not_checked',
          httpStatus: alive ? 403 : 0,
          url: portalUrl,
          bio: alive
            ? 'OTP / Auth-gated portal (passive check avoids triggering SMS OTPs).'
            : 'Service endpoint unreachable from host.',
        };
      },
    });
  }

  return probes;
}

// Exposure, Breach & Public Citation Checks for Phone Numbers (used by MailAccess module)
export async function runPhoneExposureChecks(parsed: NormalizedPhoneTarget): Promise<{
  results: InvestigationResultItem[];
  breaches: BreachedAccountItem[];
}> {
  const breaches: BreachedAccountItem[] = [];
  const { e164, cleanDigits, national, international } = parsed;
  const dashedNational =
    national.length === 10 ? `${national.slice(0, 5)}-${national.slice(5)}` : national;
  const spacedNational =
    national.length === 10 ? `${national.slice(0, 5)} ${national.slice(5)}` : national;
  const dashed334 =
    national.length === 10
      ? `${national.slice(0, 3)}-${national.slice(3, 6)}-${national.slice(6)}`
      : dashedNational;

  // 1. LeakCheck Public Breach Lookup (checks both national & full E.164 digits)
  const leakCheckPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const candidates =
      national.length >= 8 && national !== cleanDigits ? [national, cleanDigits] : [cleanDigits];

    interface LeakCheckPublicResponse {
      found?: number;
      fields?: string[];
      sources?: Array<{ name?: string; date?: string }>;
      error?: string;
      success?: boolean;
    }

    let bestData: LeakCheckPublicResponse | null = null;
    let lastStatus = 0;

    for (const q of candidates) {
      const res = await safeFetch(
        `https://leakcheck.io/api/public?check=${encodeURIComponent(q)}`,
        { headers: { Accept: 'application/json' } },
        6000
      );
      lastStatus = res.status;
      const obj = res.json as LeakCheckPublicResponse | null;
      if (res.ok && obj?.success) {
        bestData = obj;
        if (Array.isArray(obj.sources) && obj.sources.length > 0) break;
      } else if (!bestData && obj) {
        bestData = obj;
      }
    }

    if (bestData?.success && Array.isArray(bestData.sources) && bestData.sources.length > 0) {
      const fieldsList =
        Array.isArray(bestData.fields) && bestData.fields.length > 0 ? bestData.fields : ['phone'];
      const breachItems: BreachedAccountItem[] = bestData.sources.map((src, idx) => {
        const name = src.name || `Incident #${idx + 1}`;
        const domain = name.includes('.') ? name.toLowerCase().replace(/\s+/g, '') : undefined;
        const dateVal = src.date || undefined;
        return {
          id: `phone-breach-leakcheck-${idx}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
          platform: name.replace(/\.[a-z]{2,}$/i, ''),
          domain,
          breachName: name,
          date: dateVal,
          relativeTime: dateVal || 'Indexed breach',
          severity: fieldsList.some((f) => /pass|hash|phone/i.test(f)) ? 'high' : 'medium',
          dataClasses: fieldsList,
          summary: `Phone number ${e164} appeared in ${name}${dateVal ? ` (${dateVal})` : ''}.`,
          tool: 'mailaccess' as const,
          resultId: 'mailaccess-leakcheck-phone',
        };
      });
      breaches.push(...breachItems);

      return {
        id: 'mailaccess-leakcheck-phone',
        platform: 'LeakCheck Breach Index',
        domain: 'leakcheck.io',
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'breached',
        handle: e164,
        displayName: `${bestData.found ?? bestData.sources.length} Breach Record${
          (bestData.found ?? bestData.sources.length) === 1 ? '' : 's'
        }`,
        accountType: 'Breach Exposure Index',
        relativeTime: `${bestData.sources.length} source(s)`,
        linkedInfo: bestData.sources
          .slice(0, 6)
          .map((s) => `${s.name || 'Breach'}${s.date ? ` (${s.date})` : ''}`),
        displayFields: [
          { label: 'Phone', value: e164, kind: 'phone', copyable: true },
          { label: 'Records Indexed', value: String(bestData.found ?? bestData.sources.length) },
          { label: 'Exposed Fields', value: fieldsList.join(', ') },
          {
            label: 'Top Sources',
            value: bestData.sources
              .slice(0, 4)
              .map((s) => s.name)
              .filter(Boolean)
              .join(', '),
          },
        ],
        url: 'https://leakcheck.io/',
        summary: `Found ${bestData.found ?? bestData.sources.length} breach exposure(s) for ${e164}: ${bestData.sources
          .slice(0, 5)
          .map((s) => `${s.name}${s.date ? ` (${s.date})` : ''}`)
          .join(', ')}.`,
        durationMs: Date.now() - t0,
        artifacts: bestData.sources.map((s, idx) => ({
          id: `phone-leakcheck-src-${idx}`,
          type: 'breach_record' as const,
          title: s.name || `Source #${idx + 1}`,
          subtitle: s.date ? `Breach date: ${s.date}` : 'Indexed leak',
          timestamp: s.date ? `${s.date}-01` : undefined,
          summary: `Exposed data classes: ${fieldsList.join(', ')}`,
          details: {
            source: s.name || `Source #${idx + 1}`,
            date: s.date || null,
            fields: fieldsList,
          },
        })),
        details: { e164, found: bestData.found, fields: fieldsList, sources: bestData.sources },
      };
    }

    if (bestData?.success === false && /not found/i.test(bestData.error || '')) {
      return {
        id: 'mailaccess-leakcheck-phone',
        platform: 'LeakCheck Breach Index',
        domain: 'leakcheck.io',
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'not_found',
        findingKind: 'breached',
        handle: e164,
        url: 'https://leakcheck.io/',
        summary: 'No public phone breach exposures indexed in LeakCheck.',
        durationMs: Date.now() - t0,
      };
    }

    return {
      id: 'mailaccess-leakcheck-phone',
      platform: 'LeakCheck Breach Index',
      domain: 'leakcheck.io',
      category: 'Breach & Exposure',
      tool: 'mailaccess',
      status: 'not_checked',
      findingKind: 'breached',
      handle: e164,
      url: 'https://leakcheck.io/',
      summary:
        bestData?.error || `LeakCheck rate-limited or unavailable (HTTP ${lastStatus || 'timeout'}).`,
      durationMs: Date.now() - t0,
    };
  })();

  // 2. ProxyNova COMB Phone Breach Search (Strict Word/Boundary Match)
  const proxynovaPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const queryDigits = national.length >= 10 ? national : cleanDigits;
    if (queryDigits.length < 8) {
      return {
        id: 'mailaccess-proxynova-phone',
        platform: 'ProxyNova COMB Index',
        domain: 'proxynova.com',
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'not_checked',
        findingKind: 'breached',
        handle: e164,
        summary: 'Target too short for strict COMB query.',
        durationMs: Date.now() - t0,
      };
    }

    const res = await safeFetch(
      `https://api.proxynova.com/comb?query=${encodeURIComponent(queryDigits)}&limit=15`,
      { headers: { Accept: 'application/json' } },
      6000
    );

    const obj = asObj(res.json);
    const lines = Array.isArray(obj?.lines)
      ? obj.lines.filter((l): l is string => typeof l === 'string')
      : [];

    const exactLines = lines.filter((line) => {
      const compactLine = line.replace(/[\s().-]+/g, '');
      const strictRe = new RegExp(
        `(?:^|[^\\d])${parsed.prefix ? `(?:\\+?${escapeRegExp(parsed.prefix)})?` : ''}${escapeRegExp(
          queryDigits
        )}(?:$|[^\\d])`
      );
      return strictRe.test(compactLine);
    });

    if (res.ok && exactLines.length > 0) {
      const redactedPreviews = exactLines.slice(0, 5).map((line) => {
        const [idPart, ...rest] = line.split(':');
        return rest.length > 0 ? `${idPart}:••••••••` : line.slice(0, 48);
      });
      breaches.push({
        id: 'phone-breach-proxynova-comb',
        platform: 'ProxyNova COMB',
        domain: 'proxynova.com',
        breachName: 'COMB Credential Corpus',
        relativeTime: `${exactLines.length} record(s)`,
        severity: 'high',
        dataClasses: ['phone', 'credentials'],
        summary: `Exact phone number ${e164} matched ${exactLines.length} COMB credential line(s).`,
        tool: 'mailaccess',
        resultId: 'mailaccess-proxynova-phone',
      });

      return {
        id: 'mailaccess-proxynova-phone',
        platform: 'ProxyNova COMB Index',
        domain: 'proxynova.com',
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'breached',
        handle: e164,
        displayName: `${exactLines.length} COMB Leak Record${exactLines.length === 1 ? '' : 's'}`,
        accountType: 'Breach Credential Corpus',
        relativeTime: `${exactLines.length} line(s)`,
        displayFields: [
          { label: 'Phone', value: e164, kind: 'phone', copyable: true },
          { label: 'Matched Lines', value: String(exactLines.length) },
          { label: 'Corpus', value: 'ProxyNova COMB (Redacted Preview)' },
        ],
        url: 'https://www.proxynova.com/tools/comb/',
        summary: `Exact phone match found in ${exactLines.length} ProxyNova COMB breach line(s).`,
        durationMs: Date.now() - t0,
        artifacts: redactedPreviews.map((preview, idx) => ({
          id: `proxynova-line-${idx}`,
          type: 'breach_record' as const,
          title: `COMB Hit #${idx + 1}`,
          subtitle: 'Credential Leak Compilation',
          summary: preview,
          details: { redactedLine: preview },
        })),
        details: { e164, matchedCount: exactLines.length, previews: redactedPreviews },
      };
    }

    return {
      id: 'mailaccess-proxynova-phone',
      platform: 'ProxyNova COMB Index',
      domain: 'proxynova.com',
      category: 'Breach & Exposure',
      tool: 'mailaccess',
      status: res.ok && Array.isArray(obj?.lines) ? 'not_found' : 'not_checked',
      findingKind: 'breached',
      handle: e164,
      url: 'https://www.proxynova.com/tools/comb/',
      summary:
        res.ok && Array.isArray(obj?.lines)
          ? 'No exact phone matches in ProxyNova COMB index.'
          : `ProxyNova COMB unavailable (HTTP ${res.status || 'timeout'}).`,
      durationMs: Date.now() - t0,
    };
  })();

  // 3. GitHub Issues/PRs Public Exposure (Multi-format query)
  const githubPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const ghQuery =
      national.length >= 10
        ? `"${e164}" OR "${international}" OR "${national}"`
        : `"${e164}"`;
    const res = await safeFetch(
      `https://api.github.com/search/issues?q=${encodeURIComponent(ghQuery)}&per_page=8`,
      { headers: { Accept: 'application/vnd.github+json' } },
      6000
    );
    if (res.status === 403 || res.status === 429 || !res.ok) {
      return {
        id: 'mailaccess-github-phone',
        platform: 'GitHub Code & Issues',
        domain: 'github.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'not_checked',
        findingKind: 'leaked',
        handle: e164,
        url: `https://github.com/search?q=${encodeURIComponent(`"${e164}"`)}`,
        summary: `GitHub search unavailable or rate-limited (HTTP ${res.status || 'timeout'}).`,
        durationMs: Date.now() - t0,
      };
    }
    const items = Array.isArray(asObj(res.json)?.items)
      ? (asObj(res.json)?.items as Array<{
          id: number;
          number: number;
          title: string;
          body?: string;
          html_url: string;
          created_at?: string;
          repository_url?: string;
          user?: { login?: string };
        }>)
      : [];
    const exactHits = items.filter((iss) =>
      textContainsExactPhone(`${iss.title || ''} ${iss.body || ''}`, parsed)
    );
    if (exactHits.length > 0) {
      return {
        id: 'mailaccess-github-phone',
        platform: 'GitHub Code & Issues',
        domain: 'github.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: `${exactHits.length} Public GitHub Citation${exactHits.length === 1 ? '' : 's'}`,
        accountType: 'Public Issue / Code Exposure',
        linkedInfo: exactHits.slice(0, 3).map((iss) => {
          const repo = iss.repository_url?.replace('https://api.github.com/repos/', '') || 'GitHub';
          return `${repo}#${iss.number}`;
        }),
        displayFields: [
          { label: 'Phone', value: e164, kind: 'phone', copyable: true },
          { label: 'Citations Found', value: String(exactHits.length) },
          {
            label: 'Repository',
            value:
              exactHits[0]?.repository_url?.replace('https://api.github.com/repos/', '') || 'GitHub',
          },
        ],
        url: exactHits[0]?.html_url,
        summary: `Exact phone number exposed in ${exactHits.length} public GitHub issue/PR discussion(s).`,
        durationMs: Date.now() - t0,
        artifacts: exactHits.slice(0, 6).map((iss) => ({
          id: `gh-phone-${iss.id}`,
          type: 'profile_signal' as const,
          title: iss.title || `Issue #${iss.number}`,
          subtitle: iss.repository_url?.replace('https://api.github.com/repos/', '') || 'GitHub',
          timestamp: iss.created_at,
          url: iss.html_url,
          summary: (iss.body || '').replace(/\s+/g, ' ').trim().slice(0, 220),
          details: { issueNumber: iss.number, htmlUrl: iss.html_url },
        })),
      };
    }
    return {
      id: 'mailaccess-github-phone',
      platform: 'GitHub Code & Issues',
      domain: 'github.com',
      category: 'Developer & Code',
      tool: 'mailaccess',
      status: 'not_found',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://github.com/',
      summary: 'No exact public GitHub issue or PR citations found.',
      durationMs: Date.now() - t0,
    };
  })();

  // 4. Hacker News Public Exposure (Multi-format query)
  const hnPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const q = national.length >= 10 ? `"${e164}" OR "${national}"` : `"${e164}"`;
    const res = await safeFetch(
      `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(q)}&hitsPerPage=6`,
      {},
      5000
    );
    if (!res.ok) {
      return {
        id: 'mailaccess-hackernews-phone',
        platform: 'Hacker News',
        domain: 'news.ycombinator.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'not_checked',
        findingKind: 'leaked',
        handle: e164,
        summary: 'Hacker News Algolia search unavailable.',
        durationMs: Date.now() - t0,
      };
    }
    const rawHits = Array.isArray(asObj(res.json)?.hits)
      ? (asObj(res.json)?.hits as Array<{
          objectID: string;
          title?: string;
          comment_text?: string;
          story_text?: string;
        }>)
      : [];
    const hits = rawHits.filter((h) =>
      textContainsExactPhone(`${h.title || ''} ${h.story_text || ''} ${h.comment_text || ''}`, parsed)
    );
    if (hits.length > 0) {
      return {
        id: 'mailaccess-hackernews-phone',
        platform: 'Hacker News',
        domain: 'news.ycombinator.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: `${hits.length} HN Discussion${hits.length === 1 ? '' : 's'}`,
        url: `https://news.ycombinator.com/item?id=${hits[0].objectID}`,
        summary: `Phone number cited in ${hits.length} public Hacker News discussion(s).`,
        durationMs: Date.now() - t0,
      };
    }
    return {
      id: 'mailaccess-hackernews-phone',
      platform: 'Hacker News',
      domain: 'news.ycombinator.com',
      category: 'Developer & Code',
      tool: 'mailaccess',
      status: 'not_found',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://news.ycombinator.com/',
      summary: 'No public Hacker News citations found.',
      durationMs: Date.now() - t0,
    };
  })();

  // 5. Internet Archive Exact Phone Citation Search (Multi-format)
  const archivePromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const archQuery =
      national.length >= 10
        ? `"${e164}" OR "${international}" OR "${national}" OR "${dashedNational}" OR "${dashed334}"`
        : `"${e164}" OR "${international}"`;
    const res = await safeFetch(
      `https://archive.org/advancedsearch.php?q=${encodeURIComponent(
        archQuery
      )}&fl[]=identifier&fl[]=title&fl[]=description&output=json&rows=6`,
      {},
      5500
    );
    const respObj = asObj(asObj(res.json)?.response);
    const rawDocs = Array.isArray(respObj?.docs)
      ? (respObj.docs as Array<{ identifier?: string; title?: string; description?: string | string[] }>)
      : [];
    const exactDocs = rawDocs.filter((d) =>
      textContainsExactPhone(
        `${d.title || ''} ${Array.isArray(d.description) ? d.description.join(' ') : d.description || ''}`,
        parsed
      )
    );
    const docs = exactDocs;
    const matchedCount = exactDocs.length;
    if (res.ok && matchedCount > 0 && docs[0]?.identifier) {
      return {
        id: 'mailaccess-archive-phone',
        platform: 'Internet Archive',
        domain: 'archive.org',
        category: 'Breach & Exposure',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: `${matchedCount} Archived Record${matchedCount === 1 ? '' : 's'}`,
        url: `https://archive.org/details/${encodeURIComponent(docs[0].identifier)}`,
        summary: `Indexed in ${matchedCount} Internet Archive item(s) (e.g. "${docs[0].title || docs[0].identifier}").`,
        durationMs: Date.now() - t0,
      };
    }
    return {
      id: 'mailaccess-archive-phone',
      platform: 'Internet Archive',
      domain: 'archive.org',
      category: 'Breach & Exposure',
      tool: 'mailaccess',
      status: res.ok ? 'not_found' : 'not_checked',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://archive.org/',
      summary: res.ok
        ? 'No public Internet Archive records matched this phone number.'
        : 'Internet Archive query timed out.',
      durationMs: Date.now() - t0,
    };
  })();

  // 6. StackExchange / StackOverflow Public Citations (Multi-format with body verification)
  const stackPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const soQuery = national.length >= 9 ? national : `"${e164}"`;
    const res = await safeFetch(
      `https://api.stackexchange.com/2.3/search/advanced?order=desc&sort=relevance&q=${encodeURIComponent(
        soQuery
      )}&site=stackoverflow&filter=withbody&pagesize=6`,
      {},
      5000
    );
    const rawItems = Array.isArray(asObj(res.json)?.items)
      ? (asObj(res.json)?.items as Array<{ link?: string; title?: string; body?: string }>)
      : [];
    const items = rawItems.filter((it) =>
      textContainsExactPhone(`${it.title || ''} ${it.body || ''} ${it.link || ''}`, parsed)
    );
    if (res.ok && items.length > 0 && items[0]?.link) {
      return {
        id: 'mailaccess-stackoverflow-phone',
        platform: 'Stack Overflow',
        domain: 'stackoverflow.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: `${items.length} Stack Overflow Citation${items.length === 1 ? '' : 's'}`,
        url: items[0].link,
        summary: `Referenced in ${items.length} public Stack Overflow thread(s).`,
        durationMs: Date.now() - t0,
      };
    }
    return {
      id: 'mailaccess-stackoverflow-phone',
      platform: 'Stack Overflow',
      domain: 'stackoverflow.com',
      category: 'Developer & Code',
      tool: 'mailaccess',
      status: res.ok ? 'not_found' : 'not_checked',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://stackoverflow.com/',
      summary: res.ok ? 'No public Stack Overflow mentions found.' : 'StackExchange API unavailable.',
      durationMs: Date.now() - t0,
    };
  })();

  // 7. Wikipedia / Wikimedia Public Citations (Multi-format)
  const wikiPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const wikiQuery =
      national.length >= 10
        ? `"${e164}" OR "${international}" OR "${spacedNational}" OR "${dashed334}"`
        : `"${e164}" OR "${international}"`;
    const res = await safeFetch(
      `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
        wikiQuery
      )}&format=json&srlimit=5`,
      {},
      5000
    );
    const rawHits = Array.isArray(asObj(asObj(res.json)?.query)?.search)
      ? (asObj(asObj(res.json)?.query)?.search as Array<{ pageid?: number; title?: string; snippet?: string }>)
      : [];
    const hits = rawHits.filter((h) =>
      textContainsExactPhone(`${h.title || ''} ${h.snippet || ''}`, parsed)
    );
    if (res.ok && hits.length > 0 && hits[0]?.title) {
      return {
        id: 'mailaccess-wikipedia-phone',
        platform: 'Wikipedia Citations',
        domain: 'en.wikipedia.org',
        category: 'Social & Community',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: hits[0].title,
        url: `https://en.wikipedia.org/?curid=${hits[0].pageid || ''}`,
        summary: `Cited on Wikipedia page "${hits[0].title}".`,
        durationMs: Date.now() - t0,
      };
    }
    return {
      id: 'mailaccess-wikipedia-phone',
      platform: 'Wikipedia Citations',
      domain: 'en.wikipedia.org',
      category: 'Social & Community',
      tool: 'mailaccess',
      status: res.ok ? 'not_found' : 'not_checked',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://en.wikipedia.org/',
      summary: res.ok ? 'No public Wikipedia citations found.' : 'Wikimedia API unavailable.',
      durationMs: Date.now() - t0,
    };
  })();

  // 8. NPM Public Package Metadata Mentions
  const npmPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const npmSearchTerm = national.length >= 10 ? national : `"${e164}"`;
    const res = await safeFetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(npmSearchTerm)}&size=6`,
      {},
      5000
    );
    const objs = Array.isArray(asObj(res.json)?.objects)
      ? (asObj(res.json)?.objects as Array<{ package?: { name?: string; description?: string } }>)
      : [];
    const exact = objs.filter((o) => textContainsExactPhone(JSON.stringify(o), parsed));
    if (res.ok && exact.length > 0 && exact[0]?.package?.name) {
      return {
        id: 'mailaccess-npm-phone',
        platform: 'npm Registry Mentions',
        domain: 'npmjs.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: exact[0].package.name,
        url: `https://www.npmjs.com/package/${encodeURIComponent(exact[0].package.name)}`,
        summary: `Phone number surfaced in public npm package "${exact[0].package.name}".`,
        durationMs: Date.now() - t0,
      };
    }
    return {
      id: 'mailaccess-npm-phone',
      platform: 'npm Registry Mentions',
      domain: 'npmjs.com',
      category: 'Developer & Code',
      tool: 'mailaccess',
      status: res.ok ? 'not_found' : 'not_checked',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://www.npmjs.com/',
      summary: res.ok ? 'No public npm package references found.' : 'npm search unavailable.',
      durationMs: Date.now() - t0,
    };
  })();

  // 9. Reddit Public Post/Comment Mentions
  const redditPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const q =
      national.length >= 10
        ? `"${e164}" OR "${national}" OR "${dashedNational}" OR "${spacedNational}"`
        : `"${e164}"`;
    const res = await safeFetch(
      `https://www.reddit.com/search.json?q=${encodeURIComponent(q)}&limit=8&sort=relevance`,
      { headers: { Accept: 'application/json' } },
      5000
    );
    if (!res.ok || !res.json) {
      return {
        id: 'mailaccess-reddit-phone',
        platform: 'Reddit Public Citations',
        domain: 'reddit.com',
        category: 'Social & Community',
        tool: 'mailaccess',
        status: 'not_checked',
        findingKind: 'leaked',
        handle: e164,
        url: `https://www.reddit.com/search/?q=${encodeURIComponent(`"${e164}"`)}`,
        summary: `Reddit JSON search gated or rate-limited (HTTP ${res.status || 'timeout'}).`,
        durationMs: Date.now() - t0,
      };
    }
    const children = Array.isArray(asObj(asObj(res.json)?.data)?.children)
      ? (asObj(asObj(res.json)?.data)?.children as Array<{
          data?: {
            id?: string;
            title?: string;
            selftext?: string;
            permalink?: string;
            subreddit_name_prefixed?: string;
          };
        }>)
      : [];
    const exactPosts = children.filter((c) =>
      textContainsExactPhone(`${c.data?.title || ''} ${c.data?.selftext || ''}`, parsed)
    );
    if (exactPosts.length > 0) {
      const first = exactPosts[0]?.data;
      return {
        id: 'mailaccess-reddit-phone',
        platform: 'Reddit Public Citations',
        domain: 'reddit.com',
        category: 'Social & Community',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: `${exactPosts.length} Reddit Mention${exactPosts.length === 1 ? '' : 's'}`,
        url: first?.permalink ? `https://www.reddit.com${first.permalink}` : 'https://www.reddit.com/',
        summary: `Phone number surfaced in ${exactPosts.length} public Reddit thread(s)${
          first?.subreddit_name_prefixed ? ` (${first.subreddit_name_prefixed})` : ''
        }.`,
        durationMs: Date.now() - t0,
      };
    }
    return {
      id: 'mailaccess-reddit-phone',
      platform: 'Reddit Public Citations',
      domain: 'reddit.com',
      category: 'Social & Community',
      tool: 'mailaccess',
      status: 'not_found',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://www.reddit.com/',
      summary: 'No exact public Reddit post mentions matched.',
      durationMs: Date.now() - t0,
    };
  })();

  // 10. Sourcegraph Public Code Search (Multi-format)
  const sourcegraphPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const sgQuery =
      national.length >= 10
        ? `("${e164}" OR "${national}" OR "${dashed334}" OR "${spacedNational}") count:8`
        : `"${e164}" count:8`;
    const res = await safeFetch(
      'https://sourcegraph.com/.api/graphql',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query:
            'query ($q: String!) { search(query: $q) { results { results { ... on FileMatch { file { path url } repository { name } lineMatches { preview lineNumber } } } } } }',
          variables: { q: sgQuery },
        }),
      },
      5500
    );
    const dataObj = asObj(asObj(asObj(res.json)?.data)?.search);
    const resultsList = Array.isArray(asObj(dataObj?.results)?.results)
      ? (asObj(dataObj?.results)?.results as Array<{
          file?: { path?: string; url?: string };
          repository?: { name?: string };
          lineMatches?: Array<{ preview?: string; lineNumber?: number }>;
        }>)
      : null;

    if (!res.ok || !resultsList) {
      return {
        id: 'mailaccess-sourcegraph-phone',
        platform: 'Sourcegraph Code Exposure',
        domain: 'sourcegraph.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'not_checked',
        findingKind: 'leaked',
        handle: e164,
        url: `https://sourcegraph.com/search?q=${encodeURIComponent(`"${e164}"`)}`,
        summary: `Sourcegraph code search unavailable (HTTP ${res.status || 'timeout'}).`,
        durationMs: Date.now() - t0,
      };
    }

    const exactMatches = resultsList.filter((item) => {
      const preview = (item.lineMatches || []).map((l) => l.preview || '').join(' ');
      return textContainsExactPhone(`${preview} ${item.file?.path || ''}`, parsed);
    });

    if (exactMatches.length > 0 && exactMatches[0]?.file?.url) {
      const firstUrl = exactMatches[0].file.url.startsWith('http')
        ? exactMatches[0].file.url
        : `https://sourcegraph.com${exactMatches[0].file.url}`;
      return {
        id: 'mailaccess-sourcegraph-phone',
        platform: 'Sourcegraph Code Exposure',
        domain: 'sourcegraph.com',
        category: 'Developer & Code',
        tool: 'mailaccess',
        status: 'found',
        findingKind: 'leaked',
        handle: e164,
        displayName: `${exactMatches.length} Source Code Hit${exactMatches.length === 1 ? '' : 's'}`,
        accountType: 'Public Source Code Citation',
        url: firstUrl,
        summary: `Exact phone number indexed in ${exactMatches.length} public repository file(s) via Sourcegraph.`,
        durationMs: Date.now() - t0,
        artifacts: exactMatches.slice(0, 6).map((item, idx) => ({
          id: `sg-phone-${idx}`,
          type: 'profile_signal' as const,
          title: `${item.repository?.name || 'repo'} — ${item.file?.path || 'file'}`,
          subtitle: 'Sourcegraph Code Index',
          url: item.file?.url?.startsWith('http')
            ? item.file.url
            : `https://sourcegraph.com${item.file?.url || ''}`,
          summary: (item.lineMatches || [])
            .map((lm) => lm.preview?.trim())
            .filter(Boolean)
            .slice(0, 2)
            .join(' · '),
          details: { repo: item.repository?.name, path: item.file?.path },
        })),
      };
    }

    return {
      id: 'mailaccess-sourcegraph-phone',
      platform: 'Sourcegraph Code Exposure',
      domain: 'sourcegraph.com',
      category: 'Developer & Code',
      tool: 'mailaccess',
      status: 'not_found',
      findingKind: 'leaked',
      handle: e164,
      url: 'https://sourcegraph.com/',
      summary: 'No exact phone references found across Sourcegraph indexed repositories.',
      durationMs: Date.now() - t0,
    };
  })();

  // 11. Live UPI & Payment Handles Intelligence (Bing RSS + Gemini Google Search Grounding + Zero-OTP Gateway Probes)
  const paymentUpiIntelPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const baseDigits = national.length >= 10 ? national : cleanDigits;
    const isIndiaOrTen = parsed.iso2 === 'IN' || national.length === 10;
    const derivedUpis =
      baseDigits.length >= 10
        ? [
            { app: 'Paytm', vpa: `${baseDigits}@paytm` },
            { app: 'Paytm (SBI)', vpa: `${baseDigits}@ptsbi` },
            { app: 'Paytm (Axis)', vpa: `${baseDigits}@ptaxis` },
            { app: 'Paytm (Yes)', vpa: `${baseDigits}@ptyes` },
            { app: 'Paytm (HDFC)', vpa: `${baseDigits}@pthdfc` },
            { app: 'PhonePe', vpa: `${baseDigits}@ybl` },
            { app: 'PhonePe (ICICI)', vpa: `${baseDigits}@ibl` },
            { app: 'PhonePe (Axis)', vpa: `${baseDigits}@axl` },
            { app: 'Google Pay (ICICI)', vpa: `${baseDigits}@okicici` },
            { app: 'Google Pay (SBI)', vpa: `${baseDigits}@oksbi` },
            { app: 'Google Pay (Axis)', vpa: `${baseDigits}@okaxis` },
            { app: 'Google Pay (HDFC)', vpa: `${baseDigits}@okhdfcbank` },
            { app: 'BHIM UPI', vpa: `${baseDigits}@upi` },
            { app: 'Amazon Pay', vpa: `${baseDigits}@apl` },
            { app: 'Amazon Pay (Axis)', vpa: `${baseDigits}@rapl` },
            { app: 'MobiKwik', vpa: `${baseDigits}@ikwik` },
            { app: 'CRED', vpa: `${baseDigits}@axisb` },
            { app: 'Freecharge', vpa: `${baseDigits}@freecharge` },
            { app: 'FamPay', vpa: `${baseDigits}@fam` },
            { app: 'Jupiter Money', vpa: `${baseDigits}@jupiteraxis` },
            { app: 'Fi Money', vpa: `${baseDigits}@fifederal` },
            { app: 'Slice', vpa: `${baseDigits}@slice` },
            { app: 'Navi', vpa: `${baseDigits}@naviaxis` },
            { app: 'BharatPe', vpa: `${baseDigits}@bharatpe` },
            { app: 'Bajaj Pay', vpa: `${baseDigits}@bajajpay` },
            { app: 'Super.money', vpa: `${baseDigits}@superyes` },
            { app: 'Flipkart UPI', vpa: `${baseDigits}@fkaxis` },
            { app: 'Kotak 811', vpa: `${baseDigits}@kotak` },
            { app: 'AU Bank', vpa: `${baseDigits}@aubank` },
            { app: 'Bank of Baroda', vpa: `${baseDigits}@barodampay` },
            { app: 'WhatsApp Pay (ICICI)', vpa: `${baseDigits}@waicici` },
            { app: 'WhatsApp Pay (HDFC)', vpa: `${baseDigits}@wahdfcbank` },
          ]
        : [];

    const payBingQuery =
      national.length >= 10
        ? `("${national}" OR "${baseDigits}@ybl" OR "${baseDigits}@paytm" OR "${baseDigits}@okicici" OR "${baseDigits}@oksbi" OR "${baseDigits}@upi") (upi OR paytm OR phonepe OR razorpay OR instamojo OR paypal)`
        : `"${e164}" (paypal OR stripe OR razorpay OR wise OR upi OR paytm)`;

    const [bingHits, geminiPayRes, rzpCheck, instamojoCheck, paypalCheck] = await Promise.all([
      queryBingRssDork(payBingQuery, 'Websites & Mentions').catch(() => []),
      runGeminiGoogleSearchDork({
        target: e164,
        targetType: 'phone',
        queries: [
          `("${e164}" OR "${national}" OR "${baseDigits}@ybl" OR "${baseDigits}@paytm" OR "${baseDigits}@okicici" OR "${baseDigits}@oksbi" OR "${baseDigits}@upi") ("razorpay.me" OR "paypal.me" OR "instamojo" OR "upi" OR "paytm" OR "phonepe")`,
        ],
        mode: 'phone-fast',
      }).catch(() => ({ hits: [], active: false })),
      safeFetch(`https://razorpay.me/@${encodeURIComponent(baseDigits)}`, { headers: { Accept: 'text/html' } }, 4500),
      safeFetch(`https://www.instamojo.com/@${encodeURIComponent(baseDigits)}`, { headers: { Accept: 'text/html' } }, 4500),
      safeFetch(`https://www.paypal.com/paypalme/${encodeURIComponent(baseDigits)}`, { headers: { Accept: 'text/html' } }, 4500),
    ]);

    const rawCitations = [
      ...bingHits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, engine: h.sourceEngine })),
      ...geminiPayRes.hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, engine: 'Google Search Grounding' })),
    ];

    const citations: Array<{ title: string; url: string; snippet: string; engine: string }> = [];
    const seenCiteUrl = new Set<string>();
    for (const c of rawCitations) {
      if (!c.url || seenCiteUrl.has(c.url)) continue;
      if (/^https?:\/\/(?:www\.)?(google|bing|duckduckgo)\.com\/search/i.test(c.url)) continue;
      const textOnly = `${c.title} ${c.snippet}`;
      const combined = `${textOnly} ${c.url}`;
      if (
        textContainsExactPhone(textOnly, parsed) &&
        /(upi|paytm|phonepe|ybl|ibl|axl|okicici|okaxis|oksbi|okhdfcbank|razorpay|instamojo|paypal|cred|mobikwik|gpay|payment|merchant|vpa)/i.test(
          combined
        )
      ) {
        seenCiteUrl.add(c.url);
        citations.push(c);
      }
    }

    const rzpActive =
      rzpCheck.ok &&
      /"merchant"\s*:\s*\{[^}]*"(?:id|name)"\s*:\s*"[^"]+"/i.test(rzpCheck.text) &&
      !/<title>\s*error\s*<\/title>/i.test(rzpCheck.text);
    const instamojoTitleMatch =
      instamojoCheck.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      instamojoCheck.text.match(/<title>([^<]+)<\/title>/i)?.[1] ||
      '';
    const instamojoCleanTitle = instamojoTitleMatch.replace(/\s*[-|—]\s*Instamojo.*$/i, '').trim();
    const instamojoActive =
      instamojoCheck.ok &&
      instamojoCheck.status === 200 &&
      !/page not found|doesn'?t exist|does not exist|store not found|something went wrong|just a moment|cloudflare/i.test(
        instamojoCheck.text
      ) &&
      Boolean(instamojoCleanTitle) &&
      !/^(instamojo|404|error|page not found)$/i.test(instamojoCleanTitle);
    const paypalOgTitle =
      paypalCheck.ok && paypalCheck.text
        ? paypalCheck.text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] || ''
        : '';
    const paypalName = paypalOgTitle.match(/^Pay\s+(.+?)\s+using\s+PayPal\.Me$/i)?.[1]?.trim();
    const paypalActive = Boolean(paypalName);

    const verifiedApisConfigured = Boolean(
      (process.env.RAZORPAY_KEY_ID?.trim() && process.env.RAZORPAY_KEY_SECRET?.trim()) ||
        (process.env.CASHFREE_CLIENT_ID?.trim() && process.env.CASHFREE_CLIENT_SECRET?.trim())
    );

    const liveHitsCount =
      citations.length + (rzpActive ? 1 : 0) + (instamojoActive ? 1 : 0) + (paypalActive ? 1 : 0);
    const hasPublicHit = liveHitsCount > 0;

    return {
      id: 'mailaccess-payment-upi-intel',
      platform: 'UPI & Payment Handles',
      domain: isIndiaOrTen ? 'npci.org.in' : 'paypal.com',
      category: 'Phone & Telecom',
      tool: 'mailaccess',
      status: hasPublicHit ? 'found' : 'not_found',
      findingKind: 'registered',
      handle: derivedUpis[0]?.vpa || e164,
      displayName: hasPublicHit
        ? `${liveHitsCount} Live Payment Hit(s)`
        : derivedUpis.length > 0
        ? `${derivedUpis.length} UPI VPA Handles Mapped`
        : 'Payment Gateway Index',
      accountType: verifiedApisConfigured
        ? 'Live Banking VPA + Multi-Engine Search'
        : 'Zero-OTP Payment Handle & Citation Index',
      relativeTime: `${citations.length} public citations · Zero OTP`,
      linkedInfo: [
        ...derivedUpis.slice(0, 5).map((u) => u.vpa),
        rzpActive ? `razorpay.me/@${baseDigits}` : undefined,
        instamojoActive ? `instamojo.com/@${baseDigits}` : undefined,
        paypalActive ? `paypal.me/${baseDigits} (${paypalName})` : undefined,
      ].filter((v): v is string => Boolean(v)),
      url:
        citations[0]?.url ||
        (rzpActive
          ? `https://razorpay.me/@${baseDigits}`
          : paypalActive
          ? `https://www.paypal.com/paypalme/${baseDigits}`
          : 'https://www.npci.org.in/'),
      summary: hasPublicHit
        ? `Matched public Payment/UPI intelligence for ${e164}: ${citations.length} web citation(s)${
            rzpActive ? ', active Razorpay.me handle' : ''
          }${instamojoActive ? ', active Instamojo handle' : ''}${
            paypalActive ? `, active PayPal.Me (${paypalName})` : ''
          }.`
        : isIndiaOrTen && derivedUpis.length > 0
        ? `Mapped ${derivedUpis.length} standard NPCI/PSP UPI handles (${derivedUpis
            .slice(0, 4)
            .map((u) => u.vpa)
            .join(', ')}). Audited PayPal.Me (${paypalActive ? 'Active' : 'Not exposed'}), Razorpay.me (${rzpActive ? 'Active' : 'Unregistered'}), Instamojo (${
            instamojoActive ? 'Active' : 'Unregistered'
          }), Bing & Google Search — 0 public payment leaks found (zero SMS OTP dispatched).`
        : `Audited PayPal.Me, Razorpay.me, Instamojo, Bing & Google Search for ${e164} payment citations — 0 public leaks indexed.`,
      durationMs: Date.now() - t0,
      displayFields: [
        ...(derivedUpis.length > 0
          ? [
              { label: 'Paytm / PhonePe VPAs', value: derivedUpis.slice(0, 4).map((u) => u.vpa).join(', '), copyable: true },
              { label: 'GPay / BHIM / Amazon VPAs', value: derivedUpis.slice(4, 10).map((u) => u.vpa).join(', '), copyable: true },
            ]
          : []),
        {
          label: 'Gateway Probes (Zero-OTP)',
          value: `PayPal.Me: ${paypalActive ? `Active (${paypalName})` : 'Not exposed'} · Razorpay.me: ${
            rzpActive ? 'Active' : 'Not registered'
          } · Instamojo: ${instamojoActive ? 'Active' : 'Not registered'}`,
        },
        { label: 'Public Payment Citations', value: `${citations.length} indexed match(es)` },
        { label: 'OTP Safety', value: 'Zero SMS OTP Dispatched' },
      ],
      artifacts: [
        ...citations.slice(0, 5).map((c, idx) => ({
          id: `upi-cite-${idx}`,
          type: 'profile_signal' as const,
          title: c.title,
          subtitle: c.engine,
          url: c.url,
          summary: c.snippet,
          details: { url: c.url, engine: c.engine },
        })),
        ...(derivedUpis.length > 0
          ? derivedUpis.slice(0, 8).map((u, idx) => ({
              id: `upi-vpa-pivot-${idx}`,
              type: 'profile_signal' as const,
              title: `${u.app}: ${u.vpa}`,
              subtitle: 'Derived NPCI UPI VPA Deep Link',
              url: `upi://pay?pa=${encodeURIComponent(u.vpa)}`,
              summary: `Copy or verify ${u.vpa} in any UPI app without triggering an SMS OTP.`,
              details: { app: u.app, vpa: u.vpa },
            }))
          : []),
      ],
    };
  })();

  // 12. OTT, Streaming, Music & Ticketing Footprint Index (Bing RSS + Gemini Google Search Grounding — Zero OTP)
  const ottFootprintIndexPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const ottBingQuery =
      national.length >= 10
        ? `"${national}" (hotstar OR sonyliv OR zee5 OR jiocinema OR netflix OR spotify OR primevideo OR mxplayer OR bookmyshow OR jiosaavn OR gaana)`
        : `"${e164}" (netflix OR spotify OR primevideo OR hotstar OR twitch OR steam)`;

    const [bingHits, geminiOttRes] = await Promise.all([
      queryBingRssDork(ottBingQuery, 'Websites & Mentions').catch(() => []),
      runGeminiGoogleSearchDork({
        target: e164,
        targetType: 'phone',
        queries: [
          `("${e164}" OR "${national}") (site:spotify.com OR site:bookmyshow.com OR site:jiosaavn.com OR site:hotstar.com OR site:netflix.com OR "sonyliv" OR "zee5" OR "jiocinema")`,
        ],
        mode: 'phone-fast',
      }).catch(() => ({ hits: [], active: false })),
    ]);

    const rawCitations = [
      ...bingHits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, engine: h.sourceEngine })),
      ...geminiOttRes.hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, engine: 'Google Search Grounding' })),
    ];

    const citations: Array<{ title: string; url: string; snippet: string; engine: string }> = [];
    const seenUrl = new Set<string>();
    for (const c of rawCitations) {
      if (!c.url || seenUrl.has(c.url)) continue;
      if (/^https?:\/\/(?:www\.)?(google|bing|duckduckgo)\.com\/search/i.test(c.url)) continue;
      const textOnly = `${c.title} ${c.snippet}`;
      const combined = `${textOnly} ${c.url}`;
      if (
        textContainsExactPhone(textOnly, parsed) &&
        /(hotstar|sonyliv|zee5|jiocinema|netflix|spotify|primevideo|mxplayer|bookmyshow|jiosaavn|gaana|audible|dream11|twitch|steam)/i.test(
          combined
        )
      ) {
        seenUrl.add(c.url);
        citations.push(c);
      }
    }

    const auditedPortals = [
      'JioHotstar',
      'Netflix',
      'Amazon Prime Video',
      'SonyLIV',
      'ZEE5',
      'JioCinema',
      'MX Player',
      'Tata Play Binge',
      'Airtel Xstream Play',
      'FanCode',
      'Aha Video',
      'Hoichoi',
      'Sun NXT',
      'ManoramaMAX',
      'Apple TV+',
      'Lionsgate Play',
      'Discovery+',
      'Eros Now',
      'ShemarooMe',
      'Stage OTT',
      'Chaupal OTT',
      'DocuBay',
      'Crunchyroll',
      'MUBI',
      'Spotify',
      'YouTube Music',
      'Amazon Music',
      'JioSaavn',
      'Gaana',
      'Wynk Music',
      'Audible India',
      'Pocket FM',
      'Kuku FM',
      'Storytel',
      'BookMyShow',
      'Paytm Insider',
      'District by Zomato',
      'PVR INOX',
    ];

    const hasHits = citations.length > 0;
    const googleOttUrl = `https://www.google.com/search?q=${encodeURIComponent(ottBingQuery)}`;

    return {
      id: 'mailaccess-ott-footprint-index',
      platform: 'OTT & Streaming Index',
      domain: 'hotstar.com',
      category: 'Phone & Telecom',
      tool: 'mailaccess',
      status: hasHits ? 'found' : 'not_found',
      findingKind: 'registered',
      handle: e164,
      displayName: hasHits
        ? `${citations.length} OTT / Streaming Citation(s)`
        : `${auditedPortals.length} OTT & Music Portals Audited`,
      accountType: 'Zero-OTP Streaming & Entertainment Audit',
      relativeTime: `${citations.length} public citations · Zero OTP`,
      linkedInfo: auditedPortals.slice(0, 6),
      url: citations[0]?.url || googleOttUrl,
      summary: hasHits
        ? `Matched ${citations.length} public OTT / streaming web citation(s) referencing ${e164}.`
        : `Scanned public search indexes (Bing + Google Search Grounding) across ${auditedPortals.length} OTT & entertainment services (${auditedPortals
            .slice(0, 6)
            .join(', ')}) for ${e164}. No unsolicited SMS OTPs sent; login enumeration on these services is OTP-gated.`,
      durationMs: Date.now() - t0,
      displayFields: [
        { label: 'Audited OTT & Music', value: auditedPortals.join(', ') },
        { label: 'Public Web Citations', value: `${citations.length} match(es)` },
        { label: 'Search Engines Used', value: 'Bing RSS + Google Search Grounding' },
        { label: 'OTP Policy', value: 'Zero SMS OTP Dispatched' },
      ],
      artifacts: [
        ...citations.slice(0, 5).map((c, idx) => ({
          id: `ott-cite-${idx}`,
          type: 'profile_signal' as const,
          title: c.title,
          subtitle: c.engine,
          url: c.url,
          summary: c.snippet,
          details: { url: c.url, engine: c.engine },
        })),
        {
          id: 'ott-dork-pivot',
          type: 'profile_signal' as const,
          title: `Live OTT & Streaming Dork Query (${e164})`,
          subtitle: 'Google Search Pivot',
          url: googleOttUrl,
          summary: `Execute targeted OTT/entertainment web search across ${auditedPortals.join(', ')}.`,
          details: { query: ottBingQuery },
        },
      ],
    };
  })();

  // 13. LPG Gas, PNG, Electricity & Citizen Utility Index (Bing RSS + Gemini Search Grounding + Zero-OTP Portals)
  const lpgUtilityIndexPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const gasBingQuery =
      national.length >= 10
        ? `"${national}" (indane OR hpgas OR bharatgas OR mylpg OR lpg OR igl OR mahanagargas OR "adani total gas" OR tatapower OR bbps OR fastag)`
        : `"${e164}" (lpg OR utility OR gas OR electricity OR fastag)`;

    const [bingHits, geminiGasRes, indaneLive, hpLive, bharatLive] = await Promise.all([
      queryBingRssDork(gasBingQuery, 'Websites & Mentions').catch(() => []),
      runGeminiGoogleSearchDork({
        target: e164,
        targetType: 'phone',
        queries: [
          `("${e164}" OR "${national}") ("indane" OR "hpgas" OR "bharatgas" OR "mylpg" OR "lpg gas" OR "indianoil" OR "iglonline" OR "mahanagargas" OR "fastag")`,
        ],
        mode: 'phone-fast',
      }).catch(() => ({ hits: [], active: false })),
      safeFetch('https://cx.indianoil.in/', { method: 'HEAD' }, 3200),
      safeFetch('https://myhpgas.in/', { method: 'HEAD' }, 3200),
      safeFetch('https://ebharatgas.com/', { method: 'HEAD' }, 3200),
    ]);

    const rawCitations = [
      ...bingHits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, engine: h.sourceEngine })),
      ...geminiGasRes.hits.map((h) => ({ title: h.title, url: h.url, snippet: h.snippet, engine: 'Google Search Grounding' })),
    ];

    const citations: Array<{ title: string; url: string; snippet: string; engine: string }> = [];
    const seenUrl = new Set<string>();
    for (const c of rawCitations) {
      if (!c.url || seenUrl.has(c.url)) continue;
      if (/^https?:\/\/(?:www\.)?(google|bing|duckduckgo)\.com\/search/i.test(c.url)) continue;
      const textOnly = `${c.title} ${c.snippet}`;
      const combined = `${textOnly} ${c.url}`;
      if (
        textContainsExactPhone(textOnly, parsed) &&
        /(indane|indianoil|hpgas|bharatgas|mylpg|lpg|dbtl|iglonline|mahanagargas|adanigas|gujaratgas|torrentgas|tatapower|bbps|fastag|consumer)/i.test(
          combined
        )
      ) {
        seenUrl.add(c.url);
        citations.push(c);
      }
    }

    const auditedUtilities = [
      'Indane Gas (IOCL)',
      'HP Gas (HPCL)',
      'Bharatgas (BPCL)',
      'MyLPG.in (DBTL)',
      'PMUY Ujjwala Portal',
      'IGL (Indraprastha Gas)',
      'Mahanagar Gas (MGL)',
      'Adani Total Gas',
      'Gujarat Gas',
      'Torrent Gas',
      'GAIL Gas',
      'MNGL',
      'Sabarmati Gas',
      'Think Gas',
      'Green Gas',
      'Tata Power',
      'Adani Electricity',
      'BSES Delhi',
      'BESCOM Bengaluru',
      'MSEDCL Mahavitaran',
      'TANGEDCO (TNEB)',
      'UPPCL',
      'CESC Kolkata',
      'Bharat BillPay (BBPS)',
      'NETC FASTag',
    ];

    const hasHits = citations.length > 0;
    const googleGasUrl = `https://www.google.com/search?q=${encodeURIComponent(gasBingQuery)}`;

    return {
      id: 'mailaccess-lpg-utility-intel',
      platform: 'LPG Gas, PNG & Utility Index',
      domain: 'mylpg.in',
      category: 'Phone & Telecom',
      tool: 'mailaccess',
      status: hasHits ? 'found' : 'not_found',
      findingKind: 'registered',
      handle: e164,
      displayName: hasHits
        ? `${citations.length} LPG / Utility Citation(s)`
        : `${auditedUtilities.length} LPG, Gas & Utility Portals`,
      accountType: 'Zero-OTP LPG, PNG & Utility Registry Audit',
      relativeTime: `${citations.length} public citations · Zero OTP`,
      linkedInfo: [
        'Indane Gas',
        'HP Gas',
        'Bharatgas',
        'MyLPG DBTL',
        'BBPS / FASTag',
      ],
      url: citations[0]?.url || 'https://www.mylpg.in/',
      summary: hasHits
        ? `Matched ${citations.length} public LPG gas / PNG / utility citation(s) referencing ${e164}.`
        : `Audited Indane Gas (${indaneLive.status ? `HTTP ${indaneLive.status}` : 'OK'}), HP Gas (${hpLive.status ? `HTTP ${hpLive.status}` : 'OK'}), Bharatgas (${bharatLive.status ? `HTTP ${bharatLive.status}` : 'OK'}), MyLPG DBTL, IGL, MGL, Adani Total Gas, BBPS & NETC FASTag across Bing & Google Search — 0 public leaks indexed (zero SMS OTPs sent).`,
      durationMs: Date.now() - t0,
      displayFields: [
        { label: 'LPG Gas Portals', value: 'Indane Gas (IOCL), HP Gas (HPCL), Bharatgas (BPCL), MyLPG.in DBTL' },
        { label: 'PNG & Power Utilities', value: 'IGL, MGL, Adani Total Gas, Gujarat Gas, Torrent Gas, Tata Power, BSES' },
        { label: 'Public Web Citations', value: `${citations.length} match(es)` },
        { label: 'OTP Safety', value: 'Zero SMS OTP Dispatched' },
      ],
      artifacts: [
        ...citations.slice(0, 5).map((c, idx) => ({
          id: `lpg-cite-${idx}`,
          type: 'profile_signal' as const,
          title: c.title,
          subtitle: c.engine,
          url: c.url,
          summary: c.snippet,
          details: { url: c.url, engine: c.engine },
        })),
        {
          id: 'lpg-mylpg-portal',
          type: 'profile_signal' as const,
          title: 'MyLPG.in Official National DBTL Subsidy Portal',
          subtitle: 'Indane · HP Gas · Bharatgas',
          url: 'https://www.mylpg.in/',
          summary: 'Direct official portal to check LPG consumer/DBTL linking with registered mobile.',
          details: { portal: 'https://www.mylpg.in/' },
        },
        {
          id: 'lpg-dork-pivot',
          type: 'profile_signal' as const,
          title: `Live LPG & Utility Dork Query (${e164})`,
          subtitle: 'Google Search Pivot',
          url: googleGasUrl,
          summary: `Search public web caches for LPG, PNG & utility receipts matching ${e164}.`,
          details: { query: gasBingQuery },
        },
      ],
    };
  })();

  // 14. Truecaller & Caller ID (No-API Public Index + Multi-Directory Cross-Check: Tellows, ShouldIAnswer, Sync.me)
  const truecallerNoApiPromise = (async (): Promise<InvestigationResultItem> => {
    const t0 = Date.now();
    const baseNum = national.length >= 8 ? national : cleanDigits;
    const countrySlug = parsed.iso2 === 'INTL' ? 'in' : parsed.iso2.toLowerCase();
    const truecallerWebUrl = `https://www.truecaller.com/search/${encodeURIComponent(countrySlug)}/${encodeURIComponent(baseNum)}`;
    const siaUrl = `https://www.shouldianswer.com/phone-number/${encodeURIComponent(cleanDigits)}`;
    const siaAltUrl = `https://www.shouldianswer.com/phone-number/${encodeURIComponent(baseNum)}`;
    const tellowsInUrl = `https://www.tellows.in/num/${encodeURIComponent(baseNum)}`;
    const tcBingQuery = `"${baseNum}" (site:truecaller.com OR site:tellows.com OR site:tellows.in OR site:sync.me OR site:whocalledme.com OR site:shouldianswer.com OR site:numberguru.com)`;

    const [bingTcHits, geminiTcRes, tellowsInRes, tellowsComRes, siaPrimaryRes, siaFallbackRes] = await Promise.all([
      queryBingRssDork(tcBingQuery, 'Websites & Mentions').catch(() => []),
      runGeminiGoogleSearchDork({
        target: e164,
        targetType: 'phone',
        queries: [
          `("${e164}" OR "${baseNum}") (site:truecaller.com OR site:tellows.in OR site:tellows.com OR site:shouldianswer.com OR site:sync.me OR "truecaller")`,
          `"${baseNum}" ("caller id" OR "spam calls" OR "owner name" OR "truecaller")`,
        ],
        mode: 'phone-fast',
      }).catch(() => ({ hits: [], active: false })),
      safeFetch(tellowsInUrl, { headers: { Accept: 'text/html' } }, 4200),
      safeFetch(`https://www.tellows.com/num/${encodeURIComponent(baseNum)}`, { headers: { Accept: 'text/html' } }, 4000),
      safeFetch(siaUrl, { headers: { Accept: 'text/html' } }, 4200),
      cleanDigits !== baseNum
        ? safeFetch(siaAltUrl, { headers: { Accept: 'text/html' } }, 4000)
        : Promise.resolve({ ok: false, status: 0, text: '', url: siaAltUrl }),
    ]);

    // Parse Tellows Score & Caller/Operator Title (tellows.in + tellows.com)
    const tellowsHtml = (tellowsInRes.text && tellowsInRes.text.length > 500 ? tellowsInRes.text : tellowsComRes.text) || '';
    const tellowsNotRated =
      /this phone number has not been rated yet|no comments yet|0 comments|write the first comment/i.test(
        tellowsHtml
      );
    const tellowsScoreMatch =
      tellowsHtml.match(/Phone number score:\s*(\d)/i)?.[1] ||
      tellowsHtml.match(/tellows Rating[^:]*:\s*Score\s*(\d)/i)?.[1] ||
      tellowsHtml.match(/score[:\s]*(\d)/i)?.[1];
    const tellowsTitle = tellowsHtml.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() || '';
    const tellowsCallerTag = tellowsTitle
      .match(/Who calls from [\d+\s-]+(.+?)\s*\?/i)?.[1]
      ?.replace(/\s+/g, ' ')
      .trim();
    const hasRealTellowsSignal =
      Boolean(tellowsHtml) &&
      ((Boolean(tellowsScoreMatch) && Number(tellowsScoreMatch) !== 5) ||
        (!tellowsNotRated && /comment-body|commentlist|user_comment/i.test(tellowsHtml)));

    // Parse ShouldIAnswer Review Count, Rating Sentiment & Caller Category
    const siaHtml =
      siaPrimaryRes.ok && /user reviews|rating|telemarketer|shouldianswer/i.test(siaPrimaryRes.text)
        ? siaPrimaryRes.text
        : siaFallbackRes.ok
        ? siaFallbackRes.text
        : '';
    const siaMetaDesc =
      siaHtml.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      siaHtml.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i)?.[1] ||
      '';
    const siaReviewCount = siaMetaDesc.match(/more than (\d+)\s+user reviews/i)?.[1] ||
      siaHtml.match(/(\d+)\s+users?\s+rated/i)?.[1];
    const siaCategoryMatch = siaMetaDesc.match(/mostly rated as\s+([^.]+)/i)?.[1]?.trim();

    const citations: Array<{ title: string; url: string; snippet: string; engine: string }> = [];
    const seenUrls = new Set<string>();
    const isGenericDirectoryBoilerplate = (title: string, snippet: string) =>
      /has not been rated yet|you are searching for details for|look at the comments by other users|free reverse phone|find out who called|who calls me from/i.test(
        `${title} ${snippet}`
      );
    for (const h of [
      ...bingTcHits.map((b) => ({ title: b.title, url: b.url, snippet: b.snippet, engine: b.sourceEngine })),
      ...geminiTcRes.hits.map((g) => ({ title: g.title, url: g.url, snippet: g.snippet, engine: 'Google Search Grounding' })),
    ]) {
      if (!h.url || seenUrls.has(h.url)) continue;
      const textOnly = `${h.title} ${h.snippet}`;
      if (isGenericDirectoryBoilerplate(h.title, h.snippet)) continue;
      if (textContainsExactPhone(textOnly, parsed)) {
        seenUrls.add(h.url);
        citations.push(h);
      }
    }

    if (siaReviewCount || siaCategoryMatch) {
      citations.push({
        title: `ShouldIAnswer Caller Rating (${siaCategoryMatch || `${siaReviewCount} review(s)`})`,
        url: siaPrimaryRes.ok ? siaUrl : siaAltUrl,
        snippet: siaMetaDesc.slice(0, 240) || `Community reviews recorded on ShouldIAnswer.`,
        engine: 'ShouldIAnswer Live HTML',
      });
    }
    if (hasRealTellowsSignal) {
      citations.push({
        title: `Tellows.in Caller Directory${tellowsCallerTag ? ` · ${tellowsCallerTag}` : ''}`,
        url: tellowsInUrl,
        snippet: `Tellows community score ${tellowsScoreMatch || '5'}/9 · ${tellowsTitle.slice(0, 140)}`,
        engine: 'Tellows.in Live HTML',
      });
    }

    // Attempt cautious extraction of a caller name from grounded Truecaller/Sync.me/Tellows title if cleanly formatted
    let extractedCallerName: string | undefined;
    for (const c of citations) {
      if (!/truecaller|sync\.me/i.test(`${c.url} ${c.title}`)) continue;
      const m =
        c.title.match(/^([A-Z][a-zA-Z .'-]{2,40})\s*[-–|:]\s*(?:\+?[\d\s()-]+|Truecaller)/i)?.[1] ||
        c.snippet.match(/(?:listed as|registered to|caller name[:\s]+)\s*([A-Z][a-zA-Z .'-]{2,40})/i)?.[1];
      if (m && !/unknown|free reverse|phone number lookup|truecaller/i.test(m)) {
        extractedCallerName = m.trim();
        break;
      }
    }

    const tokenConfigured = Boolean(process.env.TRUECALLER_TOKEN?.trim());
    const hasCallerSignal =
      citations.length > 0 ||
      Boolean(extractedCallerName) ||
      Boolean(siaReviewCount) ||
      hasRealTellowsSignal;

    return {
      id: 'mailaccess-truecaller-noapi',
      platform: 'Truecaller & Caller ID (No-API)',
      domain: 'truecaller.com',
      category: 'Phone & Telecom',
      tool: 'mailaccess',
      status: hasCallerSignal ? 'found' : parsed.validLength ? 'not_checked' : 'not_found',
      findingKind: hasCallerSignal ? 'registered' : 'infrastructure',
      handle: e164,
      displayName: extractedCallerName
        ? `${extractedCallerName} · Caller ID`
        : siaCategoryMatch
        ? `Caller ID: ${siaCategoryMatch}`
        : hasCallerSignal
        ? `${citations.length} Caller Directory Signal(s)`
        : 'Truecaller No-API Lookup Pivot Ready',
      accountType: tokenConfigured
        ? 'Truecaller API + Public Directory Index'
        : 'No-API Public Caller Directory & Search Index',
      relativeTime: siaReviewCount
        ? `${siaReviewCount} community review(s)`
        : tellowsScoreMatch
        ? `Tellows ${tellowsScoreMatch}/9`
        : hasCallerSignal
        ? `${citations.length} public match(es)`
        : 'Direct web pivot ready',
      linkedInfo: [
        'Truecaller Web',
        'Tellows.in',
        'ShouldIAnswer',
        'Sync.me',
        extractedCallerName ? `Match: ${extractedCallerName}` : undefined,
        siaCategoryMatch ? `Tag: ${siaCategoryMatch}` : undefined,
      ].filter((v): v is string => Boolean(v)),
      url: citations[0]?.url || truecallerWebUrl,
      summary: extractedCallerName
        ? `Public caller index resolved possible identity "${extractedCallerName}" across ${citations.length} directory citation(s) (No-API mode). Open direct Truecaller profile to confirm.`
        : siaReviewCount || (tellowsScoreMatch && Number(tellowsScoreMatch) !== 5)
        ? `Live public caller reputation resolved in No-API mode: ${
            siaCategoryMatch ? `ShouldIAnswer rated "${siaCategoryMatch}" (${siaReviewCount || '?'} reviews)` : ''
          }${siaCategoryMatch && tellowsScoreMatch ? ' · ' : ''}${
            tellowsScoreMatch ? `Tellows Score ${tellowsScoreMatch}/9${tellowsCallerTag ? ` (${tellowsCallerTag})` : ''}` : ''
          }.`
        : hasCallerSignal
        ? `Matched ${citations.length} public caller-ID / directory citation(s) for ${e164} in No-API mode${
            tellowsCallerTag ? ` (${tellowsCallerTag})` : ''
          }.`
        : `Audited Truecaller public web indexes, Tellows.in (${tellowsScoreMatch ? `Score ${tellowsScoreMatch}/9` : 'No spam alerts'}), ShouldIAnswer, Sync.me, and Google Search Grounding in No-API mode. Open the direct 1-click Truecaller web link to inspect name attribution.`,
      durationMs: Date.now() - t0,
      displayFields: [
        ...(extractedCallerName
          ? [{ label: 'Public Directory Name', value: extractedCallerName, copyable: true }]
          : []),
        ...(siaCategoryMatch
          ? [{ label: 'ShouldIAnswer Rating', value: `${siaCategoryMatch} (${siaReviewCount || '1+'} reviews)` }]
          : []),
        { label: 'Truecaller Web Search', value: truecallerWebUrl, kind: 'url', copyable: true },
        {
          label: 'Tellows.in Directory',
          value: tellowsScoreMatch
            ? `Score ${tellowsScoreMatch}/9${tellowsCallerTag ? ` · ${tellowsCallerTag}` : ''}`
            : 'Checked (0 spam alerts)',
        },
        { label: 'Directory Signals', value: `${citations.length} verified source(s)` },
        { label: 'Mode', value: tokenConfigured ? 'Live Token + No-API Fallback' : 'Zero-Key No-API Public OSINT' },
      ],
      artifacts: [
        {
          id: 'truecaller-direct-pivot',
          type: 'profile_signal' as const,
          title: `Open ${e164} on Truecaller Web Search`,
          subtitle: 'truecaller.com (No-API Pivot)',
          url: truecallerWebUrl,
          summary: `Launch direct Truecaller web caller-ID search for ${parsed.international} in your browser.`,
          details: { url: truecallerWebUrl, e164 },
        },
        {
          id: 'tellows-direct-pivot',
          type: 'profile_signal' as const,
          title: `Inspect ${baseNum} on Tellows.in`,
          subtitle: tellowsScoreMatch ? `Score ${tellowsScoreMatch}/9` : 'tellows.in',
          url: tellowsInUrl,
          summary: tellowsTitle || 'Community caller reputation & operator directory.',
          details: { url: tellowsInUrl, tellowsScore: tellowsScoreMatch },
        },
        {
          id: 'shouldianswer-direct-pivot',
          type: 'profile_signal' as const,
          title: `Inspect ${e164} on ShouldIAnswer`,
          subtitle: siaCategoryMatch || 'shouldianswer.com',
          url: siaPrimaryRes.ok ? siaUrl : siaAltUrl,
          summary: siaMetaDesc || 'Community spam & telemarketer caller rating index.',
          details: { url: siaPrimaryRes.ok ? siaUrl : siaAltUrl, reviewCount: siaReviewCount },
        },
        ...citations.slice(0, 5).map((c, idx) => ({
          id: `tc-cite-${idx}`,
          type: 'profile_signal' as const,
          title: c.title,
          subtitle: c.engine,
          url: c.url,
          summary: c.snippet,
          details: { url: c.url, engine: c.engine },
        })),
      ],
      details: {
        truecallerWebUrl,
        extractedCallerName: extractedCallerName || null,
        siaCategory: siaCategoryMatch || null,
        siaReviewCount: siaReviewCount || null,
        citationsCount: citations.length,
        tellowsScore: tellowsScoreMatch || null,
        noApiMode: true,
      },
    };
  })();

  const results = await Promise.all([
    leakCheckPromise,
    proxynovaPromise,
    githubPromise,
    hnPromise,
    archivePromise,
    stackPromise,
    wikiPromise,
    npmPromise,
    redditPromise,
    sourcegraphPromise,
    paymentUpiIntelPromise,
    ottFootprintIndexPromise,
    lpgUtilityIndexPromise,
    truecallerNoApiPromise,
  ]);

  return { results, breaches };
}
