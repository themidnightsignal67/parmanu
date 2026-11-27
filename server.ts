import dotenv from 'dotenv';
dotenv.config({ override: true });
import express from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  InvestigationRecord,
  TargetType,
  ToolId,
} from './src/types/investigation.ts';
import {
  askGeminiAnalyst,
  generateInvestigationBrief,
  getGeminiRotatorStatus,
} from './server/geminiRotator.ts';
import {
  executeInvestigation,
  fetchLiveGitHubCommitDetail,
  inspectToolsHealth,
} from './server/osintEngine.ts';
import { extractTargetsFromFileBuffer } from './server/fileExtractor.ts';
import { runDeepGoogleDorking } from './server/dorkEngine.ts';
import { runFacialRecognitionAnalysis } from './server/facialEngine.ts';
import {
  enforceAndConsumeSearchCredit,
  getCreditStatusForRequest,
} from './server/creditLimiter.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const isProduction = process.env.NODE_ENV === 'production';

const app = express();
app.set('trust proxy', true);
