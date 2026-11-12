/**
 * EVERY model call in the app lives in this file.
 *
 *  - classifyTransactions(): Gemini Nano, on the device.
 *      user data -> InferenceMode.ONLY_ON_DEVICE  (throws rather than falling back to the cloud)
 *      demo data -> InferenceMode.PREFER_ON_DEVICE (synthetic, so the cloud fallback is harmless and
 *                   lets judges without Gemini Nano see the whole pipeline)
 *  - generatePlan() / generateLetterTemplate(): Gemini in the cloud, InferenceMode.ONLY_IN_CLOUD,
 *      fed only with the summary profile (plus, for the plan, the step skeleton as enums), after
 *      assertSafeForCloud() and an entry in the ledger. The plan's figures are computed and
 *      filled in locally (src/core/plan.ts): the model writes words, never numbers.
 */
import type { FirebaseApp } from 'firebase/app';
import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  InferenceMode,
  type AI,
  type GenerativeModel,
} from 'firebase/ai';
import type { CloudProfile } from '../core/profile';
import { finalisePlan, toCloudSteps, type DraftPlan, type FinalPlan, type PlanWording } from '../core/plan';
import { assertSafeForCloud, type OutboundLedger } from '../core/ledger';
import { CATEGORIES, type Category, type DataOrigin, type Transaction } from '../core/types';
import { classificationPrompt, letterPrompt, planPrompt } from './prompts';
import { classificationJsonSchema, letterSchema, planSchema } from './schemas';

const CLOUD_MODEL = import.meta.env.VITE_CLOUD_MODEL || 'gemini-3.5-flash-lite';
/** Lines per on-device call: the local context window is small (about 4k tokens in). */
const BATCH_SIZE = 40;

export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

export interface LetterTemplate {
  template: string;
  placeholders: string[];
}

export class HybridAI {
  private ai: AI;
  private classifierLocal: GenerativeModel;
  private classifierDemo: GenerativeModel;
  private planner: GenerativeModel;
  private writer: GenerativeModel;

  constructor(app: FirebaseApp, private ledger: OutboundLedger) {
    this.ai = getAI(app, { backend: new GoogleAIBackend() });
    const onDeviceParams = {
      createOptions: {
        expectedInputs: [{ type: 'text' as const, languages: ['en', 'fr'] }],
        expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
      },
      promptOptions: { responseConstraint: classificationJsonSchema },
    };
    this.classifierLocal = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_ON_DEVICE,
      onDeviceParams,
    });
    this.classifierDemo = getGenerativeModel(this.ai, {
      mode: InferenceMode.PREFER_ON_DEVICE,
      onDeviceParams,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: 'application/json', temperature: 0 },
      },
    });
    this.planner = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: 'application/json', responseSchema: planSchema },
      },
    });
    this.writer = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: CLOUD_MODEL,
        generationConfig: { responseMimeType: 'application/json', responseSchema: letterSchema },
      },
    });
  }

  /** Checks Chrome's built-in model without triggering a download. */
  static async onDeviceStatus(): Promise<OnDeviceStatus> {
    const lm = (globalThis as { LanguageModel?: { availability: (o?: object) => Promise<string> } }).LanguageModel;
    if (!lm) return 'no-api';
    try {
      const s = await lm.availability({ expectedInputs: [{ type: 'text', languages: ['en', 'fr'] }] });
      return (['available', 'downloadable', 'downloading'].includes(s) ? s : 'unavailable') as OnDeviceStatus;
    } catch {
      return 'unavailable';
    }
  }

  /** Must be called from a user gesture (click): may download the model. */
  async prepareOnDevice(onProgress: (p: number) => void): Promise<void> {
    await this.classifierLocal.initializeDeviceModel(onProgress);
  }

  /**
   * Classifies the transactions the keyword rules could not, in small batches.
   * Mutates the transactions (category + categorySource).
   */
  async classifyTransactions(
    txs: Transaction[],
    origin: DataOrigin,
    onProgress?: (done: number, total: number) => void,
  ): Promise<void> {
    const model = origin === 'user' ? this.classifierLocal : this.classifierDemo;
    for (let start = 0; start < txs.length; start += BATCH_SIZE) {
      const batch = txs.slice(start, start + BATCH_SIZE);
      const prompt = classificationPrompt(batch.map((t, i) => ({ i, label: t.rawLabel, amount: t.amount })));
      if (origin === 'demo') {
        // Synthetic data may fall back to the cloud: log it so the ledger stays complete.
        this.ledger.record('demo_classification', { lines: batch.length });
      }
      const result = await model.generateContent(prompt);
      const source = result.response.inferenceSource === 'in_cloud' ? 'in_cloud' : 'on_device';
      if (origin === 'user' && source !== 'on_device') {
        throw new Error('Refusing a cloud answer for user data.'); // defence in depth
      }
      for (const item of parseItems(result.response.text())) {
        const tx = batch[item.i];
        if (tx && !tx.category) {
          tx.category = item.category;
          tx.categorySource = source;
        }
      }
      batch.filter((t) => !t.category).forEach((t) => {
        t.category = 'other';
        t.categorySource = 'unclassified';
      });
      onProgress?.(Math.min(start + BATCH_SIZE, txs.length), txs.length);
    }
  }

  /**
   * Sends the profile plus the plan skeleton (enums only) and asks for wording.
   * The figures stay on the device; invalid wording falls back to the local text.
   */
  async generatePlan(profile: CloudProfile, draft: DraftPlan, rawLabels: string[]): Promise<FinalPlan> {
    const steps = toCloudSteps(draft);
    const payload = { ...profile, steps };
    assertSafeForCloud(payload, rawLabels);
    const entry = this.ledger.record('plan', payload);
    const result = await this.planner.generateContent(planPrompt(profile, steps));
    this.ledger.setSource(entry, result.response.inferenceSource);
    let wording: PlanWording | undefined;
    try {
      wording = JSON.parse(result.response.text()) as PlanWording;
    } catch {
      wording = undefined;
    }
    return finalisePlan(draft, wording);
  }

  async generateLetterTemplate(profile: CloudProfile, rawLabels: string[]): Promise<LetterTemplate> {
    const flags = profile.checks.filter((c) => c.status !== 'ok').map((c) => c.id);
    const payload = { country: profile.country, flags };
    assertSafeForCloud(payload, rawLabels);
    const entry = this.ledger.record('letter_template', payload);
    const result = await this.writer.generateContent(letterPrompt(profile.country, flags));
    this.ledger.setSource(entry, result.response.inferenceSource);
    return JSON.parse(result.response.text()) as LetterTemplate;
  }
}

function parseItems(text: string): { i: number; category: Category }[] {
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
      items?: { i?: unknown; category?: unknown }[];
    };
    return (json.items ?? []).filter(
      (x): x is { i: number; category: Category } =>
        typeof x.i === 'number' && CATEGORIES.includes(x.category as Category),
    );
  } catch {
    return [];
  }
}
