# Ledger — Setup Guide
Complete these steps in order. Each one is explained simply.

---

## STEP 1 — Install Node.js (if not already installed)

Open your terminal and check if you have it:
```
node -v
```
If you see a version number (e.g. v20.x.x) — skip ahead.
If not, install it:
```
sudo apt update
sudo apt install nodejs npm -y
```
Then verify:
```
node -v
npm -v
```

---

## STEP 2 — Move the project files

Copy the ledger folder to wherever you keep your projects. For example:
```
cp -r ~/ledger ~/projects/ledger
cd ~/projects/ledger
```

---

## STEP 3 — Install dependencies

Inside the ledger folder, run:
```
npm install
```
This installs everything. It will take a minute or two.

---

## STEP 4 — Set up your Supabase database

1. Go to https://supabase.com and sign in
2. Click "New project" — name it "ledger"
3. Choose a region (US East is fine), set a strong password, save it somewhere
4. Wait for the project to finish provisioning (~1 min)
5. In the left sidebar click **SQL Editor**
6. Click **New query**
7. Open the file `supabase/schema.sql` from your ledger project folder
8. Copy ALL of its contents and paste into the SQL Editor
9. Click **Run** — you should see "Success"

This creates all your tables, security rules, and default categories automatically.

---

## STEP 5 — Get your Supabase keys

1. In your Supabase project, click **Settings** (gear icon, bottom left)
2. Click **API**
3. You need two values:
   - **Project URL** — looks like `https://abcdefg.supabase.co`
   - **anon public** key — a long string starting with `eyJ...`

---

## STEP 6 — Create your environment file

In your ledger project folder, create a file called `.env.local`:
```
cp .env.local.example .env.local
```
Open `.env.local` in VS Code (or any text editor) and fill in your values:
```
NEXT_PUBLIC_SUPABASE_URL=https://your-actual-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJyour-actual-anon-key
```
Save the file.

---

## STEP 7 — Run the app locally

```
npm run dev
```
Open your browser and go to: **http://localhost:3000**

You should see the Ledger login page.

---

## STEP 8 — Create your account

1. Click "Sign up"
2. Enter your email and a password
3. You'll be redirected to the dashboard automatically
4. Your 16 default budget categories are created automatically

---

## STEP 9 — Configure your income (do this first)

1. Go to **Settings** in the sidebar
2. Add your income:
   - Annual salary
   - Pay schedule: Semi-monthly, 7th and 22nd
   - Net per paycheck
   - Average monthly commission (paid on the 22nd)
3. Add Megan's income:
   - Annual salary
   - Pay schedule: Bi-weekly
   - Last paycheck date (so the app can calculate future ones)
4. Add your accounts: Capital One Checking, Capital One Savings, Apple Card

---

## STEP 10 — Deploy to Vercel (so it works on all your devices)

1. Push the project to GitHub:
```
git init
git add .
git commit -m "initial commit"
gh repo create ledger --private --push --source=.
```
(If you don't have the `gh` CLI: go to github.com, create a new private repo called "ledger", follow their instructions to push)

2. Go to https://vercel.com and sign in with GitHub
3. Click **Add New Project**
4. Import your `ledger` repo
5. Before clicking Deploy, go to **Environment Variables** and add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your anon key
6. Click **Deploy**
7. In ~2 minutes you'll get a URL like `ledger-matt.vercel.app`

That URL works on your phone, laptop, anywhere — all synced to the same Supabase database.

---

## STEP 11 — Lock down Supabase auth (important)

By default Supabase allows anyone to sign up. Since this is personal, restrict it:

1. In Supabase, go to **Authentication > Settings**
2. Under **User Signups**, disable "Enable Signups"
3. This means only you (already signed up) can use the app

---

## What's built so far

| Feature | Status |
|---|---|
| Authentication (login/signup) | ✅ Complete |
| Sidebar navigation | ✅ Complete |
| Dashboard with metrics, budget snapshot, paychecks, bills, markets, news | ✅ Complete |
| Database schema (all tables, security, auto-categories) | ✅ Complete |
| Planner | 🔜 Next |
| Transactions + CSV import | 🔜 Next |
| Budget | 🔜 Next |
| Spend Analysis | 🔜 Next |
| Goals | 🔜 Next |
| Bills | 🔜 Next |
| Reports | 🔜 Next |
| Net Worth | 🔜 Next |
| Settings | 🔜 Next |

---

## Build order (next sessions)

1. Settings — income, accounts, CSV column mappings
2. Transactions — table, CSV import for Capital One + Apple Card
3. Budget — set budgets, track actuals
4. Planner — paycheck-by-paycheck view
5. Bills — recurring bill tracking
6. Goals — savings goals with progress
7. Net Worth — assets, liabilities, history
8. Spend Analysis — charts, trends, heatmap
9. Reports — PDF exports, summaries

Tell Claude which module you want to build next and it will write the full page.
