# Manual Database Setup Guide

If the automated database setup fails (`npm run setup-db`), you can set up your Supabase database manually.

## Prerequisites

1. **Supabase Account**: Create account at [supabase.com](https://supabase.com)
2. **New Project**: Create a new Supabase project
3. **API Keys**: Get your project URL and service role key

## Step 1: Get Your Credentials

1. Go to your Supabase dashboard
2. Click on your project
3. Go to **Settings** → **API**
4. Copy:
   - **Project URL** (e.g., `https://your-project-id.supabase.co`)
   - **Service Role Key** (secret key, not anon key)

## Step 2: Configure Environment

Update your `.env` file:

```bash
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_actual_service_role_key
ANTHROPIC_API_KEY=your_claude_api_key
```

## Step 3: Create Database Schema

1. Go to your Supabase dashboard
2. Navigate to **SQL Editor**
3. Copy and paste the contents of `supabase/schema.sql`
4. Click **Run** to execute the schema

## Step 4: Verify Setup

Run the prerequisites check:

```bash
npm run check
```

If the database connection succeeds, you can start the system:

```bash
# Terminal 1
npm run api

# Terminal 2  
npm run frontend
```

## Common Issues

### "TypeError: fetch failed"
- Network connectivity issues
- Verify your Supabase URL is correct
- Check if your Supabase project is active

### "Invalid API key"
- Using anon key instead of service role key
- Key copied incorrectly (missing characters)
- Project paused or deleted

### "Function exec_sql does not exist"
- Normal - just run the SQL manually in Supabase dashboard
- Use the SQL Editor to execute `supabase/schema.sql`

## Support

If you continue having issues:

1. Verify your Supabase project is active
2. Check the project isn't paused (free tier limitation)
3. Ensure you're using the service role key, not anon key
4. Try creating a new Supabase project if needed