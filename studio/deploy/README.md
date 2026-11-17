# Dream BIM web demo (S3 + CloudFront)

A public demo without accounts and without persistence: the built app and an example project are served as static
files; everything else happens in each visitor's browser. What the visitor opens or edits lives only in the memory
of their tab, and "Save" downloads the files to their computer.

## Create the infrastructure (once)

It needs the AWS CLI, authenticated. Region `us-east-1`.

```bash
cd studio
aws cloudformation deploy --template-file deploy/web-demo.yaml --stack-name ifcx-studio-demo \
  --parameter-overrides BudgetEmail=<your-email>     DomainName=dreambim.maudigitalconstructor.com HostedZoneId=Z00026622DQF44R2QP924 --region us-east-1
```

`DomainName` and `HostedZoneId` are optional: with them the stack creates an ACM certificate (validated through DNS
automatically), the CloudFront alias and the A/AAAA records in Route 53. Without them, the demo lives only at
`https://<id>.cloudfront.net/`.

It creates: a private S3 bucket (only CloudFront reads it), a CloudFront distribution with HTTPS and compression, and
an email alert if the monthly spend of **the account** goes over 10 USD (an AWS Budget cannot be limited to one stack).

## Deploy

```bash
cd studio
npm run deploy:web
```

It builds (`vite build --mode web`), copies the project sample to `dist/Snowdon Towers Example/` (the name comes from
`src/platform/sample-root.ts`), uploads to S3 with explicit content type and cache, and clears the cache of
`index.html`, `Snowdon Towers Example/`, `ocr/` and `builtbot/`. At the end it prints the URL (the `SiteUrl` output
of the stack: the own domain if there is one).

- `index.html`: no cache. `assets/` (hashed names): one year. The rest: 5 minutes.
- The `.ifcx` files are uploaded as `application/json`: S3 does not know the extension and CloudFront only compresses
  text types. CloudFront only compresses on the fly files up to 10 MB: a bigger model would be served uncompressed.
- `builtbot/` (the Assistant): its HTML without cache and what is in `builtbot/_next/static/` (hashed) one year.

## The Assistant (BuiltBot) in the demo

The demo carries BuiltBot: the agent runs in the browser and calls the provider (Anthropic, OpenAI or DeepSeek)
directly with the key each user enters; there is no new server and the key does not go through this infrastructure.
The interface is that of `chatbot-revit/frontend`, which `npm run deploy:web` builds with `npm run sync-builtbot`.

- The demo only builds BuiltBot from the **`builtbot-web`** branch of `chatbot-revit` and with `frontend/` without
  uncommitted changes; otherwise the deploy stops with the reason. It prints the commit (`BuiltBot <commit>`).
- `IFCX_CHATBOT_DIR` points to another `chatbot-revit` folder (by default, the sibling of `IFCx`).
- The conversations and the key live only in each user's browser.

## The Revit add-in

The "Revit add-in…" button of Home downloads a zip with the add-in that exports `.ifcx` from Revit 2026.
It is built in the `revit-ifc` fork:

```bash
cd ..\revit-ifc
powershell -ExecutionPolicy Bypass -File Install\package-zip.ps1
```

It leaves `Install\out\IFCx-Revit-2026-<version>.zip` and its `-src.zip` (source code, LGPL). `npm run deploy:web`
runs `npm run addin:web`, which copies to `dist/descargas/` the most recent zip **that has its sources** and writes
`addin.json`; Home reads it from there.

- `IFCX_ADDIN_ZIP`: path to another zip to take the download from (by default, `..\revit-ifc\Install\out\`).
- Without a zip, or without its sources, the deploy goes on, warns in the console and the demo shows no button.
- The zips do not go into git: `dist/` is ignored here and `Install/out/` in the fork.
- The cache of `descargas/` is also cleared when deploying.

## Which models are published

Edit `deploy/sample.json` (`models`, relative to `source`). All the files they import are also copied (even if they are
in folders that are not listed, such as `02_COMPARTIDO/`) and their sibling schedule and cost files.
`npm run sample:web` warns if an imported file is missing and if a model exceeds `maxModelMB`.

The web library shows **all the folders** of `source`, also the empty ones (`03_PUBLISHED`, `04_ARCHIVE`…), as in the
example project; hidden ones (`.builtbot`) and those of `skipFolders` are not shown. The folders of `fullFolders`
(today `library`) are published whole, except `.antes-de-*` copies and `.py` scripts.

## Security headers

`web-demo.yaml` attaches two CloudFront response-headers policies:

- `AppHeaders` (default behavior): a strict Content Security Policy with no inline scripts, where the only external
  connections allowed are the three AI providers (`api.anthropic.com`, `api.deepseek.com`, `api.openai.com`), plus
  HSTS, `nosniff`, `Referrer-Policy: no-referrer` and `X-Frame-Options: SAMEORIGIN`.
- `BuiltBotHeaders` (only the `builtbot/*` behavior): the same policy, but `script-src` also allows `'unsafe-inline'`,
  because the Next.js static build of BuiltBot embeds inline scripts and their content changes on every build.

To tighten the BuiltBot policy, replace `'unsafe-inline'` with the `sha256-` hashes of the inline scripts of
`dist/builtbot/index.html` and regenerate them on every `npm run sync-builtbot`.

The theme script of the app lives in `public/theme-boot.js` for the same reason: `index.html` has no inline script.
The desktop app sets its own policy in `src-tauri/tauri.conf.json` (`csp` and `devCsp`).

## Try it locally

```bash
npm run build:web && npm run sample:web && npx vite preview --mode web
```

## Delete everything

```bash
aws s3 rm s3://<BucketName> --recursive --region us-east-1
aws cloudformation delete-stack --stack-name ifcx-studio-demo --region us-east-1
```

(`BucketName` is in the outputs of the stack: `aws cloudformation describe-stacks --stack-name ifcx-studio-demo`.)
