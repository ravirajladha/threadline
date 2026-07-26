import { MigrateUpArgs, MigrateDownArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db, payload, req }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
   CREATE TYPE "public"."enum_categories_size_group" AS ENUM('topwear', 'bottomwear', 'kids', 'footwear', 'free');
  CREATE TYPE "public"."enum_sizes_group" AS ENUM('topwear', 'bottomwear', 'kids', 'footwear', 'free');
  CREATE TYPE "public"."enum_size_charts_group" AS ENUM('topwear', 'bottomwear', 'kids', 'footwear', 'free');
  CREATE TYPE "public"."enum_products_status" AS ENUM('draft', 'active', 'archived');
  CREATE TYPE "public"."enum_stock_movements_type" AS ENUM('in', 'out', 'adjust', 'return', 'damage');
  CREATE TYPE "public"."enum_users_role" AS ENUM('super_admin', 'catalog_manager', 'order_manager', 'support_agent', 'marketing');
  CREATE TYPE "public"."enum_orders_status" AS ENUM('pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'rto', 'payment_failed', 'returned', 'refunded');
  CREATE TYPE "public"."enum_orders_payment_method" AS ENUM('razorpay', 'cod');
  CREATE TYPE "public"."enum_orders_payment_status" AS ENUM('pending', 'paid', 'failed', 'refunded');
  CREATE TYPE "public"."enum_order_events_from_status" AS ENUM('pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'rto', 'payment_failed', 'returned', 'refunded');
  CREATE TYPE "public"."enum_order_events_to_status" AS ENUM('pending', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'rto', 'payment_failed', 'returned', 'refunded');
  CREATE TYPE "public"."enum_order_events_source" AS ENUM('staff', 'customer', 'webhook', 'system');
  CREATE TYPE "public"."enum_coupons_type" AS ENUM('percent', 'flat', 'free_shipping');
  CREATE TYPE "public"."enum_coupons_applies_to" AS ENUM('all', 'categories', 'products');
  CREATE TYPE "public"."enum_returns_items_reason" AS ENUM('too_small', 'too_large', 'not_as_described', 'damaged', 'wrong_item', 'changed_mind');
  CREATE TYPE "public"."enum_returns_type" AS ENUM('return', 'exchange');
  CREATE TYPE "public"."enum_returns_status" AS ENUM('requested', 'approved', 'picked_up', 'received', 'refunded', 'rejected', 'exchange_shipped');
  CREATE TYPE "public"."enum_loyalty_transactions_type" AS ENUM('earn', 'redeem', 'expire', 'reverse');
  CREATE TYPE "public"."enum_reviews_fit_feedback" AS ENUM('runs_small', 'true_to_size', 'runs_large');
  CREATE TYPE "public"."enum_reviews_status" AS ENUM('pending', 'approved', 'rejected');
  CREATE TYPE "public"."enum_tickets_messages_author_type" AS ENUM('customer', 'agent', 'bot');
  CREATE TYPE "public"."enum_tickets_category" AS ENUM('order', 'return', 'product', 'payment', 'other');
  CREATE TYPE "public"."enum_tickets_status" AS ENUM('open', 'pending_customer', 'resolved', 'closed');
  CREATE TYPE "public"."enum_tickets_priority" AS ENUM('low', 'normal', 'high', 'urgent');
  CREATE TYPE "public"."enum_chat_sessions_messages_role" AS ENUM('user', 'assistant');
  CREATE TYPE "public"."enum_notifications_channel" AS ENUM('email', 'whatsapp');
  CREATE TYPE "public"."enum_notifications_status" AS ENUM('queued', 'sent', 'delivered', 'failed', 'read');
  CREATE TYPE "public"."enum_settings_return_shipping_paid_by" AS ENUM('store', 'customer');
  CREATE TABLE "categories" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"parent_id" integer,
  	"size_group" "enum_categories_size_group" DEFAULT 'topwear' NOT NULL,
  	"size_chart_id" integer,
  	"image_id" integer,
  	"description" jsonb,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_og_image_id" integer,
  	"sort_order" numeric DEFAULT 0,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "sizes" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"label" varchar NOT NULL,
  	"group" "enum_sizes_group" NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "colours" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"hex" varchar NOT NULL,
  	"sort_order" numeric DEFAULT 0,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "size_charts_measurements" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"size_label" varchar NOT NULL,
  	"chest_in" numeric,
  	"waist_in" numeric,
  	"length_in" numeric,
  	"shoulder_in" numeric
  );
  
  CREATE TABLE "size_charts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"group" "enum_size_charts_group" NOT NULL,
  	"notes" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "products_gallery" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL,
  	"colour_id" integer
  );
  
  CREATE TABLE "products" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"title" varchar NOT NULL,
  	"slug" varchar NOT NULL,
  	"category_id" integer NOT NULL,
  	"description" jsonb,
  	"fabric" varchar,
  	"care_instructions" varchar,
  	"fit_notes" varchar,
  	"mrp" numeric NOT NULL,
  	"tax_rate_pct" numeric DEFAULT 5 NOT NULL,
  	"status" "enum_products_status" DEFAULT 'draft' NOT NULL,
  	"featured" boolean DEFAULT false,
  	"seo_title" varchar,
  	"seo_description" varchar,
  	"seo_og_image_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "variants" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"size_id" integer NOT NULL,
  	"colour_id" integer NOT NULL,
  	"sku" varchar NOT NULL,
  	"price" numeric,
  	"compare_at_price" numeric,
  	"stock_qty" numeric DEFAULT 0,
  	"reserved_qty" numeric DEFAULT 0,
  	"barcode" varchar,
  	"weight_grams" numeric,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "stock_movements" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"type" "enum_stock_movements_type" NOT NULL,
  	"qty" numeric NOT NULL,
  	"reason" varchar NOT NULL,
  	"order_id" integer,
  	"actor_id" integer,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "media" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"alt" varchar NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"url" varchar,
  	"thumbnail_u_r_l" varchar,
  	"filename" varchar,
  	"mime_type" varchar,
  	"filesize" numeric,
  	"width" numeric,
  	"height" numeric,
  	"focal_x" numeric,
  	"focal_y" numeric
  );
  
  CREATE TABLE "users_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "users" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"role" "enum_users_role" DEFAULT 'support_agent' NOT NULL,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "customers_sessions" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"created_at" timestamp(3) with time zone,
  	"expires_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "customers" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar NOT NULL,
  	"phone" varchar,
  	"whatsapp_opt_in" boolean DEFAULT false,
  	"loyalty_points" numeric DEFAULT 0,
  	"email_verified" boolean DEFAULT false,
  	"last_seen_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"email" varchar NOT NULL,
  	"reset_password_token" varchar,
  	"reset_password_expiration" timestamp(3) with time zone,
  	"salt" varchar,
  	"hash" varchar,
  	"login_attempts" numeric DEFAULT 0,
  	"lock_until" timestamp(3) with time zone
  );
  
  CREATE TABLE "addresses" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"label" varchar DEFAULT 'Home' NOT NULL,
  	"name" varchar NOT NULL,
  	"phone" varchar NOT NULL,
  	"line1" varchar NOT NULL,
  	"line2" varchar,
  	"city" varchar NOT NULL,
  	"state" varchar NOT NULL,
  	"pincode" varchar NOT NULL,
  	"country" varchar DEFAULT 'India' NOT NULL,
  	"is_default" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "carts_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"variant_id" integer NOT NULL,
  	"qty" numeric NOT NULL,
  	"price_at_add" numeric NOT NULL
  );
  
  CREATE TABLE "carts" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer,
  	"session_id" varchar NOT NULL,
  	"coupon_id" integer,
  	"expires_at" timestamp(3) with time zone,
  	"abandoned_notified_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "orders" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_number" varchar NOT NULL,
  	"customer_id" integer,
  	"email" varchar NOT NULL,
  	"phone" varchar,
  	"shipping_address_name" varchar,
  	"shipping_address_phone" varchar,
  	"shipping_address_line1" varchar,
  	"shipping_address_line2" varchar,
  	"shipping_address_city" varchar,
  	"shipping_address_state" varchar,
  	"shipping_address_pincode" varchar,
  	"shipping_address_country" varchar DEFAULT 'India',
  	"billing_address_name" varchar,
  	"billing_address_phone" varchar,
  	"billing_address_line1" varchar,
  	"billing_address_line2" varchar,
  	"billing_address_city" varchar,
  	"billing_address_state" varchar,
  	"billing_address_pincode" varchar,
  	"billing_address_country" varchar DEFAULT 'India',
  	"status" "enum_orders_status" DEFAULT 'pending' NOT NULL,
  	"payment_method" "enum_orders_payment_method" DEFAULT 'razorpay' NOT NULL,
  	"payment_status" "enum_orders_payment_status" DEFAULT 'pending' NOT NULL,
  	"razorpay_order_id" varchar,
  	"razorpay_payment_id" varchar,
  	"subtotal" numeric NOT NULL,
  	"shipping" numeric NOT NULL,
  	"tax_total" numeric NOT NULL,
  	"discount" numeric NOT NULL,
  	"loyalty_discount" numeric NOT NULL,
  	"grand_total" numeric NOT NULL,
  	"tax_breakup_cgst" numeric,
  	"tax_breakup_sgst" numeric,
  	"tax_breakup_igst" numeric,
  	"coupon_id" integer,
  	"shiprocket_order_id" varchar,
  	"awb_code" varchar,
  	"courier" varchar,
  	"placed_at" timestamp(3) with time zone,
  	"delivered_at" timestamp(3) with time zone,
  	"cancelled_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "order_items" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"variant_id" integer,
  	"sku" varchar NOT NULL,
  	"product_title" varchar NOT NULL,
  	"size_label" varchar NOT NULL,
  	"colour_name" varchar NOT NULL,
  	"image_id" integer,
  	"qty" numeric NOT NULL,
  	"unit_price" numeric NOT NULL,
  	"tax_rate_pct" numeric NOT NULL,
  	"tax_amount" numeric NOT NULL,
  	"line_total" numeric NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "order_events" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"from_status" "enum_order_events_from_status",
  	"to_status" "enum_order_events_to_status" NOT NULL,
  	"source" "enum_order_events_source" DEFAULT 'system' NOT NULL,
  	"actor_id" integer,
  	"note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "coupons" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"code" varchar NOT NULL,
  	"type" "enum_coupons_type" DEFAULT 'percent' NOT NULL,
  	"value" numeric NOT NULL,
  	"min_cart_value" numeric,
  	"max_discount" numeric,
  	"limit_total" numeric,
  	"limit_per_user" numeric DEFAULT 1,
  	"used_count" numeric DEFAULT 0,
  	"starts_at" timestamp(3) with time zone,
  	"ends_at" timestamp(3) with time zone,
  	"applies_to" "enum_coupons_applies_to" DEFAULT 'all' NOT NULL,
  	"stackable" boolean DEFAULT false,
  	"is_active" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "coupons_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"categories_id" integer,
  	"products_id" integer
  );
  
  CREATE TABLE "returns_items" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"order_item_id" integer NOT NULL,
  	"qty" numeric NOT NULL,
  	"reason" "enum_returns_items_reason" NOT NULL
  );
  
  CREATE TABLE "returns" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order_id" integer NOT NULL,
  	"type" "enum_returns_type" DEFAULT 'return' NOT NULL,
  	"exchange_variant_id" integer,
  	"status" "enum_returns_status" DEFAULT 'requested' NOT NULL,
  	"refund_amount" numeric,
  	"pickup_awb" varchar,
  	"customer_note" varchar,
  	"admin_note" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "loyalty_transactions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"order_id" integer,
  	"points" numeric NOT NULL,
  	"type" "enum_loyalty_transactions_type" NOT NULL,
  	"expires_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "reviews_photos" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"image_id" integer NOT NULL
  );
  
  CREATE TABLE "reviews" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"product_id" integer NOT NULL,
  	"customer_id" integer NOT NULL,
  	"order_id" integer,
  	"rating" numeric NOT NULL,
  	"title" varchar,
  	"body" varchar NOT NULL,
  	"fit_feedback" "enum_reviews_fit_feedback",
  	"status" "enum_reviews_status" DEFAULT 'pending' NOT NULL,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "wishlists" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"customer_id" integer NOT NULL,
  	"variant_id" integer NOT NULL,
  	"notify_on_restock" boolean DEFAULT true,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "tickets_messages_attachments" (
  	"_order" integer NOT NULL,
  	"_parent_id" varchar NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"file_id" integer NOT NULL
  );
  
  CREATE TABLE "tickets_messages" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"author" varchar NOT NULL,
  	"author_type" "enum_tickets_messages_author_type" NOT NULL,
  	"body" varchar NOT NULL,
  	"sent_at" timestamp(3) with time zone NOT NULL
  );
  
  CREATE TABLE "tickets" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"ticket_number" varchar NOT NULL,
  	"customer_id" integer NOT NULL,
  	"order_id" integer,
  	"subject" varchar NOT NULL,
  	"category" "enum_tickets_category" DEFAULT 'other' NOT NULL,
  	"status" "enum_tickets_status" DEFAULT 'open' NOT NULL,
  	"priority" "enum_tickets_priority" DEFAULT 'normal' NOT NULL,
  	"assigned_to_id" integer,
  	"escalated_from_bot" boolean DEFAULT false,
  	"first_response_at" timestamp(3) with time zone,
  	"resolved_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "chat_sessions_messages" (
  	"_order" integer NOT NULL,
  	"_parent_id" integer NOT NULL,
  	"id" varchar PRIMARY KEY NOT NULL,
  	"role" "enum_chat_sessions_messages_role" NOT NULL,
  	"content" varchar NOT NULL,
  	"tokens_in" numeric DEFAULT 0,
  	"tokens_out" numeric DEFAULT 0
  );
  
  CREATE TABLE "chat_sessions" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"session_id" varchar NOT NULL,
  	"customer_id" integer,
  	"context_used" jsonb,
  	"handed_off_to_id" integer,
  	"started_at" timestamp(3) with time zone,
  	"ended_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "notifications" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"channel" "enum_notifications_channel" NOT NULL,
  	"event" varchar NOT NULL,
  	"recipient" varchar NOT NULL,
  	"template_key" varchar NOT NULL,
  	"payload" jsonb,
  	"status" "enum_notifications_status" DEFAULT 'queued' NOT NULL,
  	"provider_id" varchar,
  	"error" varchar,
  	"sent_at" timestamp(3) with time zone,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_kv" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar NOT NULL,
  	"data" jsonb NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"global_slug" varchar,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_locked_documents_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"categories_id" integer,
  	"sizes_id" integer,
  	"colours_id" integer,
  	"size_charts_id" integer,
  	"products_id" integer,
  	"variants_id" integer,
  	"stock_movements_id" integer,
  	"media_id" integer,
  	"users_id" integer,
  	"customers_id" integer,
  	"addresses_id" integer,
  	"carts_id" integer,
  	"orders_id" integer,
  	"order_items_id" integer,
  	"order_events_id" integer,
  	"coupons_id" integer,
  	"returns_id" integer,
  	"loyalty_transactions_id" integer,
  	"reviews_id" integer,
  	"wishlists_id" integer,
  	"tickets_id" integer,
  	"chat_sessions_id" integer,
  	"notifications_id" integer
  );
  
  CREATE TABLE "payload_preferences" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"key" varchar,
  	"value" jsonb,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "payload_preferences_rels" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"order" integer,
  	"parent_id" integer NOT NULL,
  	"path" varchar NOT NULL,
  	"users_id" integer,
  	"customers_id" integer
  );
  
  CREATE TABLE "payload_migrations" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"name" varchar,
  	"batch" numeric,
  	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
  	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
  );
  
  CREATE TABLE "settings" (
  	"id" serial PRIMARY KEY NOT NULL,
  	"free_shipping_threshold" numeric NOT NULL,
  	"flat_shipping_rate" numeric NOT NULL,
  	"cod_enabled" boolean DEFAULT true,
  	"cod_fee" numeric,
  	"return_window_days" numeric DEFAULT 7 NOT NULL,
  	"return_shipping_paid_by" "enum_settings_return_shipping_paid_by" DEFAULT 'store' NOT NULL,
  	"company_state" varchar DEFAULT 'Karnataka' NOT NULL,
  	"gstin" varchar,
  	"support_email" varchar NOT NULL,
  	"support_phone" varchar,
  	"whatsapp_opt_in_default" boolean DEFAULT false,
  	"loyalty_enabled" boolean DEFAULT true,
  	"loyalty_earn_per_rupee" numeric DEFAULT 1,
  	"loyalty_max_redeem_pct" numeric DEFAULT 10,
  	"loyalty_min_redeem" numeric DEFAULT 50,
  	"maintenance_mode" boolean DEFAULT false,
  	"updated_at" timestamp(3) with time zone,
  	"created_at" timestamp(3) with time zone
  );
  
  ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_size_chart_id_size_charts_id_fk" FOREIGN KEY ("size_chart_id") REFERENCES "public"."size_charts"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "categories" ADD CONSTRAINT "categories_seo_og_image_id_media_id_fk" FOREIGN KEY ("seo_og_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "size_charts_measurements" ADD CONSTRAINT "size_charts_measurements_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."size_charts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_colour_id_colours_id_fk" FOREIGN KEY ("colour_id") REFERENCES "public"."colours"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products_gallery" ADD CONSTRAINT "products_gallery_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "products" ADD CONSTRAINT "products_seo_og_image_id_media_id_fk" FOREIGN KEY ("seo_og_image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "variants" ADD CONSTRAINT "variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "variants" ADD CONSTRAINT "variants_size_id_sizes_id_fk" FOREIGN KEY ("size_id") REFERENCES "public"."sizes"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "variants" ADD CONSTRAINT "variants_colour_id_colours_id_fk" FOREIGN KEY ("colour_id") REFERENCES "public"."colours"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "customers_sessions" ADD CONSTRAINT "customers_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "addresses" ADD CONSTRAINT "addresses_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "carts_items" ADD CONSTRAINT "carts_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "carts_items" ADD CONSTRAINT "carts_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "carts" ADD CONSTRAINT "carts_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "carts" ADD CONSTRAINT "carts_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "orders" ADD CONSTRAINT "orders_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_items" ADD CONSTRAINT "order_items_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_events" ADD CONSTRAINT "order_events_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "order_events" ADD CONSTRAINT "order_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "coupons_rels" ADD CONSTRAINT "coupons_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "coupons_rels" ADD CONSTRAINT "coupons_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "coupons_rels" ADD CONSTRAINT "coupons_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "returns_items" ADD CONSTRAINT "returns_items_order_item_id_order_items_id_fk" FOREIGN KEY ("order_item_id") REFERENCES "public"."order_items"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "returns_items" ADD CONSTRAINT "returns_items_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "returns" ADD CONSTRAINT "returns_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "returns" ADD CONSTRAINT "returns_exchange_variant_id_variants_id_fk" FOREIGN KEY ("exchange_variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "loyalty_transactions" ADD CONSTRAINT "loyalty_transactions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reviews_photos" ADD CONSTRAINT "reviews_photos_image_id_media_id_fk" FOREIGN KEY ("image_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reviews_photos" ADD CONSTRAINT "reviews_photos_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "reviews" ADD CONSTRAINT "reviews_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets_messages_attachments" ADD CONSTRAINT "tickets_messages_attachments_file_id_media_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."media"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets_messages_attachments" ADD CONSTRAINT "tickets_messages_attachments_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."tickets_messages"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tickets_messages" ADD CONSTRAINT "tickets_messages_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "tickets" ADD CONSTRAINT "tickets_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "chat_sessions_messages" ADD CONSTRAINT "chat_sessions_messages_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "chat_sessions" ADD CONSTRAINT "chat_sessions_handed_off_to_id_tickets_id_fk" FOREIGN KEY ("handed_off_to_id") REFERENCES "public"."tickets"("id") ON DELETE set null ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_categories_fk" FOREIGN KEY ("categories_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_sizes_fk" FOREIGN KEY ("sizes_id") REFERENCES "public"."sizes"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_colours_fk" FOREIGN KEY ("colours_id") REFERENCES "public"."colours"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_size_charts_fk" FOREIGN KEY ("size_charts_id") REFERENCES "public"."size_charts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_products_fk" FOREIGN KEY ("products_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_variants_fk" FOREIGN KEY ("variants_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_stock_movements_fk" FOREIGN KEY ("stock_movements_id") REFERENCES "public"."stock_movements"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_addresses_fk" FOREIGN KEY ("addresses_id") REFERENCES "public"."addresses"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_carts_fk" FOREIGN KEY ("carts_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_orders_fk" FOREIGN KEY ("orders_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_items_fk" FOREIGN KEY ("order_items_id") REFERENCES "public"."order_items"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_order_events_fk" FOREIGN KEY ("order_events_id") REFERENCES "public"."order_events"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_coupons_fk" FOREIGN KEY ("coupons_id") REFERENCES "public"."coupons"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_returns_fk" FOREIGN KEY ("returns_id") REFERENCES "public"."returns"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_loyalty_transactions_fk" FOREIGN KEY ("loyalty_transactions_id") REFERENCES "public"."loyalty_transactions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_reviews_fk" FOREIGN KEY ("reviews_id") REFERENCES "public"."reviews"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_wishlists_fk" FOREIGN KEY ("wishlists_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_tickets_fk" FOREIGN KEY ("tickets_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_chat_sessions_fk" FOREIGN KEY ("chat_sessions_id") REFERENCES "public"."chat_sessions"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_notifications_fk" FOREIGN KEY ("notifications_id") REFERENCES "public"."notifications"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_customers_fk" FOREIGN KEY ("customers_id") REFERENCES "public"."customers"("id") ON DELETE cascade ON UPDATE no action;
  CREATE UNIQUE INDEX "categories_slug_idx" ON "categories" USING btree ("slug");
  CREATE INDEX "categories_parent_idx" ON "categories" USING btree ("parent_id");
  CREATE INDEX "categories_size_chart_idx" ON "categories" USING btree ("size_chart_id");
  CREATE INDEX "categories_image_idx" ON "categories" USING btree ("image_id");
  CREATE INDEX "categories_seo_seo_og_image_idx" ON "categories" USING btree ("seo_og_image_id");
  CREATE INDEX "categories_sort_order_idx" ON "categories" USING btree ("sort_order");
  CREATE INDEX "categories_is_active_idx" ON "categories" USING btree ("is_active");
  CREATE INDEX "categories_updated_at_idx" ON "categories" USING btree ("updated_at");
  CREATE INDEX "categories_created_at_idx" ON "categories" USING btree ("created_at");
  CREATE INDEX "sizes_label_idx" ON "sizes" USING btree ("label");
  CREATE INDEX "sizes_group_idx" ON "sizes" USING btree ("group");
  CREATE INDEX "sizes_sort_order_idx" ON "sizes" USING btree ("sort_order");
  CREATE INDEX "sizes_is_active_idx" ON "sizes" USING btree ("is_active");
  CREATE INDEX "sizes_updated_at_idx" ON "sizes" USING btree ("updated_at");
  CREATE INDEX "sizes_created_at_idx" ON "sizes" USING btree ("created_at");
  CREATE UNIQUE INDEX "colours_slug_idx" ON "colours" USING btree ("slug");
  CREATE INDEX "colours_sort_order_idx" ON "colours" USING btree ("sort_order");
  CREATE INDEX "colours_is_active_idx" ON "colours" USING btree ("is_active");
  CREATE INDEX "colours_updated_at_idx" ON "colours" USING btree ("updated_at");
  CREATE INDEX "colours_created_at_idx" ON "colours" USING btree ("created_at");
  CREATE INDEX "size_charts_measurements_order_idx" ON "size_charts_measurements" USING btree ("_order");
  CREATE INDEX "size_charts_measurements_parent_id_idx" ON "size_charts_measurements" USING btree ("_parent_id");
  CREATE INDEX "size_charts_updated_at_idx" ON "size_charts" USING btree ("updated_at");
  CREATE INDEX "size_charts_created_at_idx" ON "size_charts" USING btree ("created_at");
  CREATE INDEX "products_gallery_order_idx" ON "products_gallery" USING btree ("_order");
  CREATE INDEX "products_gallery_parent_id_idx" ON "products_gallery" USING btree ("_parent_id");
  CREATE INDEX "products_gallery_image_idx" ON "products_gallery" USING btree ("image_id");
  CREATE INDEX "products_gallery_colour_idx" ON "products_gallery" USING btree ("colour_id");
  CREATE UNIQUE INDEX "products_slug_idx" ON "products" USING btree ("slug");
  CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");
  CREATE INDEX "products_status_idx" ON "products" USING btree ("status");
  CREATE INDEX "products_featured_idx" ON "products" USING btree ("featured");
  CREATE INDEX "products_seo_seo_og_image_idx" ON "products" USING btree ("seo_og_image_id");
  CREATE INDEX "products_updated_at_idx" ON "products" USING btree ("updated_at");
  CREATE INDEX "products_created_at_idx" ON "products" USING btree ("created_at");
  CREATE INDEX "variants_product_idx" ON "variants" USING btree ("product_id");
  CREATE INDEX "variants_size_idx" ON "variants" USING btree ("size_id");
  CREATE INDEX "variants_colour_idx" ON "variants" USING btree ("colour_id");
  CREATE UNIQUE INDEX "variants_sku_idx" ON "variants" USING btree ("sku");
  CREATE INDEX "variants_is_active_idx" ON "variants" USING btree ("is_active");
  CREATE INDEX "variants_updated_at_idx" ON "variants" USING btree ("updated_at");
  CREATE INDEX "variants_created_at_idx" ON "variants" USING btree ("created_at");
  CREATE UNIQUE INDEX "product_size_colour_idx" ON "variants" USING btree ("product_id","size_id","colour_id");
  CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("variant_id");
  CREATE INDEX "stock_movements_order_idx" ON "stock_movements" USING btree ("order_id");
  CREATE INDEX "stock_movements_actor_idx" ON "stock_movements" USING btree ("actor_id");
  CREATE INDEX "stock_movements_updated_at_idx" ON "stock_movements" USING btree ("updated_at");
  CREATE INDEX "stock_movements_created_at_idx" ON "stock_movements" USING btree ("created_at");
  CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at");
  CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at");
  CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename");
  CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order");
  CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id");
  CREATE INDEX "users_role_idx" ON "users" USING btree ("role");
  CREATE INDEX "users_is_active_idx" ON "users" USING btree ("is_active");
  CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at");
  CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");
  CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");
  CREATE INDEX "customers_sessions_order_idx" ON "customers_sessions" USING btree ("_order");
  CREATE INDEX "customers_sessions_parent_id_idx" ON "customers_sessions" USING btree ("_parent_id");
  CREATE INDEX "customers_phone_idx" ON "customers" USING btree ("phone");
  CREATE INDEX "customers_updated_at_idx" ON "customers" USING btree ("updated_at");
  CREATE INDEX "customers_created_at_idx" ON "customers" USING btree ("created_at");
  CREATE UNIQUE INDEX "customers_email_idx" ON "customers" USING btree ("email");
  CREATE INDEX "addresses_customer_idx" ON "addresses" USING btree ("customer_id");
  CREATE INDEX "addresses_state_idx" ON "addresses" USING btree ("state");
  CREATE INDEX "addresses_pincode_idx" ON "addresses" USING btree ("pincode");
  CREATE INDEX "addresses_updated_at_idx" ON "addresses" USING btree ("updated_at");
  CREATE INDEX "addresses_created_at_idx" ON "addresses" USING btree ("created_at");
  CREATE INDEX "carts_items_order_idx" ON "carts_items" USING btree ("_order");
  CREATE INDEX "carts_items_parent_id_idx" ON "carts_items" USING btree ("_parent_id");
  CREATE INDEX "carts_items_variant_idx" ON "carts_items" USING btree ("variant_id");
  CREATE INDEX "carts_customer_idx" ON "carts" USING btree ("customer_id");
  CREATE INDEX "carts_session_id_idx" ON "carts" USING btree ("session_id");
  CREATE INDEX "carts_coupon_idx" ON "carts" USING btree ("coupon_id");
  CREATE INDEX "carts_expires_at_idx" ON "carts" USING btree ("expires_at");
  CREATE INDEX "carts_updated_at_idx" ON "carts" USING btree ("updated_at");
  CREATE INDEX "carts_created_at_idx" ON "carts" USING btree ("created_at");
  CREATE UNIQUE INDEX "orders_order_number_idx" ON "orders" USING btree ("order_number");
  CREATE INDEX "orders_customer_idx" ON "orders" USING btree ("customer_id");
  CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");
  CREATE INDEX "orders_payment_status_idx" ON "orders" USING btree ("payment_status");
  CREATE INDEX "orders_razorpay_order_id_idx" ON "orders" USING btree ("razorpay_order_id");
  CREATE INDEX "orders_razorpay_payment_id_idx" ON "orders" USING btree ("razorpay_payment_id");
  CREATE INDEX "orders_coupon_idx" ON "orders" USING btree ("coupon_id");
  CREATE INDEX "orders_shiprocket_order_id_idx" ON "orders" USING btree ("shiprocket_order_id");
  CREATE INDEX "orders_awb_code_idx" ON "orders" USING btree ("awb_code");
  CREATE INDEX "orders_placed_at_idx" ON "orders" USING btree ("placed_at");
  CREATE INDEX "orders_updated_at_idx" ON "orders" USING btree ("updated_at");
  CREATE INDEX "orders_created_at_idx" ON "orders" USING btree ("created_at");
  CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");
  CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");
  CREATE INDEX "order_items_sku_idx" ON "order_items" USING btree ("sku");
  CREATE INDEX "order_items_image_idx" ON "order_items" USING btree ("image_id");
  CREATE INDEX "order_items_updated_at_idx" ON "order_items" USING btree ("updated_at");
  CREATE INDEX "order_items_created_at_idx" ON "order_items" USING btree ("created_at");
  CREATE INDEX "order_events_order_idx" ON "order_events" USING btree ("order_id");
  CREATE INDEX "order_events_actor_idx" ON "order_events" USING btree ("actor_id");
  CREATE INDEX "order_events_updated_at_idx" ON "order_events" USING btree ("updated_at");
  CREATE INDEX "order_events_created_at_idx" ON "order_events" USING btree ("created_at");
  CREATE UNIQUE INDEX "coupons_code_idx" ON "coupons" USING btree ("code");
  CREATE INDEX "coupons_ends_at_idx" ON "coupons" USING btree ("ends_at");
  CREATE INDEX "coupons_is_active_idx" ON "coupons" USING btree ("is_active");
  CREATE INDEX "coupons_updated_at_idx" ON "coupons" USING btree ("updated_at");
  CREATE INDEX "coupons_created_at_idx" ON "coupons" USING btree ("created_at");
  CREATE INDEX "coupons_rels_order_idx" ON "coupons_rels" USING btree ("order");
  CREATE INDEX "coupons_rels_parent_idx" ON "coupons_rels" USING btree ("parent_id");
  CREATE INDEX "coupons_rels_path_idx" ON "coupons_rels" USING btree ("path");
  CREATE INDEX "coupons_rels_categories_id_idx" ON "coupons_rels" USING btree ("categories_id");
  CREATE INDEX "coupons_rels_products_id_idx" ON "coupons_rels" USING btree ("products_id");
  CREATE INDEX "returns_items_order_idx" ON "returns_items" USING btree ("_order");
  CREATE INDEX "returns_items_parent_id_idx" ON "returns_items" USING btree ("_parent_id");
  CREATE INDEX "returns_items_order_item_idx" ON "returns_items" USING btree ("order_item_id");
  CREATE INDEX "returns_order_idx" ON "returns" USING btree ("order_id");
  CREATE INDEX "returns_exchange_variant_idx" ON "returns" USING btree ("exchange_variant_id");
  CREATE INDEX "returns_status_idx" ON "returns" USING btree ("status");
  CREATE INDEX "returns_updated_at_idx" ON "returns" USING btree ("updated_at");
  CREATE INDEX "returns_created_at_idx" ON "returns" USING btree ("created_at");
  CREATE INDEX "loyalty_transactions_customer_idx" ON "loyalty_transactions" USING btree ("customer_id");
  CREATE INDEX "loyalty_transactions_order_idx" ON "loyalty_transactions" USING btree ("order_id");
  CREATE INDEX "loyalty_transactions_expires_at_idx" ON "loyalty_transactions" USING btree ("expires_at");
  CREATE INDEX "loyalty_transactions_updated_at_idx" ON "loyalty_transactions" USING btree ("updated_at");
  CREATE INDEX "loyalty_transactions_created_at_idx" ON "loyalty_transactions" USING btree ("created_at");
  CREATE INDEX "reviews_photos_order_idx" ON "reviews_photos" USING btree ("_order");
  CREATE INDEX "reviews_photos_parent_id_idx" ON "reviews_photos" USING btree ("_parent_id");
  CREATE INDEX "reviews_photos_image_idx" ON "reviews_photos" USING btree ("image_id");
  CREATE INDEX "reviews_product_idx" ON "reviews" USING btree ("product_id");
  CREATE INDEX "reviews_customer_idx" ON "reviews" USING btree ("customer_id");
  CREATE INDEX "reviews_order_idx" ON "reviews" USING btree ("order_id");
  CREATE INDEX "reviews_status_idx" ON "reviews" USING btree ("status");
  CREATE INDEX "reviews_updated_at_idx" ON "reviews" USING btree ("updated_at");
  CREATE INDEX "reviews_created_at_idx" ON "reviews" USING btree ("created_at");
  CREATE INDEX "wishlists_customer_idx" ON "wishlists" USING btree ("customer_id");
  CREATE INDEX "wishlists_variant_idx" ON "wishlists" USING btree ("variant_id");
  CREATE INDEX "wishlists_updated_at_idx" ON "wishlists" USING btree ("updated_at");
  CREATE INDEX "wishlists_created_at_idx" ON "wishlists" USING btree ("created_at");
  CREATE UNIQUE INDEX "customer_variant_idx" ON "wishlists" USING btree ("customer_id","variant_id");
  CREATE INDEX "tickets_messages_attachments_order_idx" ON "tickets_messages_attachments" USING btree ("_order");
  CREATE INDEX "tickets_messages_attachments_parent_id_idx" ON "tickets_messages_attachments" USING btree ("_parent_id");
  CREATE INDEX "tickets_messages_attachments_file_idx" ON "tickets_messages_attachments" USING btree ("file_id");
  CREATE INDEX "tickets_messages_order_idx" ON "tickets_messages" USING btree ("_order");
  CREATE INDEX "tickets_messages_parent_id_idx" ON "tickets_messages" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "tickets_ticket_number_idx" ON "tickets" USING btree ("ticket_number");
  CREATE INDEX "tickets_customer_idx" ON "tickets" USING btree ("customer_id");
  CREATE INDEX "tickets_order_idx" ON "tickets" USING btree ("order_id");
  CREATE INDEX "tickets_category_idx" ON "tickets" USING btree ("category");
  CREATE INDEX "tickets_status_idx" ON "tickets" USING btree ("status");
  CREATE INDEX "tickets_assigned_to_idx" ON "tickets" USING btree ("assigned_to_id");
  CREATE INDEX "tickets_updated_at_idx" ON "tickets" USING btree ("updated_at");
  CREATE INDEX "tickets_created_at_idx" ON "tickets" USING btree ("created_at");
  CREATE INDEX "chat_sessions_messages_order_idx" ON "chat_sessions_messages" USING btree ("_order");
  CREATE INDEX "chat_sessions_messages_parent_id_idx" ON "chat_sessions_messages" USING btree ("_parent_id");
  CREATE UNIQUE INDEX "chat_sessions_session_id_idx" ON "chat_sessions" USING btree ("session_id");
  CREATE INDEX "chat_sessions_customer_idx" ON "chat_sessions" USING btree ("customer_id");
  CREATE INDEX "chat_sessions_handed_off_to_idx" ON "chat_sessions" USING btree ("handed_off_to_id");
  CREATE INDEX "chat_sessions_updated_at_idx" ON "chat_sessions" USING btree ("updated_at");
  CREATE INDEX "chat_sessions_created_at_idx" ON "chat_sessions" USING btree ("created_at");
  CREATE INDEX "notifications_channel_idx" ON "notifications" USING btree ("channel");
  CREATE INDEX "notifications_event_idx" ON "notifications" USING btree ("event");
  CREATE INDEX "notifications_recipient_idx" ON "notifications" USING btree ("recipient");
  CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status");
  CREATE INDEX "notifications_provider_id_idx" ON "notifications" USING btree ("provider_id");
  CREATE INDEX "notifications_updated_at_idx" ON "notifications" USING btree ("updated_at");
  CREATE INDEX "notifications_created_at_idx" ON "notifications" USING btree ("created_at");
  CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key");
  CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug");
  CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at");
  CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at");
  CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order");
  CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id");
  CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path");
  CREATE INDEX "payload_locked_documents_rels_categories_id_idx" ON "payload_locked_documents_rels" USING btree ("categories_id");
  CREATE INDEX "payload_locked_documents_rels_sizes_id_idx" ON "payload_locked_documents_rels" USING btree ("sizes_id");
  CREATE INDEX "payload_locked_documents_rels_colours_id_idx" ON "payload_locked_documents_rels" USING btree ("colours_id");
  CREATE INDEX "payload_locked_documents_rels_size_charts_id_idx" ON "payload_locked_documents_rels" USING btree ("size_charts_id");
  CREATE INDEX "payload_locked_documents_rels_products_id_idx" ON "payload_locked_documents_rels" USING btree ("products_id");
  CREATE INDEX "payload_locked_documents_rels_variants_id_idx" ON "payload_locked_documents_rels" USING btree ("variants_id");
  CREATE INDEX "payload_locked_documents_rels_stock_movements_id_idx" ON "payload_locked_documents_rels" USING btree ("stock_movements_id");
  CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id");
  CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id");
  CREATE INDEX "payload_locked_documents_rels_customers_id_idx" ON "payload_locked_documents_rels" USING btree ("customers_id");
  CREATE INDEX "payload_locked_documents_rels_addresses_id_idx" ON "payload_locked_documents_rels" USING btree ("addresses_id");
  CREATE INDEX "payload_locked_documents_rels_carts_id_idx" ON "payload_locked_documents_rels" USING btree ("carts_id");
  CREATE INDEX "payload_locked_documents_rels_orders_id_idx" ON "payload_locked_documents_rels" USING btree ("orders_id");
  CREATE INDEX "payload_locked_documents_rels_order_items_id_idx" ON "payload_locked_documents_rels" USING btree ("order_items_id");
  CREATE INDEX "payload_locked_documents_rels_order_events_id_idx" ON "payload_locked_documents_rels" USING btree ("order_events_id");
  CREATE INDEX "payload_locked_documents_rels_coupons_id_idx" ON "payload_locked_documents_rels" USING btree ("coupons_id");
  CREATE INDEX "payload_locked_documents_rels_returns_id_idx" ON "payload_locked_documents_rels" USING btree ("returns_id");
  CREATE INDEX "payload_locked_documents_rels_loyalty_transactions_id_idx" ON "payload_locked_documents_rels" USING btree ("loyalty_transactions_id");
  CREATE INDEX "payload_locked_documents_rels_reviews_id_idx" ON "payload_locked_documents_rels" USING btree ("reviews_id");
  CREATE INDEX "payload_locked_documents_rels_wishlists_id_idx" ON "payload_locked_documents_rels" USING btree ("wishlists_id");
  CREATE INDEX "payload_locked_documents_rels_tickets_id_idx" ON "payload_locked_documents_rels" USING btree ("tickets_id");
  CREATE INDEX "payload_locked_documents_rels_chat_sessions_id_idx" ON "payload_locked_documents_rels" USING btree ("chat_sessions_id");
  CREATE INDEX "payload_locked_documents_rels_notifications_id_idx" ON "payload_locked_documents_rels" USING btree ("notifications_id");
  CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key");
  CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at");
  CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at");
  CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order");
  CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id");
  CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path");
  CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id");
  CREATE INDEX "payload_preferences_rels_customers_id_idx" ON "payload_preferences_rels" USING btree ("customers_id");
  CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at");
  CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at");`)
}

export async function down({ db, payload, req }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
   DROP TABLE "categories" CASCADE;
  DROP TABLE "sizes" CASCADE;
  DROP TABLE "colours" CASCADE;
  DROP TABLE "size_charts_measurements" CASCADE;
  DROP TABLE "size_charts" CASCADE;
  DROP TABLE "products_gallery" CASCADE;
  DROP TABLE "products" CASCADE;
  DROP TABLE "variants" CASCADE;
  DROP TABLE "stock_movements" CASCADE;
  DROP TABLE "media" CASCADE;
  DROP TABLE "users_sessions" CASCADE;
  DROP TABLE "users" CASCADE;
  DROP TABLE "customers_sessions" CASCADE;
  DROP TABLE "customers" CASCADE;
  DROP TABLE "addresses" CASCADE;
  DROP TABLE "carts_items" CASCADE;
  DROP TABLE "carts" CASCADE;
  DROP TABLE "orders" CASCADE;
  DROP TABLE "order_items" CASCADE;
  DROP TABLE "order_events" CASCADE;
  DROP TABLE "coupons" CASCADE;
  DROP TABLE "coupons_rels" CASCADE;
  DROP TABLE "returns_items" CASCADE;
  DROP TABLE "returns" CASCADE;
  DROP TABLE "loyalty_transactions" CASCADE;
  DROP TABLE "reviews_photos" CASCADE;
  DROP TABLE "reviews" CASCADE;
  DROP TABLE "wishlists" CASCADE;
  DROP TABLE "tickets_messages_attachments" CASCADE;
  DROP TABLE "tickets_messages" CASCADE;
  DROP TABLE "tickets" CASCADE;
  DROP TABLE "chat_sessions_messages" CASCADE;
  DROP TABLE "chat_sessions" CASCADE;
  DROP TABLE "notifications" CASCADE;
  DROP TABLE "payload_kv" CASCADE;
  DROP TABLE "payload_locked_documents" CASCADE;
  DROP TABLE "payload_locked_documents_rels" CASCADE;
  DROP TABLE "payload_preferences" CASCADE;
  DROP TABLE "payload_preferences_rels" CASCADE;
  DROP TABLE "payload_migrations" CASCADE;
  DROP TABLE "settings" CASCADE;
  DROP TYPE "public"."enum_categories_size_group";
  DROP TYPE "public"."enum_sizes_group";
  DROP TYPE "public"."enum_size_charts_group";
  DROP TYPE "public"."enum_products_status";
  DROP TYPE "public"."enum_stock_movements_type";
  DROP TYPE "public"."enum_users_role";
  DROP TYPE "public"."enum_orders_status";
  DROP TYPE "public"."enum_orders_payment_method";
  DROP TYPE "public"."enum_orders_payment_status";
  DROP TYPE "public"."enum_order_events_from_status";
  DROP TYPE "public"."enum_order_events_to_status";
  DROP TYPE "public"."enum_order_events_source";
  DROP TYPE "public"."enum_coupons_type";
  DROP TYPE "public"."enum_coupons_applies_to";
  DROP TYPE "public"."enum_returns_items_reason";
  DROP TYPE "public"."enum_returns_type";
  DROP TYPE "public"."enum_returns_status";
  DROP TYPE "public"."enum_loyalty_transactions_type";
  DROP TYPE "public"."enum_reviews_fit_feedback";
  DROP TYPE "public"."enum_reviews_status";
  DROP TYPE "public"."enum_tickets_messages_author_type";
  DROP TYPE "public"."enum_tickets_category";
  DROP TYPE "public"."enum_tickets_status";
  DROP TYPE "public"."enum_tickets_priority";
  DROP TYPE "public"."enum_chat_sessions_messages_role";
  DROP TYPE "public"."enum_notifications_channel";
  DROP TYPE "public"."enum_notifications_status";
  DROP TYPE "public"."enum_settings_return_shipping_paid_by";`)
}
