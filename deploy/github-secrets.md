# GitHub Secrets για CI/CD

Πήγαινε στο GitHub repo → Settings → Secrets and variables → Actions και πρόσθεσε:

## Azure Credentials (για deploy)

| Secret | Πώς το βρίσκεις |
|--------|----------------|
| `AZURE_CREDENTIALS` | `az ad sp create-for-rbac --name makeathon-deploy --role contributor --scopes /subscriptions/<SUB_ID>/resourceGroups/makeathon-rg --json-auth` |
| `ACR_LOGIN_SERVER` | Output του setup script: π.χ. `makeathonacr.azurecr.io` |
| `ACR_USERNAME` | Output του setup script |
| `ACR_PASSWORD` | Output του setup script |

## App Secrets (περνιούνται στο container)

| Secret | Τιμή |
|--------|------|
| `AZURE_OPENAI_API_KEY` | Το Azure OpenAI key |
| `AZURE_OPENAI_ENDPOINT` | `https://makeathon-ai-foundry.cognitiveservices.azure.com/` |
| `AZURE_DEPLOYMENT_NAME` | π.χ. `gpt-4o` |
| `SUPABASE_URL` | Το Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key από Supabase |
| `SUPABASE_DB_URL` | PostgreSQL connection string |
| `FRONTEND_URL` | URL του deployed frontend (Vercel) |
