$suffix = Get-Date -Format "MMddHHmm"

Write-Host "==> Building new image in ACR..." -ForegroundColor Cyan
az acr build --registry makeathonacr --image "nr2dashboard-backend:latest" --file backend\Dockerfile backend

Write-Host "==> Deploying new revision: $suffix" -ForegroundColor Cyan
az containerapp update --name nr2dashboard-backend --resource-group makeathon-rg --image "makeathonacr.azurecr.io/nr2dashboard-backend:latest" --revision-suffix $suffix

Write-Host "==> Done!" -ForegroundColor Green
