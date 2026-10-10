-- VeilVPN D1 migration 0003: provider customer id on subscriptions.
-- Stores the billing provider's customer id (Stripe cus_...) so the Customer
-- Portal can be created without an extra provider API lookup per request.
ALTER TABLE subscriptions ADD COLUMN provider_customer_id TEXT;
