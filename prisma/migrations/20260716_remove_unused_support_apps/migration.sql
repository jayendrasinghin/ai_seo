-- Remove unused support apps (messages keep appId NULL via ON DELETE SET NULL)
DELETE FROM "SupportApp"
WHERE slug IN ('cod-guard-otp', 'store-pilot-ai');

UPDATE "SupportApp"
SET "sortOrder" = 2
WHERE slug = 'pay-sync';
