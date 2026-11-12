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
import { interviewPrompt, classificationPrompt, letterPrompt, planPrompt } from './prompts';
import { classificationJsonSchema, interviewSchema, letterSchema, planSchema, statementJsonSchema } from './schemas';
import { queryJsonSchema, queryPrompt, sanitiseQuery, type StatementQuery } from '../core/ask';
import {
  checkExplanation,
  explanationPrompt,
  sanitiseQuestions,
  templateExplanation,
  type Answer,
  type InterviewQuestion,
} from '../core/interview';
import { DEFAULT_SETTINGS, type AppSettings } from '../core/settings';
import { validateModelItems, type StatementOptions } from '../core/import/statement-text';

/** Lines per on-device call: the local context window is small (about 4k tokens in). */
const BATCH_SIZE = 40;

export type OnDeviceStatus = 'available' | 'downloadable' | 'downloading' | 'unavailable' | 'no-api';

export interface LetterTemplate {
  template: string;
  placeholders: string[];
}

export class HybridAI {
  private ai: AI;
  private settings: AppSettings = DEFAULT_SETTINGS;
  private classifierLocal!: GenerativeModel;
  private classifierDemo!: GenerativeModel;
  private planner!: GenerativeModel;
  private writer!: GenerativeModel;
  private interviewer!: GenerativeModel;
  /** On-device models, one per task (each carries its own output constraint). */
  private local!: Record<'pdf' | 'ask' | 'explain', Record<DataOrigin, GenerativeModel>>;

  constructor(app: FirebaseApp, private ledger: OutboundLedger, settings: AppSettings = DEFAULT_SETTINGS) {
    this.ai = getAI(app, { backend: new GoogleAIBackend() });
    this.configure(settings);
  }

  get cloudEnabled(): boolean {
    return this.settings.cloudEnabled;
  }

  /**
   * (Re)builds every model from the app settings (Firebase Remote Config): which cloud model to
   * use, and whether the cloud may be used at all. With the cloud switched off, sample files are
   * read on the device only and the cloud tasks fall back to the local wording.
   */
  configure(settings: AppSettings): void {
    this.settings = settings;
    const cloudModel = settings.cloudModel;
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
    this.classifierDemo = settings.cloudEnabled
      ? getGenerativeModel(this.ai, {
          mode: InferenceMode.PREFER_ON_DEVICE,
          onDeviceParams,
          inCloudParams: {
            model: cloudModel,
            generationConfig: { responseMimeType: 'application/json', temperature: 0 },
          },
        })
      : this.classifierLocal;
    this.planner = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: planSchema },
      },
    });
    this.writer = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: letterSchema },
      },
    });
    this.interviewer = getGenerativeModel(this.ai, {
      mode: InferenceMode.ONLY_IN_CLOUD,
      inCloudParams: {
        model: cloudModel,
        generationConfig: { responseMimeType: 'application/json', responseSchema: interviewSchema },
      },
    });
    this.local = {
      pdf: this.pair(statementJsonSchema),
      ask: this.pair(queryJsonSchema),
      explain: this.pair(undefined, false),
    };
  }

  private requireCloud(): void {
    if (!this.settings.cloudEnabled) throw new Error('cloud features are paused in the app settings');
  }

  /**
   * user data -> ONLY_ON_DEVICE; synthetic demo data -> PREFER_ON_DEVICE with a cloud fallback,
   * so the demo works for judges without Gemini Nano (unless the cloud is switched off).
   */
  private pair(responseConstraint?: object, json = true): Record<DataOrigin, GenerativeModel> {
    const onDeviceParams = {
      createOptions: {
        expectedInputs: [{ type: 'text' as const, languages: ['en', 'fr'] }],
        expectedOutputs: [{ type: 'text' as const, languages: ['en'] }],
      },
      ...(responseConstraint ? { promptOptions: { responseConstraint } } : {}),
    };
    const user = getGenerativeModel(this.ai, { mode: InferenceMode.ONLY_ON_DEVICE, onDeviceParams });
    return {
      user,
      demo: this.settings.cloudEnabled
        ? getGenerativeModel(this.ai, {
            mode: InferenceMode.PREFER_ON_DEVICE,
            onDeviceParams,
            inCloudParams: {
              model: this.settings.cloudModel,
              generationConfig: json ? { responseMimeType: 'application/json', temperature: 0 } : { temperature: 0.3 },
            },
          })
        : user,
    };
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
    /** The user's own answers, as few-shot examples. Only ever put in an on-device prompt for user data. */
    examples: { label: string; amount: number; category: string }[] = [],
  ): Promise<void> {
    const model = origin === 'user' ? this.classifierLocal : this.classifierDemo;
    for (let start = 0; start < txs.length; start += BATCH_SIZE) {
      const batch = txs.slice(start, start + BATCH_SIZE);
      const prompt = classificationPrompt(batch.map((t, i) => ({ i, label: t.rawLabel, amount: t.amount })), examples);
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
          tx.categoryConfidence = item.confidence;
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
    this.requireCloud();
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
    this.requireCloud();
    const flags = profile.checks.filter((c) => c.status !== 'ok').map((c) => c.id);
    const payload = { country: profile.country, flags };
    assertSafeForCloud(payload, rawLabels);
    const entry = this.ledger.record('letter_template', payload);
    const result = await this.writer.generateContent(letterPrompt(profile.country, flags));
    this.ledger.setSource(entry, result.response.inferenceSource);
    return JSON.parse(result.response.text()) as LetterTemplate;
  }

  /**
   * Reads PDF statement chunks the layout rules could not. Imported files are always treated
   * as user data: on the device only. Every returned line is checked against the page text.
   */
  async readStatementChunks(
    chunks: string[],
    opts: StatementOptions,
    year: number,
    onProgress?: (done: number, total: number) => void,
  ): Promise<Transaction[]> {
    const out: Transaction[] = [];
    for (const [i, chunk] of chunks.entries()) {
      const prompt = [
        'Extract every bank transaction from this statement text. Columns are separated by " | ".',
        `Dates as YYYY-MM-DD (statement year ${year}; ${opts.country === 'US' ? 'MM/DD' : 'DD/MM'} order).`,
        'amount: negative for money out (debit, withdrawal), positive for money in. Ignore balances and totals.',
        'Answer with JSON only: {"items":[{"date":"...","label":"...","amount":0}]}.',
        '',
        chunk,
      ].join('\n');
      const result = await this.local.pdf.user.generateContent(prompt);
      if (result.response.inferenceSource === 'in_cloud') throw new Error('Refusing a cloud answer for user data.');
      out.push(...validateModelItems(parseJson<{ items?: [] }>(result.response.text())?.items ?? [], chunk, opts, out.length));
      onProgress?.(i + 1, chunks.length);
    }
    return out;
  }

  /** Turns a question into a structured query, on the device. The statements are not in the prompt. */
  async understandQuestion(question: string, months: string[], origin: DataOrigin): Promise<StatementQuery | null> {
    if (origin === 'demo') this.ledger.record('demo_question', { characters: question.length });
    const result = await this.local.ask[origin].generateContent(queryPrompt(question, months));
    if (origin === 'user' && result.response.inferenceSource === 'in_cloud') throw new Error('Refusing a cloud answer for user data.');
    return sanitiseQuery(parseJson(result.response.text()), months);
  }

  /** The underwriter's questions, from the summary profile only. */
  async interviewQuestions(profile: CloudProfile, rawLabels: string[]): Promise<InterviewQuestion[]> {
    this.requireCloud();
    const flagged = profile.checks.filter((c) => c.status !== 'ok').map((c) => c.id);
    const payload = { ...profile };
    assertSafeForCloud(payload, rawLabels);
    const entry = this.ledger.record('interview', payload);
    const result = await this.interviewer.generateContent(interviewPrompt(profile, flagged));
    this.ledger.setSource(entry, result.response.inferenceSource);
    return sanitiseQuestions(parseJson(result.response.text()), flagged);
  }

  /** The applicant's explanation paragraph, written on the device from their own answers. */
  async writeExplanation(
    answers: Answer[],
    flagged: Transaction[],
    currency: string,
    origin: DataOrigin,
  ): Promise<{ text: string; by: 'on_device' | 'in_cloud' | 'template' }> {
    if (origin === 'demo') this.ledger.record('demo_explanation', { answers: answers.length });
    const result = await this.local.explain[origin].generateContent(explanationPrompt(answers, flagged, currency));
    const by = result.response.inferenceSource === 'in_cloud' ? 'in_cloud' : 'on_device';
    if (origin === 'user' && by === 'in_cloud') throw new Error('Refusing a cloud answer for user data.');
    const text = result.response.text().trim();
    return checkExplanation(text, answers, flagged) ? { text, by } : { text: templateExplanation(answers), by: 'template' };
  }
}

function parseJson<T = unknown>(text: string): T | null {
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as T;
  } catch {
    return null;
  }
}

function parseItems(text: string): { i: number; category: Category; confidence: 'high' | 'low' }[] {
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)) as {
      items?: { i?: unknown; category?: unknown; confidence?: unknown }[];
    };
    return (json.items ?? [])
      .filter((x): x is { i: number; category: Category } => typeof x.i === 'number' && CATEGORIES.includes(x.category as Category))
      // A missing confidence counts as low: better to ask than to guess.
      .map((x) => ({ i: x.i, category: x.category, confidence: (x as { confidence?: unknown }).confidence === 'high' ? 'high' : 'low' }));
  } catch {
    return [];
  }
}
