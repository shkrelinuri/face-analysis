# DoYouMog

DoYouMog is a web-first portrait-analysis app built with React, Vite, and Capacitor. Users can create an account, upload front and profile photos, consent to processing, and request a brief AI-generated report. Scores are subjective model opinions, not objective measures of attractiveness or personal worth.

## Run locally

```sh
npm install
npm run dev
```

Copy `.env.example` to `.env` and configure the values below. The Vite app runs at `http://localhost:5173`; the analysis API runs at `http://localhost:8787`.

## Provider setup

- Create a Supabase project. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` from the project API settings. Legacy anon keys are also supported. Enable email/password auth and configure allowed redirect URLs for the local site and deployed site.
- Set `OPENAI_API_KEY` on the server only. The default `OPENAI_MODEL` is `gpt-4o-mini`; confirm vision and structured-output access in the OpenAI project before launch. The key is never sent to the browser.
- Set `CORS_ORIGIN` to the deployed website origin(s). For a native app build, set `VITE_API_URL` to the deployed API origin before building and syncing Capacitor.
- Auth and analysis controls report missing configuration when provider settings are absent. The server requires a valid Supabase session, 18+ confirmation, explicit photo-processing consent, both images, and limits uploads to 8 MB each.

Photos are held in memory by the API during analysis and are not written to app storage. They are sent to the configured AI provider; review that provider's current retention terms and disclose them to users. Set rate limits and costs for the provider account before inviting users.

## Mobile packaging

The Android project is included. Run `npm run mobile:sync` after web changes. Android builds require Android Studio and the Android SDK. Add/build the iOS project on macOS with Xcode. Store publication requires developer accounts, privacy disclosures, signing, and review approval.

## Before launch

- Independently evaluate model quality and demographic bias with representative, consented participants. This is a general vision model, not a scientifically validated universal attractiveness measure.
- Complete privacy/legal review for face-photo processing in launch regions and publish accurate retention, deletion, and provider disclosures.
- Connect a payment provider and server-verified checkout before enabling paid unlocks. The premium control is still a UI placeholder.