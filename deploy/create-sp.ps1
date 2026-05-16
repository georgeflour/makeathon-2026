az ad sp create-for-rbac --name makeathon-deploy --role contributor --scopes /subscriptions/4ae950d8-6810-45e7-8731-678541b1b816/resourceGroups/makeathon-rg --json-auth
Write-Host ""
Write-Host "==> ACR Password:" -ForegroundColor Cyan
az acr credential show --name makeathonacr --query "passwords[0].value" -o tsv
