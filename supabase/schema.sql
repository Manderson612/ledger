-- ============================================================
-- LEDGER — SUPABASE SCHEMA
-- Run this entire file in: Supabase Dashboard > SQL Editor
-- ============================================================


-- ACCOUNTS
-- Tracks checking, savings, credit, investment accounts
CREATE TABLE accounts (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('checking','savings','credit','investment','other')),
  institution TEXT,
  balance     DECIMAL(12,2) DEFAULT 0,
  is_active   BOOLEAN DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- CATEGORIES
-- Expense and income categories, seeded with defaults on signup
CREATE TABLE categories (
  id        UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id   UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name      TEXT NOT NULL,
  color     TEXT DEFAULT '#378ADD',
  is_income BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- TRANSACTIONS
-- Every money movement — imported from CSV or entered manually
CREATE TABLE transactions (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  account_id  UUID REFERENCES accounts(id) ON DELETE SET NULL,
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  date        DATE NOT NULL,
  description TEXT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  type        TEXT NOT NULL CHECK (type IN ('income','expense','transfer')),
  notes       TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- BUDGETS
-- Monthly budget amounts per category
CREATE TABLE budgets (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  category_id UUID REFERENCES categories(id) ON DELETE CASCADE NOT NULL,
  month       DATE NOT NULL, -- always set to the 1st of the month
  amount      DECIMAL(12,2) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, category_id, month)
);

-- GOALS
-- Savings goals: Baby Fund, Emergency Fund, etc.
CREATE TABLE goals (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name           TEXT NOT NULL,
  target_amount  DECIMAL(12,2) NOT NULL,
  current_amount DECIMAL(12,2) DEFAULT 0,
  target_date    DATE,
  color          TEXT DEFAULT '#1D9E75',
  is_complete    BOOLEAN DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- BILLS
-- Recurring monthly bills
CREATE TABLE bills (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name        TEXT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL,
  due_day     INTEGER NOT NULL CHECK (due_day BETWEEN 1 AND 31),
  category_id UUID REFERENCES categories(id) ON DELETE SET NULL,
  is_active   BOOLEAN DEFAULT true,
  auto_pay    BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- NET WORTH ITEMS
-- Assets and liabilities that make up net worth
CREATE TABLE net_worth_items (
  id         UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('asset','liability')),
  amount     DECIMAL(12,2) NOT NULL,
  category   TEXT CHECK (category IN ('cash','investment','property','vehicle','retirement','loan','credit','other')),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- NET WORTH SNAPSHOTS
-- Monthly net worth history for trend tracking
CREATE TABLE net_worth_snapshots (
  id                 UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id            UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  month              DATE NOT NULL,
  total_assets       DECIMAL(12,2) NOT NULL,
  total_liabilities  DECIMAL(12,2) NOT NULL,
  net_worth          DECIMAL(12,2) GENERATED ALWAYS AS (total_assets - total_liabilities) STORED,
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, month)
);

-- INCOME SETTINGS
-- Pay schedules for Matt and Megan
CREATE TABLE income_settings (
  id                      UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  person                  TEXT NOT NULL, -- 'primary' or 'partner'
  display_name            TEXT NOT NULL,
  annual_salary           DECIMAL(12,2),
  net_per_paycheck        DECIMAL(12,2),
  pay_schedule            TEXT NOT NULL CHECK (pay_schedule IN ('semi-monthly','bi-weekly','monthly','weekly')),
  pay_day_1               INTEGER, -- semi-monthly: day 7
  pay_day_2               INTEGER, -- semi-monthly: day 22
  last_paycheck_date      DATE,    -- bi-weekly anchor date
  avg_monthly_commission  DECIMAL(12,2) DEFAULT 0,
  commission_on_paycheck  INTEGER DEFAULT 2, -- 1 or 2
  created_at              TIMESTAMPTZ DEFAULT NOW(),
  updated_at              TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, person)
);

-- PAYCHECK ALLOCATIONS
-- What each paycheck is planned to cover
CREATE TABLE paycheck_allocations (
  id             UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id        UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  paycheck_date  DATE NOT NULL,
  person         TEXT NOT NULL,
  planned_amount DECIMAL(12,2) NOT NULL,
  notes          TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, paycheck_date, person)
);


-- ============================================================
-- ROW LEVEL SECURITY
-- Each user can only see and edit their own data
-- ============================================================

ALTER TABLE accounts             ENABLE ROW LEVEL SECURITY;
ALTER TABLE categories           ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions         ENABLE ROW LEVEL SECURITY;
ALTER TABLE budgets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE bills                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE net_worth_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE net_worth_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE income_settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE paycheck_allocations  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own_data" ON accounts            FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON categories          FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON transactions        FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON budgets             FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON goals               FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON bills               FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON net_worth_items     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON net_worth_snapshots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON income_settings     FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "own_data" ON paycheck_allocations FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);


-- ============================================================
-- AUTO-SEED DEFAULT CATEGORIES ON SIGNUP
-- Runs automatically when a new user is created
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.categories (user_id, name, color, is_income) VALUES
    (NEW.id, 'Housing',             '#378ADD', false),
    (NEW.id, 'Groceries',           '#1D9E75', false),
    (NEW.id, 'Dining Out',          '#EF9F27', false),
    (NEW.id, 'Baby / Kids',         '#7F77DD', false),
    (NEW.id, 'Transportation',      '#D85A30', false),
    (NEW.id, 'Healthcare',          '#D4537E', false),
    (NEW.id, 'Utilities',           '#888780', false),
    (NEW.id, 'Subscriptions',       '#5DCAA5', false),
    (NEW.id, 'Entertainment',       '#639922', false),
    (NEW.id, 'Clothing',            '#EF9F27', false),
    (NEW.id, 'Home & Maintenance',  '#4dab8e', false),
    (NEW.id, 'Gifts & Celebrations','#D4537E', false),
    (NEW.id, 'Personal Care',       '#7F77DD', false),
    (NEW.id, 'Savings & Investing', '#1D9E75', false),
    (NEW.id, 'Misc / Other',        '#888780', false),
    (NEW.id, 'Income',              '#1D9E75', true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- ============================================================
-- USEFUL VIEWS
-- ============================================================

-- Monthly spend by category (useful for budget vs actuals)
CREATE VIEW monthly_category_spend AS
SELECT
  t.user_id,
  date_trunc('month', t.date)::date AS month,
  t.category_id,
  c.name AS category_name,
  c.color,
  SUM(t.amount) AS total_spent
FROM transactions t
LEFT JOIN categories c ON c.id = t.category_id
WHERE t.type = 'expense'
GROUP BY t.user_id, date_trunc('month', t.date), t.category_id, c.name, c.color;
