-- SPDX-License-Identifier: AGPL-3.0-only
drop trigger if exists "check_billing_storage_limit" on "storage"."objects";
drop trigger if exists "update_billing_storage_usage" on "storage"."objects";
drop trigger if exists "set_updated_at" on "billing"."accounts";

drop trigger if exists "set_updated_at" on "billing"."costs";

drop trigger if exists "set_updated_at" on "billing"."invoices";

drop trigger if exists "set_updated_at" on "billing"."invoices_items";

drop trigger if exists "a_guard_billing_ledger_product" on "billing"."ledger";

drop trigger if exists "set_updated_at" on "billing"."ledger";

drop trigger if exists "update_billing_ledger_usage" on "billing"."ledger";

drop trigger if exists "set_updated_at" on "billing"."payments";

drop trigger if exists "set_updated_at" on "billing"."plans";

drop trigger if exists "set_updated_at" on "billing"."plans_products";

drop trigger if exists "set_updated_at" on "billing"."products";

drop trigger if exists "set_updated_at" on "billing"."subscriptions";

drop trigger if exists "set_updated_at" on "billing"."tiers";

drop trigger if exists "set_updated_at" on "billing"."tiers_products";

drop trigger if exists "set_updated_at" on "billing"."usage";

drop trigger if exists "check_billing_conversation_limit" on "public"."conversations";

drop trigger if exists "update_billing_conversation_usage" on "public"."conversations";

drop trigger if exists "check_billing_message_limit" on "public"."messages";

drop trigger if exists "update_billing_message_usage" on "public"."messages";

drop trigger if exists "update_billing_message_usage_on_delete" on "public"."messages";

drop trigger if exists "initialize_billing_subscription" on "public"."organizations";

drop trigger if exists "update_billing_account_usage" on "public"."organizations_addresses";

drop policy "owners can read their accounts" on "billing"."accounts";

drop policy "anyone can read costs" on "billing"."costs";

drop policy "owners can read their org invoices" on "billing"."invoices";

drop policy "owners can read their org invoice items" on "billing"."invoices_items";

drop policy "members can read their org ledger" on "billing"."ledger";

drop policy "owners can read their org payments" on "billing"."payments";

drop policy "anyone can read plans" on "billing"."plans";

drop policy "anyone can read plans_products" on "billing"."plans_products";

drop policy "anyone can read products" on "billing"."products";

drop policy "members can read their org subscription" on "billing"."subscriptions";

drop policy "anyone can read tiers" on "billing"."tiers";

drop policy "anyone can read tiers_products" on "billing"."tiers_products";

drop policy "members can read their org usage" on "billing"."usage";

alter table "billing"."invoices" drop constraint "invoices_organization_id_fkey";

alter table "billing"."invoices" drop constraint "invoices_status_check";

alter table "billing"."invoices_items" drop constraint "invoices_items_invoice_id_fkey";

alter table "billing"."invoices_items" drop constraint "invoices_items_ledger_id_fkey";

alter table "billing"."invoices_items" drop constraint "invoices_items_plan_id_fkey";

alter table "billing"."invoices_items" drop constraint "invoices_items_product_id_fkey";

alter table "billing"."invoices_items" drop constraint "invoices_items_type_check";

alter table "billing"."ledger" drop constraint "ledger_agent_id_fkey";

alter table "billing"."ledger" drop constraint "ledger_message_id_fkey";

alter table "billing"."ledger" drop constraint "ledger_organization_id_fkey";

alter table "billing"."ledger" drop constraint "ledger_product_id_fkey";

alter table "billing"."ledger" drop constraint "ledger_type_check";

alter table "billing"."payments" drop constraint "payments_account_id_fkey";

alter table "billing"."payments" drop constraint "payments_invoice_id_fkey";

alter table "billing"."payments" drop constraint "payments_organization_id_fkey";

alter table "billing"."payments" drop constraint "payments_status_check";

alter table "billing"."plans" drop constraint "plans_billing_cycle_check";

alter table "billing"."plans_products" drop constraint "plans_products_interval_check";

alter table "billing"."plans_products" drop constraint "plans_products_plan_id_fkey";

alter table "billing"."plans_products" drop constraint "plans_products_product_id_fkey";

alter table "billing"."products" drop constraint "products_kind_check";

alter table "billing"."products" drop constraint "products_unit_check";

alter table "billing"."subscriptions" drop constraint "subscriptions_account_id_fkey";

alter table "billing"."subscriptions" drop constraint "subscriptions_organization_id_fkey";

alter table "billing"."subscriptions" drop constraint "subscriptions_plan_id_fkey";

alter table "billing"."subscriptions" drop constraint "subscriptions_tier_id_fkey";

alter table "billing"."tiers_products" drop constraint "tiers_products_interval_check";

alter table "billing"."tiers_products" drop constraint "tiers_products_product_id_fkey";

alter table "billing"."tiers_products" drop constraint "tiers_products_tier_id_fkey";

alter table "billing"."usage" drop constraint "usage_interval_check";

alter table "billing"."usage" drop constraint "usage_organization_id_fkey";

alter table "billing"."usage" drop constraint "usage_product_id_fkey";

drop function if exists "billing"."check_limit"(_organization_id uuid, _product_id text, _amount numeric);

drop function if exists "billing"."check_product_limit"();

drop function if exists "billing"."check_storage_limit"();

drop function if exists "billing"."guard_ledger_insert"();

drop function if exists "billing"."initialize_subscription"();

drop function if exists "billing"."process_ledger_entry"();

drop function if exists "billing"."update_account_usage"();

drop function if exists "billing"."update_product_usage"();

drop function if exists "billing"."update_storage_usage"();

drop function if exists "billing"."update_usage"(_organization_id uuid, _product_id text, _quantity numeric);

alter table "billing"."accounts" drop constraint "accounts_pkey";

alter table "billing"."costs" drop constraint "costs_pkey";

alter table "billing"."invoices" drop constraint "invoices_pkey";

alter table "billing"."invoices_items" drop constraint "invoices_items_pkey";

alter table "billing"."ledger" drop constraint "ledger_pkey";

alter table "billing"."payments" drop constraint "payments_pkey";

alter table "billing"."plans" drop constraint "plans_pkey";

alter table "billing"."plans_products" drop constraint "plans_products_pkey";

alter table "billing"."products" drop constraint "products_pkey";

alter table "billing"."subscriptions" drop constraint "subscriptions_pkey";

alter table "billing"."tiers" drop constraint "tiers_pkey";

alter table "billing"."tiers_products" drop constraint "tiers_products_pkey";

alter table "billing"."usage" drop constraint "usage_pkey";

drop index if exists "billing"."accounts_pkey";

drop index if exists "billing"."costs_pkey";

drop index if exists "billing"."invoices_items_invoice_id_idx";

drop index if exists "billing"."invoices_items_pkey";

drop index if exists "billing"."invoices_organization_id_idx";

drop index if exists "billing"."invoices_pkey";

drop index if exists "billing"."ledger_created_at_idx";

drop index if exists "billing"."ledger_organization_id_idx";

drop index if exists "billing"."ledger_pkey";

drop index if exists "billing"."payments_invoice_id_idx";

drop index if exists "billing"."payments_organization_id_idx";

drop index if exists "billing"."payments_pkey";

drop index if exists "billing"."plans_pkey";

drop index if exists "billing"."plans_products_pkey";

drop index if exists "billing"."products_pkey";

drop index if exists "billing"."subscriptions_pkey";

drop index if exists "billing"."tiers_pkey";

drop index if exists "billing"."tiers_products_pkey";

drop index if exists "billing"."usage_pkey";

drop table "billing"."accounts";

drop table "billing"."costs";

drop table "billing"."invoices";

drop table "billing"."invoices_items";

drop table "billing"."ledger";

drop table "billing"."payments";

drop table "billing"."plans";

drop table "billing"."plans_products";

drop table "billing"."products";

drop table "billing"."subscriptions";

drop table "billing"."tiers";

drop table "billing"."tiers_products";

drop table "billing"."usage";

drop schema if exists "billing";



