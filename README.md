# Hackathon Starter
Made with love.
This is a clean, scalable starter project for a 2-day hackathon. It features a Next.js 15 frontend and a FastAPI backend with Supabase and Azure AI Agent integrations.

## Features
- **Frontend**: Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn-like UI structure.
- **Backend**: FastAPI, connected to Supabase for data and Azure AI Foundry for agentic chats.

---

## 🚀 Running the Project

### 1. Frontend
```bash
cd frontend
npm install
cp .env.example .env.local
# Set NEXT_PUBLIC_API_URL to your backend's URL (e.g., http://localhost:8000)
npm run dev
```

### 2. Backend
```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Fill in the environment variables
uvicorn app.main:app --reload
```

---

## ⚙️ Environment Variables

### Frontend (`frontend/.env.local`)
- `NEXT_PUBLIC_API_URL`: Backend URL (e.g. `http://localhost:8000`)

### Backend (`backend/.env`)
- `FRONTEND_URL`: URL of the frontend for CORS (e.g. `http://localhost:3000`)
- `SUPABASE_URL`: Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role key (Never expose to frontend!)
- `AZURE_AI_PROJECT_ENDPOINT`: Azure AI Project endpoint
- `AZURE_AGENT_ID`: ID of the configured AI Agent
- `AZURE_AGENT_VERSION`: Version of the configured Agent
---

## 🗄️ Supabase SQL Tables

Run these SQL commands in your Supabase SQL Editor to set up the database:

```sql
create table app_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  created_at timestamp default now()
);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null,
  content text not null,
  created_at timestamp default now()
);
```

---

## ☁️ Deployment Notes

### Deploying Frontend to Vercel
1. Push the repository to GitHub.
2. Import the project in Vercel.
3. Select `frontend` as the Root Directory.
4. Set the `NEXT_PUBLIC_API_URL` environment variable pointing to your deployed backend URL.
5. Deploy.

### Deploying Backend to Render or Azure Container Apps
**Render:**
1. Create a new Web Service.
2. Connect to the repository.
3. Select `backend` as the Root Directory.
4. Use `Dockerfile` as the environment, OR select Python and set Start Command: `uvicorn app.main:app --host 0.0.0.0 --port 8000`.
5. Add all required environment variables.
6. Deploy.

**Azure Container Apps:**
1. Build the Docker image from `backend/Dockerfile`.
2. Push to an Azure Container Registry (ACR).
3. Create a Container App.
4. Provide the image and set up the Environment Variables.
5. Enable Ingress and allow external traffic on port `8000`.