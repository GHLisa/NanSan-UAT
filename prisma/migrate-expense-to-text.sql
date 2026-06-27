-- 費用補貼欄位 Int → TEXT（JSON 編碼），原地轉型保留既有資料
ALTER TABLE "company_fee_rates" ALTER COLUMN "mealExpense" DROP DEFAULT;
ALTER TABLE "company_fee_rates" ALTER COLUMN "mealExpense" TYPE TEXT USING "mealExpense"::text;
ALTER TABLE "company_fee_rates" ALTER COLUMN "mealExpense" SET DEFAULT '0';

ALTER TABLE "company_fee_rates" ALTER COLUMN "accommodationExpense" DROP DEFAULT;
ALTER TABLE "company_fee_rates" ALTER COLUMN "accommodationExpense" TYPE TEXT USING "accommodationExpense"::text;
ALTER TABLE "company_fee_rates" ALTER COLUMN "accommodationExpense" SET DEFAULT '0';

ALTER TABLE "company_fee_rates" ALTER COLUMN "photoFee" DROP DEFAULT;
ALTER TABLE "company_fee_rates" ALTER COLUMN "photoFee" TYPE TEXT USING "photoFee"::text;
ALTER TABLE "company_fee_rates" ALTER COLUMN "photoFee" SET DEFAULT '0';

-- FB 富邦補回 demo 的複合費用結構（先前因 Int schema 以 0 註記）
UPDATE "company_fee_rates" SET
  "mealExpense" = '{"morning":80,"noon":120,"evening":150}',
  "accommodationExpense" = '{"taipei":3300,"other":2700}',
  "photoFee" = '"10張/A4"'
WHERE "companyCode" = 'FB';
