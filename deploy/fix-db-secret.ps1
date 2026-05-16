$dbUrl = "postgresql://postgres.gglthkkskgepxqhhhfrw:cmpPI1iXgSDK0TD1@aws-1-eu-central-1.pooler.supabase.com:6543/postgres"
$suffix = Get-Date -Format "MMddHHmm"

az containerapp update `
  --name nr2dashboard-backend `
  --resource-group makeathon-rg `
  --revision-suffix $suffix `
  --set-env-vars `
    "FRONTEND_URL=https://makeathon-2026.vercel.app" `
    "AZURE_OPENAI_ENDPOINT=https://makeathon-ai-foundry.cognitiveservices.azure.com/" `
    "AZURE_DEPLOYMENT_NAME=gpt-4.1" `
    "AZURE_FAST_DEPLOYMENT_NAME=gpt-4o-mini" `
    "AZURE_AI_PROJECT_ENDPOINT=https://makeathon-ai-foundry.services.ai.azure.com/api/projects/proj-default" `
    "SUPABASE_URL=https://gglthkkskgepxqhhhfrw.supabase.co" `
    "AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key" `
    "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key" `
    "SUPABASE_DB_URL=$dbUrl"
