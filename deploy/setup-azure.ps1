# Azure Container Apps - Initial Setup Script
# Run this ONCE to create all Azure resources
# Prerequisites: az CLI installed, logged in with: az login
#
# Usage:
#   .\deploy\setup-azure.ps1 `
#     -AzureOpenAiApiKey "..." `
#     -SupabaseUrl "..." `
#     -SupabaseServiceRoleKey "..." `
#     -SupabaseDbUrl "..." `
#     -FrontendUrl "https://your-vercel-app.vercel.app"

param(
    [string]$ResourceGroup = "makeathon-rg",
    [string]$Location = "westeurope",
    [string]$AcrName = "makeathonacr",
    [string]$EnvName = "makeathon-env",
    [string]$AppName = "nr2dashboard-backend",

    [Parameter(Mandatory)][string]$AzureOpenAiApiKey,
    [Parameter(Mandatory)][string]$SupabaseUrl,
    [Parameter(Mandatory)][string]$SupabaseServiceRoleKey,
    [Parameter(Mandatory)][string]$SupabaseDbUrl,
    [Parameter(Mandatory)][string]$FrontendUrl,

    [string]$AzureOpenAiEndpoint = "https://makeathon-ai-foundry.cognitiveservices.azure.com/",
    [string]$AzureDeploymentName = "gpt-4o",
    [string]$AzureFastDeploymentName = "gpt-4o",
    [string]$AzureAiProjectEndpoint = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Step 1: Register provider (safe to run even if already registered)
Write-Host "==> Registering Microsoft.App provider..." -ForegroundColor Cyan
az provider register -n Microsoft.App --wait

# Step 2: Resource group (already exists, --location is idempotent)
Write-Host "==> Creating Resource Group..." -ForegroundColor Cyan
az group create --name $ResourceGroup --location $Location | Out-Null
Write-Host "    OK: $ResourceGroup" -ForegroundColor Green

# Step 3: ACR (already exists, skip creation silently)
Write-Host "==> Ensuring Container Registry exists..." -ForegroundColor Cyan
$acrExists = az acr show --name $AcrName --resource-group $ResourceGroup --query name -o tsv 2>$null
if (-not $acrExists) {
    az acr create --resource-group $ResourceGroup --name $AcrName --sku Basic --admin-enabled true | Out-Null
}
$AcrLoginServer = az acr show --name $AcrName --query loginServer -o tsv
$AcrUsername    = az acr credential show --name $AcrName --query username -o tsv
$AcrPassword    = az acr credential show --name $AcrName --query "passwords[0].value" -o tsv
Write-Host "    OK: $AcrLoginServer" -ForegroundColor Green

# Step 4: Build image in Azure (no Docker Desktop needed)
Write-Host "==> Building image in Azure Container Registry (no local Docker needed)..." -ForegroundColor Cyan
$ImageTag = "$AcrLoginServer/nr2dashboard-backend:latest"
az acr build `
    --registry $AcrName `
    --image "nr2dashboard-backend:latest" `
    --file "$PSScriptRoot\..\backend\Dockerfile" `
    "$PSScriptRoot\..\backend"
Write-Host "    OK: $ImageTag" -ForegroundColor Green

# Step 5: Container Apps Environment (already exists, skip)
Write-Host "==> Ensuring Container Apps Environment exists..." -ForegroundColor Cyan
$envList = az containerapp env list --resource-group $ResourceGroup --query "[?name=='$EnvName'].name" -o tsv
if (-not $envList) {
    az containerapp env create --name $EnvName --resource-group $ResourceGroup --location $Location | Out-Null
}
Write-Host "    OK: $EnvName" -ForegroundColor Green

# Step 6: Create or update Container App
Write-Host "==> Deploying Container App..." -ForegroundColor Cyan
$appExists = az containerapp list --resource-group $ResourceGroup --query "[?name=='$AppName'].name" -o tsv

$secretsList = "azure-openai-api-key=$AzureOpenAiApiKey supabase-service-role-key=$SupabaseServiceRoleKey supabase-db-url=$SupabaseDbUrl"
$envVarsList = @(
    "AZURE_OPENAI_API_KEY=secretref:azure-openai-api-key",
    "AZURE_OPENAI_ENDPOINT=$AzureOpenAiEndpoint",
    "AZURE_DEPLOYMENT_NAME=$AzureDeploymentName",
    "AZURE_FAST_DEPLOYMENT_NAME=$AzureFastDeploymentName",
    "AZURE_AI_PROJECT_ENDPOINT=$AzureAiProjectEndpoint",
    "SUPABASE_URL=$SupabaseUrl",
    "SUPABASE_SERVICE_ROLE_KEY=secretref:supabase-service-role-key",
    "SUPABASE_DB_URL=secretref:supabase-db-url",
    "FRONTEND_URL=$FrontendUrl"
) -join " "

if (-not $appExists) {
    az containerapp create `
        --name $AppName `
        --resource-group $ResourceGroup `
        --environment $EnvName `
        --image $ImageTag `
        --target-port 8000 `
        --ingress external `
        --registry-server $AcrLoginServer `
        --registry-username $AcrUsername `
        --registry-password $AcrPassword `
        --min-replicas 2 `
        --max-replicas 5 `
        --cpu 1.0 `
        --memory 2.0Gi `
        --scale-rule-name http-scaling `
        --scale-rule-type http `
        --scale-rule-http-concurrency 10 `
        --secrets $secretsList `
        --env-vars $envVarsList | Out-Null
} else {
    # Update existing app with new image
    az containerapp update `
        --name $AppName `
        --resource-group $ResourceGroup `
        --image $ImageTag | Out-Null
}

$AppUrl = az containerapp show `
    --name $AppName `
    --resource-group $ResourceGroup `
    --query "properties.configuration.ingress.fqdn" -o tsv

Write-Host ""
Write-Host "======================================" -ForegroundColor Green
Write-Host " Deployment complete!" -ForegroundColor Green
Write-Host " Backend URL: https://$AppUrl" -ForegroundColor Yellow
Write-Host "======================================" -ForegroundColor Green
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Cyan
Write-Host "  1. Set in Vercel: NEXT_PUBLIC_API_URL=https://$AppUrl"
Write-Host "  2. Test: curl https://$AppUrl/health"
