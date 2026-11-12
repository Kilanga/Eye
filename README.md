# Underwriter's Eye

**See your bank statements the way a lender will, before you apply. Your statements never leave your device.**

Before a mortgage or a rental application, a lender reads two or three months of your bank statements line by line: overdraft fees, a large deposit nobody can explain, a casino charge, a debt-to-income ratio a few points too high. Most applicants discover these problems when the file is refused.

Underwriter's Eye runs that review in your browser first. Gemini Nano reads and classifies every transaction **on your device**. Plain code then applies the lender's rules for your country. Only a summary of about ten numbers goes to the cloud, where Gemini writes a 90-day plan and a letter-of-explanation *template*. The real names, dates and amounts in that letter are filled in locally.

Built for the [#BuildHybridAI](https://firebasehybridaihackathon.devpost.com/) hackathon with Firebase AI Logic hybrid inference. All code in this repository was written during the contest period.

> Educational tool, not financial or legal advice. Thresholds are public rules of thumb, documented below with sources.

## How it works

```
 Statements (CSV / OFX, several accounts)                       ON DEVICE
   │
   ├─ import + internal-transfer matching across accounts   (code)
   ├─ keyword rules: fees, payroll, rent, casinos...        (code)
   ├─ remaining lines classified by Gemini Nano             (Firebase AI Logic, ONLY_ON_DEVICE)
   └─ country rule pack → checks + metrics                  (code, unit-tested)
          │
          ▼
   Cloud profile: ~10 bucketed numbers + check statuses  ── shown to the user before sending
          │   assertSafeForCloud(): whitelist keys, no free text, no statement label
          ▼                                                      IN CLOUD
   Gemini (ONLY_IN_CLOUD, JSON schema) → 90-day plan + letter template with {{placeholders}}
          │
          ▼                                                      ON DEVICE
   Placeholders filled locally → letter ready to send to the lender
```

Every request that leaves the device is recorded, byte for byte, in the **Outbound ledger** screen, together with `response.inferenceSource` reported by the SDK.

### Where each model runs

| Step | Mode | Why |
|---|---|---|
| Classify **your** transactions | `ONLY_ON_DEVICE` | Raw labels must never leave the device, even while Nano is downloading. If the model is unavailable, the app says so; it does not fall back to the cloud. |
| Classify **synthetic demo** transactions | `PREFER_ON_DEVICE` | Lets anyone without Nano see the full pipeline. The data is invented, so a cloud fallback is harmless, and it is logged in the ledger. |
| 90-day plan, letter template | `ONLY_IN_CLOUD` | Needs a larger model; receives only the summary profile. |

### Rule packs

| | United States | France |
|---|---|---|
| Statements | 2 months | 3 months, all accounts |
| Ratio | Back-end DTI on **gross** income: comfortable ≤ 36%, QM reference 43%, ~50% ceiling | Taux d'effort on **net** income: 35% (HCSF) |
| Checks | Overdraft / NSF, large deposits (> 50% of monthly income), payday loans, gambling | Overdrafts and rejected debits, gambling, payday-style credit, regular savings |

Sources and the date each was checked are in `src/core/rules/us.ts` and `src/core/rules/fr.ts`. Adding a country means adding one file.

## Privacy guarantees

1. Raw transaction labels, dates and exact amounts are never sent anywhere. User data is classified with `ONLY_ON_DEVICE`; a cloud answer for user data is treated as an error.
2. The cloud receives `CloudProfile` (`src/core/profile.ts`): country, months covered, income and housing payment rounded to buckets, ratio in whole percent, event counts, check statuses.
3. `assertSafeForCloud()` blocks any payload with an unknown key, free text, or any statement label. It is covered by `tests/privacy.test.ts`.
4. No analytics, no storage of statements: refresh the page and they are gone.

## Run it

Requirements: Node 20+, Chrome desktop (Windows, macOS or Linux) for the on-device model.

```bash
npm install
npm test          # rules, import, transfers, privacy guard
npm run dev       # http://localhost:5173
```

Without Firebase configuration the app starts in **offline demo mode**: keyword rules only, cloud plan disabled.

### Firebase setup

1. Create a Firebase project and add a Web app.
2. Enable **Firebase AI Logic** with the Gemini Developer API.
3. Enable **App Check** with reCAPTCHA Enterprise; for localhost, register a debug token.
4. Copy `.env.example` to `.env.local` and fill in the values.

### Enable Gemini Nano in Chrome

Recent Chrome desktop versions ship the Prompt API. Open `chrome://on-device-internals` to check the model state, then click **Prepare private mode** in the app (the download must start from a click). The model needs about 22 GB of free disk space and either a GPU with more than 4 GB of VRAM or 16 GB of RAM.

### Deploy

```bash
npm run build
npx firebase-tools deploy --only hosting
```

## Demo data

`src/demo/generate.ts` creates deterministic synthetic statements for two people: Maya (Austin, TX, "almost ready") and Camille (Lyon, "clean file"). Every bank, employer and merchant name is invented.

## License

Apache License 2.0. See [LICENSE](LICENSE).
