# PureScan - AI Food Scanner

AI-powered healthy food scanner for ingredient analysis and health grading.

## Deployment to Vercel

This application is ready to be deployed to Vercel.

### Prerequisites

1.  A [Vercel](https://vercel.com) account.
2.  Your project pushed to a GitHub, GitLab, or Bitbucket repository.

### Deployment Steps

1.  **Import your project** into Vercel.
2.  **Configure Environment Variables**:
    In the Vercel project settings, add the following environment variables:
    *   `VITE_SUPABASE_URL`: Your Supabase Project URL.
    *   `VITE_SUPABASE_ANON_KEY`: Your Supabase Project Anon Key.
    *   `GEMINI_API_KEY`: Your Google Gemini API Key.
3.  **Build Settings**:
    Vercel should automatically detect the Vite project:
    *   **Framework Preset**: `Vite`
    *   **Build Command**: `npm run build`
    *   **Output Directory**: `dist`
4.  **Deploy**: Click "Deploy".

### SPA Routing

The `vercel.json` file is already included to handle Single Page Application (SPA) routing, ensuring that all requests are redirected to `index.html`.

## Supabase Configuration

Ensure you have set up the `scans` table in your Supabase project with the following schema:

```sql
create table scans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid references auth.users(id),
  timestamp bigint not null,
  productName text not null,
  grade text not null,
  score integer not null,
  riskyIngredients jsonb not null,
  alternative jsonb not null,
  created_at timestamp with time zone default now()
);

-- Enable RLS
alter table scans enable row level security;

-- Create policies
create policy "Users can view their own scans"
  on scans for select
  using (auth.uid() = user_id);

create policy "Users can insert their own scans"
  on scans for insert
  with check (auth.uid() = user_id);
```

## Google OAuth Setup

1.  Enable Google Auth in your Supabase project.
2.  Add your Vercel deployment URL (e.g., `https://your-app.vercel.app`) to the **Redirect URLs** in Supabase Authentication settings.
3.  Add the same URL to the **Authorized redirect URIs** in your Google Cloud Console OAuth credentials.
