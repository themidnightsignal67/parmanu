export type TargetType = 'username' | 'email' | 'domain' | 'ip' | 'phone';

export type ToolId =
  | 'mailaccess'
  | 'holehe'
  | 'maigret'
  | 'ghunt'
  | 'blackbird'
  | 'sherlock'
  | 'phoneinfoga'
  | 'ignorant';

export type ToolAvailabilityStatus = 'ready' | 'optional' | 'unavailable';

export type ToolExecutionStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'warning'
  | 'error'
  | 'skipped';

export type PlatformResultStatus =
  | 'found'
  | 'not_found'
  | 'not_checked'
  | 'error';

export type FindingKind =
  | 'registered'
  | 'breached'
  | 'leaked'
  | 'infrastructure';

export type ScanOverallStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type ResultCategory =
  | 'Developer & Code'
  | 'Email & Domain'
  | 'Social & Community'
  | 'Productivity & Cloud'
  | 'Network & Infrastructure'
  | 'Breach & Exposure'
  | 'Phone & Telecom';

export interface ToolDefinition {
  id: ToolId;
  name: string;
  tier: 'core' | 'enhanced';
  defaultAvailability: ToolAvailabilityStatus;
  supportedTargets: TargetType[];
  scope: string;
  description: string;
  capabilities: string[];
}

export interface ToolHealthItem {
  tool: ToolId;
  status: ToolAvailabilityStatus;
  mode: 'live-native' | 'local-binary' | 'hybrid';
  message?: string;
}

export interface ToolExecutionState {
  tool: ToolId;
  status: ToolExecutionStatus;
  progress: number;
  durationMs: number;
  platformsChecked: number;
  foundCount: number;
  errorCount: number;
  message?: string;
}

export interface ProfilePhotoItem {
  id: string;
  url: string;
  platform: string;
  handle?: string;
  tool: ToolId;
  resultId?: string;
}

export interface BreachedAccountItem {
  id: string;
  platform: string;
  breachName: string;
  domain?: string;
  relativeTime: string;
  date?: string;
  dataClasses: string[];
  tool: ToolId;
  severity: 'low' | 'medium' | 'high';
  summary?: string;
  resultId?: string;
}

export interface GeoMarker {
  id: string;
  label: string;
  region: string;
  country: string;
  lat: number;
  lng: number;
  source: string;
  count: number;
  radiusMeters?: number;
  kind?: 'profile' | 'infrastructure' | 'review' | 'ring_center';
  rating?: number;
  reviewUrl?: string;
}

export interface GhuntReviewItem {
  id: string;
  placeName: string;
  address?: string;
  category?: string;
  rating: number;
  dateText?: string;
  timestamp?: string;
  comment?: string;
  lat?: number;
  lng?: number;
  reviewUrl?: string;
  placeUrl?: string;
}

export interface GhuntLocationRing {
  centerLat: number;
  centerLng: number;
  radiusMeters: number;
  radiusKm: number;
  confidence: 'High' | 'Moderate' | 'Low';
  sampleCount: number;
  totalGeoReviews: number;
  outliersTrimmed: number;
  estimatedAreaLabel: string;
  spreadKm: number;
}

export interface GhuntIntelligenceData {
  email: string;
  tokenConfigured: boolean;
  authMode:
    | 'oauth_access'
    | 'oauth_auth_code'
    | 'oauth_refresh'
    | 'android_master'
    | 'cookie_session'
    | 'public_metadata';
  gaiaId?: string;
  displayName?: string;
  avatarUrl?: string;
  coverPhotoUrl?: string;
  lastUpdated?: string;
  accountType: string;
  isGoogleDomain: boolean;
  usesGoogleMx: boolean;
  primaryMx?: string;
  publicCalendar: boolean;
  calendarUrl?: string;
  calendarEmbedUrl?: string;
  googlePlusArchiveUrl?: string;
  spfPolicy: boolean;
  dmarcPolicy: boolean;
  inAppReachability: string[];
  profileUrl: string;
  mapsContribUrl?: string;
  mapsReviewsCount: number;
  mapsPhotosCount?: number;
  mapsRateLimited?: boolean;
  reviews: GhuntReviewItem[];
  locationRing?: GhuntLocationRing;
  note?: string;
}

export interface ArtifactItem {
  id: string;
  type: 'commit' | 'repository' | 'dns_record' | 'breach_record' | 'profile_signal';
  title: string;
  subtitle?: string;
  repository?: string;
  sha?: string;
  authorName?: string;
  authorEmail?: string;
  timestamp?: string;
  url?: string;
  summary?: string;
  details: Record<string, unknown>;
}

export interface DisplayField {
  label: string;
  value: string;
  kind?: 'text' | 'url' | 'email' | 'phone' | 'boolean' | 'date';
  copyable?: boolean;
}

export interface InvestigationResultItem {
  id: string;
  platform: string;
  domain?: string;
  category: ResultCategory;
  tool: ToolId;
  status: PlatformResultStatus;
  findingKind: FindingKind;
  handle?: string;
  displayName?: string;
  accountType?: string;
  avatarUrl?: string;
  firstSeen?: string;
  lastSeen?: string;
  relativeTime?: string;
  linkedInfo?: string[];
  displayFields?: DisplayField[];
  statsLine?: string;
  url?: string;
  summary?: string;
  durationMs: number;
  artifacts?: ArtifactItem[];
  details?: Record<string, unknown>;
}

export interface GeminiIntelligenceSummary {
  executiveBrief: string;
  riskPosture: 'Low' | 'Moderate' | 'Elevated';
  keyTakeaways: string[];
  recommendedNextSteps: string[];
  keySlotUsed?: number;
  keyPoolSize?: number;
  model?: string;
  generatedAt?: string;
  error?: string;
}

export interface InvestigationSummary {
  total: number;
  found: number;
  breached: number;
  registered: number;
  leaked: number;
  notFound: number;
  notChecked: number;
  errors: number;
  profilePhotosCount: number;
}

export interface InvestigationRecord {
  scanId: string;
  ownerId?: string;
  ownerEmail?: string;
  collaboratorEmails?: string[];
  target: string;
  targetType: TargetType;
  email: string;
  createdAt: string;
  completedAt?: string;
  durationMs: number;
  status: ScanOverallStatus;
  selectedTools: ToolId[];
  enableGoogleDorking?: boolean;
  summary: InvestigationSummary;
  profilePhotos: ProfilePhotoItem[];
  breachedAccounts: BreachedAccountItem[];
  geoMarkers: GeoMarker[];
  toolExecutions: ToolExecutionState[];
  results: InvestigationResultItem[];
  aiSummary?: GeminiIntelligenceSummary;
}

export interface MonitoringRule {
  id: string;
  ownerId?: string;
  target: string;
  targetType: TargetType;
  frequency: 'Realtime' | 'Daily' | 'Weekly';
  active: boolean;
  lastCheckedAt: string;
  lastScanId?: string;
  alertsCount: number;
}

export interface CaseSnapshot {
  id: string;
  ownerId?: string;
  scanId: string;
  target: string;
  targetType: TargetType;
  capturedAt: string;
  dataUrl: string;
  note?: string;
}

export interface TeamMemberRecord {
  id: string;
  ownerId?: string;
  email: string;
  role: 'Investigator' | 'Viewer';
  status: 'Active' | 'Invited';
}

export interface UserProfileRecord {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
}

export type BatchItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export interface BatchExtractedTarget {
  id: string;
  target: string;
  targetType: TargetType;
  sourceHint: string;
  confidence: 'high' | 'medium';
}

export interface BatchExtractResponse {
  fileName: string;
  fileSize: number;
  detectedFormat: string;
  totalExtracted: number;
  targets: BatchExtractedTarget[];
  notes: string[];
}

export interface BatchQueueItem {
  id: string;
  target: string;
  targetType: TargetType;
  sourceHint: string;
  confidence: 'high' | 'medium';
  selected: boolean;
  status: BatchItemStatus;
  scanId?: string;
  record?: InvestigationRecord;
  error?: string;
}

export type DorkResourceCategory =
  | 'Files & Documents'
  | 'Code & Pastes'
  | 'Websites & Mentions'
  | 'Archives & Records';

export type DorkFileFormat =
  | 'PDF'
  | 'XLSX'
  | 'CSV'
  | 'DOCX'
  | 'TXT'
  | 'SQL'
  | 'JSON'
  | 'XML'
  | 'LOG'
  | 'CODE'
  | 'ARCHIVE'
  | 'WEB';

export interface GoogleDorkQuery {
  id: string;
  category: DorkResourceCategory;
  title: string;
  description: string;
  query: string;
  googleUrl: string;
}

export interface GoogleDorkHit {
  id: string;
  title: string;
  url: string;
  domain: string;
  snippet: string;
  category: DorkResourceCategory;
  fileType: DorkFileFormat;
  sourceEngine:
    | 'Google Search Grounding'
    | 'Google CSE'
    | 'DuckDuckGo Dork'
    | 'Bing Search Index'
    | 'Archive.org Search'
    | 'GitHub Code Search'
    | 'Sourcegraph Code Search'
    | 'StackOverflow Search'
    | 'Wayback CDX'
    | 'crt.sh Certificate Log'
    | 'Hacker News'
    | 'Reddit Search';
  matchedQuery: string;
  timestamp?: string;
  verified?: boolean;
  verificationMethod?:
    | 'live-page-match'
    | 'api-exact-match'
    | 'snippet-exact-match'
    | 'wayback-snapshot'
    | 'ct-log';
  matchedEvidence?: string;
  confidenceScore?: number;
}

export interface GoogleDorkResponse {
  target: string;
  targetType: TargetType;
  executedAt: string;
  durationMs: number;
  variantsUsed: string[];
  enginesQueried: string[];
  queries: GoogleDorkQuery[];
  hits: GoogleDorkHit[];
  summary: {
    totalHits: number;
    filesAndDocs: number;
    codeAndPastes: number;
    websitesAndMentions: number;
    archivesAndRecords: number;
    compiledQueries: number;
    droppedUnverifiedCount?: number;
  };
}

export type FaceMatchVerdict =
  | 'High Confidence Match'
  | 'Probable Match'
  | 'Inconclusive'
  | 'Different Person'
  | 'Not a Face';

export interface FacialCandidateInput {
  id: string;
  platform: string;
  url: string;
  handle?: string;
}

export interface FacialReferenceAnalysis {
  label: string;
  sourceUrl?: string;
  sha256?: string;
  faceDetected: boolean;
  quality: 'High' | 'Medium' | 'Low' | 'No Face';
  description: string;
  facialAttributes: string[];
}

export interface FacialReverseSearchLinks {
  yandexUrl: string;
  googleLensUrl: string;
  bingVisualUrl: string;
  tineyeUrl: string;
}

export interface FacialCandidateMatch {
  id: string;
  platform: string;
  handle?: string;
  url: string;
  fetchOk: boolean;
  sha256?: string;
  exactByteMatch?: boolean;
  faceDetected: boolean;
  verdict: FaceMatchVerdict;
  similarityScore: number;
  comparisonSummary: string;
  matchingFeatures: string[];
  differingFeatures: string[];
  reverseSearch?: FacialReverseSearchLinks;
}

export interface FacialAnalysisResponse {
  target: string;
  analyzedAt: string;
  durationMs: number;
  aiAvailable: boolean;
  model?: string;
  keySlotUsed?: number;
  keyPoolSize?: number;
  warning?: string;
  overallSummary: string;
  reference: FacialReferenceAnalysis;
  matches: FacialCandidateMatch[];
}

export type EvidenceTag = 'verified' | 'false_positive' | 'needs_review';

export interface ResultAnnotation {
  tag?: EvidenceTag;
  note?: string;
  updatedAt: string;
}

export interface WebhookConfig {
  id: string;
  label: string;
  provider: 'slack' | 'discord' | 'json';
  url: string;
  enabled: boolean;
}

export interface DossierOptions {
  includeSummary: boolean;
  includeExecutiveBrief: boolean;
  includeBreaches: boolean;
  includeResults: boolean;
  includeDorks: boolean;
  includeNotes: boolean;
  includeEvidenceBoard?: boolean;
  redactPii: boolean;
}

export interface TyposquatCandidate {
  domain: string;
  reason: string;
  resolved: boolean;
  ipv4: string[];
  hasMx: boolean;
}

export interface UsernamePermutationItem {
  handle: string;
  reason: string;
  githubExists?: boolean;
  githubUrl?: string;
}

export interface EvidenceBoardPin {
  id: string;
  scanId: string;
  kind: 'result' | 'dork' | 'breach' | 'facial' | 'note';
  refId: string;
  title: string;
  subtitle: string;
  url?: string;
  category?: string;
  priority: 'critical' | 'high' | 'normal';
  analystNote?: string;
  pinnedAt: string;
}

export interface AutoWebhookSettings {
  enabled: boolean;
  provider: 'slack' | 'discord' | 'json';
  url: string;
  onlyOnNewExposures: boolean;
}

export type AppRoute =
  | 'home'
  | 'search'
  | 'batch'
  | 'results'
  | 'timeline'
  | 'detail'
  | 'history'
  | 'investigations'
  | 'modules'
  | 'monitoring'
  | 'team';
