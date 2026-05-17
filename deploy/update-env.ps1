# Step 1: Add SMTP password as a secret (run once, or when password changes)
az containerapp secret set `
  --name nr2dashboard-backend `
  --resource-group makeathon-rg `
  --secrets "smtp-password=lwxwqnfqgxzhkdvt"

# Step 2: Update all environment variables
az containerapp update --name nr2dashboard-backend --resource-group makeathon-rg --set-env-vars "FRONTEND_URL=https://makeathon-2026.vercel.app" "AZURE_OPENAI_ENDPOINT=https://makeathon-ai-foundry.cognitiveservices.azure.com/" "AZURE_DEPLOYMENT_NAME=gpt-5.4" "AZURE_FAST_DEPLOYMENT_NAME=gpt-5.4-mini" "AZURE_EMBEDDING_DEPLOYMENT_NAME=text-embedding-3-small" "AZURE_AI_PROJECT_ENDPOINT=https://makeathon-ai-foundry.services.ai.azure.com/api/projects/proj-default" "AZURE_AGENT_ID=makeathon-gpt-agent" "AZURE_AGENT_VERSION=1" "SUPABASE_URL=https://gglthkkskgepxqhhhfrw.supabase.co" "SMTP_HOST=smtp.gmail.com" "SMTP_PORT=587" "SMTP_USER=georgemakeathon@gmail.com" "SMTP_FROM_EMAIL=georgemakeathon@gmail.com" "AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key" "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key" "SUPABASE_DB_URL=secretref:supabase-db-url" "SMTP_PASSWORD=secretref:smtp-password"
