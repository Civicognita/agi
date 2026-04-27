CREATE TYPE "public"."auth_backend" AS ENUM('virtual', 'pam', 'ldap', 'ad');--> statement-breakpoint
CREATE TYPE "public"."dashboard_role" AS ENUM('viewer', 'editor', 'admin', 'owner');--> statement-breakpoint
CREATE TYPE "public"."entity_scope" AS ENUM('local', 'registered', 'federated');--> statement-breakpoint
CREATE TYPE "public"."federation_consent" AS ENUM('none', 'discoverable', 'full');--> statement-breakpoint
CREATE TYPE "public"."verification_tier" AS ENUM('unverified', 'pending', 'verified', 'trusted', 'sealed', 'disabled');--> statement-breakpoint
CREATE TYPE "public"."comms_direction" AS ENUM('inbound', 'outbound');--> statement-breakpoint
CREATE TYPE "public"."breach_classification" AS ENUM('under_review', 'confirmed_breach', 'no_breach', 'near_miss');--> statement-breakpoint
CREATE TYPE "public"."incident_severity" AS ENUM('low', 'medium', 'high', 'critical');--> statement-breakpoint
CREATE TYPE "public"."incident_status" AS ENUM('detected', 'investigating', 'contained', 'resolved', 'closed');--> statement-breakpoint
CREATE TYPE "public"."seal_status" AS ENUM('active', 'revoked', 'expired');--> statement-breakpoint
CREATE TYPE "public"."vendor_compliance_status" AS ENUM('unknown', 'reviewing', 'approved', 'rejected', 'terminated', 'compliant');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'approved', 'rejected', 'escalated');--> statement-breakpoint
CREATE TYPE "public"."magic_app_mode" AS ENUM('floating', 'docked', 'minimized', 'maximized');--> statement-breakpoint
CREATE TYPE "public"."marketplace_source" AS ENUM('official', 'owner-fork', 'third-party');--> statement-breakpoint
CREATE TYPE "public"."finding_confidence" AS ENUM('high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'acknowledged', 'mitigated', 'false_positive');--> statement-breakpoint
CREATE TYPE "public"."scan_status" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"label" text DEFAULT '' NOT NULL,
	"key_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"provider" text NOT NULL,
	"role" text NOT NULL,
	"account_label" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "handoffs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"purpose" text DEFAULT 'onboarding' NOT NULL,
	"connected_services" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"auth_backend" "auth_backend" DEFAULT 'virtual' NOT NULL,
	"principal" text NOT NULL,
	"email" text,
	"username" text,
	"password_hash" text,
	"display_name" text,
	"entity_id" text,
	"dashboard_role" "dashboard_role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "access_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"scope" text DEFAULT 'read-only' NOT NULL,
	"granted_by" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"agent_id" text NOT NULL,
	"binding_type" text DEFAULT 'primary' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "channel_accounts" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"channel" text NOT NULL,
	"channel_user_id" text NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"coa_alias" text NOT NULL,
	"scope" "entity_scope" DEFAULT 'local' NOT NULL,
	"parent_entity_id" text,
	"user_id" text,
	"verification_tier" "verification_tier" DEFAULT 'unverified' NOT NULL,
	"geid" text,
	"public_key_pem" text,
	"home_node_id" text,
	"federation_consent" "federation_consent" DEFAULT 'none' NOT NULL,
	"source_ip" text,
	"integrity_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_map_cache" (
	"geid" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"entity_map" jsonb NOT NULL,
	"home_node_id" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"version" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "federation_peers" (
	"node_id" text PRIMARY KEY NOT NULL,
	"geid" text NOT NULL,
	"endpoint" text NOT NULL,
	"public_key" text NOT NULL,
	"trust_level" integer DEFAULT 0 NOT NULL,
	"discovery_method" text DEFAULT 'manual' NOT NULL,
	"display_name" text,
	"last_seen" timestamp with time zone DEFAULT now() NOT NULL,
	"last_handshake" timestamp with time zone,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "geid_local" (
	"entity_id" text PRIMARY KEY NOT NULL,
	"geid" text NOT NULL,
	"public_key_pem" text NOT NULL,
	"private_key_pem" text,
	"discoverable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"member_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"impact_share_bps" integer DEFAULT 1000 NOT NULL,
	"invited_by" text NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "registrations" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"registration_type" text NOT NULL,
	"referrer_entity_id" text,
	"referral_source" text,
	"referral_result" text,
	"agent_entity_id" text,
	"record_hash" text,
	"record_signature" text,
	"chain_tx_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coa_chains" (
	"fingerprint" text PRIMARY KEY NOT NULL,
	"resource_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"node_id" text NOT NULL,
	"chain_counter" integer NOT NULL,
	"work_type" text NOT NULL,
	"ref" text,
	"action" text,
	"payload_hash" text,
	"fork_id" text,
	"source_ip" text,
	"integrity_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "comms_log" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"direction" "comms_direction" NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text,
	"subject" text,
	"preview" text NOT NULL,
	"full_payload" jsonb NOT NULL,
	"entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "impact_interactions" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"coa_fingerprint" text NOT NULL,
	"channel" text,
	"work_type" text,
	"quant" double precision NOT NULL,
	"value_0bool" double precision NOT NULL,
	"bonus" double precision DEFAULT 0 NOT NULL,
	"imp_score" double precision NOT NULL,
	"origin_node_id" text,
	"relay_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_balance_log" (
	"id" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"balance_usd" double precision NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "revocation_audit" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"token_hash" text NOT NULL,
	"kind" text DEFAULT 'session' NOT NULL,
	"source_ip" text DEFAULT '' NOT NULL,
	"user_agent" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_log" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"project_path" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cost_usd" double precision NOT NULL,
	"coa_fingerprint" text,
	"tool_count" integer DEFAULT 0 NOT NULL,
	"loop_count" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT 'chat' NOT NULL,
	"cost_mode" text,
	"escalated" boolean DEFAULT false NOT NULL,
	"original_model" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consents" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"purpose" text NOT NULL,
	"granted" boolean DEFAULT false NOT NULL,
	"source" text DEFAULT 'system' NOT NULL,
	"version" text DEFAULT '1.0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "incidents" (
	"id" text PRIMARY KEY NOT NULL,
	"severity" "incident_severity" DEFAULT 'medium' NOT NULL,
	"status" "incident_status" DEFAULT 'detected' NOT NULL,
	"breach_classification" "breach_classification" DEFAULT 'under_review' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"affected_data_types" jsonb,
	"affected_systems" jsonb,
	"detection_time" timestamp with time zone NOT NULL,
	"awareness_time" timestamp with time zone NOT NULL,
	"containment_time" timestamp with time zone,
	"resolution_time" timestamp with time zone,
	"gdpr_deadline" timestamp with time zone,
	"hipaa_deadline" timestamp with time zone,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seals" (
	"seal_id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"issued_by" text NOT NULL,
	"coa" text NOT NULL,
	"alignment_aa" double precision NOT NULL,
	"alignment_uu" double precision NOT NULL,
	"alignment_cc" double precision NOT NULL,
	"checksum" text NOT NULL,
	"grid" text NOT NULL,
	"status" "seal_status" DEFAULT 'active' NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" text,
	"revoke_reason" text
);
--> statement-breakpoint
CREATE TABLE "vendors" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'other' NOT NULL,
	"description" text,
	"compliance_status" "vendor_compliance_status" DEFAULT 'unknown' NOT NULL,
	"dpa_signed" boolean DEFAULT false NOT NULL,
	"baa_signed" boolean DEFAULT false NOT NULL,
	"last_review_date" timestamp with time zone,
	"next_review_date" timestamp with time zone,
	"certifications" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text NOT NULL,
	"entity_type" text NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"proof_type" text NOT NULL,
	"proof_payload" jsonb NOT NULL,
	"proof_submitted_at" timestamp with time zone NOT NULL,
	"proof_submitted_by" text NOT NULL,
	"reviewer_id" text,
	"decision" text,
	"decision_reason" text,
	"decision_at" timestamp with time zone,
	"coa_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "magic_app_instances" (
	"instance_id" text PRIMARY KEY NOT NULL,
	"app_id" text NOT NULL,
	"user_entity_id" text NOT NULL,
	"project_path" text DEFAULT '' NOT NULL,
	"mode" "magic_app_mode" DEFAULT 'floating' NOT NULL,
	"state" jsonb NOT NULL,
	"position" jsonb,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_queue" (
	"id" text PRIMARY KEY NOT NULL,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"retries" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"entity_id" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"metadata" jsonb,
	"read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapps_installed" (
	"mapp_id" text PRIMARY KEY NOT NULL,
	"source" "marketplace_source" DEFAULT 'official' NOT NULL,
	"source_ref" text NOT NULL,
	"version" text NOT NULL,
	"install_path" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mapps_marketplace" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mapp_id" text NOT NULL,
	"source" "marketplace_source" DEFAULT 'official' NOT NULL,
	"source_ref" text NOT NULL,
	"author" text DEFAULT 'civicognita' NOT NULL,
	"description" text,
	"category" text,
	"version" text NOT NULL,
	"source_path" text,
	"manifest" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins_installed" (
	"name" text PRIMARY KEY NOT NULL,
	"source" "marketplace_source" DEFAULT 'official' NOT NULL,
	"source_ref" text NOT NULL,
	"type" text DEFAULT 'plugin' NOT NULL,
	"version" text NOT NULL,
	"install_path" text,
	"integrity_hash" text,
	"trust_tier" text,
	"installed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plugins_marketplace" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source" "marketplace_source" DEFAULT 'official' NOT NULL,
	"source_ref" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'plugin' NOT NULL,
	"version" text NOT NULL,
	"author_name" text,
	"author_email" text,
	"category" text,
	"tags" jsonb,
	"keywords" jsonb,
	"license" text,
	"homepage" text,
	"provides" jsonb,
	"depends" jsonb,
	"aliases" jsonb,
	"trust_tier" text,
	"integrity_hash" text,
	"signed_by" text,
	"manifest" jsonb,
	"last_synced_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hf_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" text,
	"display_name" text,
	"description" text,
	"file_path" text,
	"file_size_bytes" bigint,
	"file_count" integer,
	"status" text DEFAULT 'ready' NOT NULL,
	"downloaded_at" timestamp with time zone,
	"tags" jsonb,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "hf_download_progress" (
	"model_id" text PRIMARY KEY NOT NULL,
	"filename" text NOT NULL,
	"total_bytes" bigint NOT NULL,
	"downloaded_bytes" bigint NOT NULL,
	"speed_bps" double precision,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hf_installed" (
	"id" text PRIMARY KEY NOT NULL,
	"revision" text,
	"display_name" text,
	"pipeline_tag" text,
	"runtime_type" text,
	"file_path" text,
	"model_filename" text,
	"file_size_bytes" bigint,
	"quantization" text,
	"status" text DEFAULT 'ready' NOT NULL,
	"downloaded_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"error" text,
	"container_id" text,
	"container_port" integer,
	"container_name" text,
	"container_image" text,
	"source_repo" text,
	"endpoints" jsonb,
	"status_changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "scan_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"status" "scan_status" DEFAULT 'pending' NOT NULL,
	"config" jsonb NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"finding_counts" jsonb DEFAULT '{}' NOT NULL,
	"total_findings" integer DEFAULT 0 NOT NULL,
	"scanner_results" jsonb DEFAULT '[]' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "security_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"scan_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"check_id" text NOT NULL,
	"scan_type" text NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"confidence" "finding_confidence" DEFAULT 'medium' NOT NULL,
	"cwe" jsonb DEFAULT '[]' NOT NULL,
	"owasp" jsonb DEFAULT '[]' NOT NULL,
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"remediation" jsonb DEFAULT '{}' NOT NULL,
	"standards" jsonb,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_records" (
	"id" text PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"entity_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"cost_mode" text NOT NULL,
	"complexity" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"cpu_watts_observed" real,
	"gpu_watts_observed" real,
	"dollar_cost" real,
	"escalated" boolean DEFAULT false NOT NULL,
	"turn_duration_ms" integer NOT NULL,
	"routing_reason" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auth_sessions" ADD CONSTRAINT "auth_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "handoffs" ADD CONSTRAINT "handoffs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "access_grants" ADD CONSTRAINT "access_grants_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bindings" ADD CONSTRAINT "agent_bindings_owner_id_entities_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_bindings" ADD CONSTRAINT "agent_bindings_agent_id_entities_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "geid_local" ADD CONSTRAINT "geid_local_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_entities_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_id_entities_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_referrer_entity_id_entities_id_fk" FOREIGN KEY ("referrer_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "registrations" ADD CONSTRAINT "registrations_agent_entity_id_entities_id_fk" FOREIGN KEY ("agent_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coa_chains" ADD CONSTRAINT "coa_chains_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comms_log" ADD CONSTRAINT "comms_log_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_interactions" ADD CONSTRAINT "impact_interactions_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "impact_interactions" ADD CONSTRAINT "impact_interactions_coa_fingerprint_coa_chains_fingerprint_fk" FOREIGN KEY ("coa_fingerprint") REFERENCES "public"."coa_chains"("fingerprint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seals" ADD CONSTRAINT "seals_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_requests" ADD CONSTRAINT "verification_requests_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_scan_id_scan_runs_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."scan_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_idx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_user_provider_role_idx" ON "connections" USING btree ("user_id","provider","role");--> statement-breakpoint
CREATE UNIQUE INDEX "users_backend_principal_idx" ON "users" USING btree ("auth_backend","principal");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "users_username_idx" ON "users" USING btree ("username");--> statement-breakpoint
CREATE UNIQUE INDEX "agent_bindings_owner_agent_idx" ON "agent_bindings" USING btree ("owner_id","agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "channel_accounts_channel_user_idx" ON "channel_accounts" USING btree ("channel","channel_user_id");--> statement-breakpoint
CREATE INDEX "channel_accounts_entity_idx" ON "channel_accounts" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_coa_alias_idx" ON "entities" USING btree ("coa_alias");--> statement-breakpoint
CREATE INDEX "entities_parent_idx" ON "entities" USING btree ("parent_entity_id");--> statement-breakpoint
CREATE INDEX "entities_user_idx" ON "entities" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "geid_local_geid_idx" ON "geid_local" USING btree ("geid");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_member_idx" ON "memberships" USING btree ("org_id","member_id");--> statement-breakpoint
CREATE INDEX "coa_chains_entity_idx" ON "coa_chains" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "coa_chains_created_idx" ON "coa_chains" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "comms_log_entity_idx" ON "comms_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "comms_log_created_idx" ON "comms_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "impact_interactions_entity_idx" ON "impact_interactions" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "impact_interactions_coa_idx" ON "impact_interactions" USING btree ("coa_fingerprint");--> statement-breakpoint
CREATE INDEX "provider_balance_log_provider_recorded_idx" ON "provider_balance_log" USING btree ("provider","recorded_at");--> statement-breakpoint
CREATE INDEX "revocation_audit_entity_idx" ON "revocation_audit" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "revocation_audit_token_hash_idx" ON "revocation_audit" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "usage_log_entity_idx" ON "usage_log" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "usage_log_provider_idx" ON "usage_log" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "usage_log_created_idx" ON "usage_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "consents_entity_purpose_idx" ON "consents" USING btree ("entity_id","purpose");--> statement-breakpoint
CREATE INDEX "incidents_status_idx" ON "incidents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "incidents_severity_idx" ON "incidents" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "seals_entity_idx" ON "seals" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "seals_status_idx" ON "seals" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "vendors_name_idx" ON "vendors" USING btree ("name");--> statement-breakpoint
CREATE INDEX "verification_requests_entity_idx" ON "verification_requests" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "verification_requests_status_idx" ON "verification_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "magic_app_instances_user_idx" ON "magic_app_instances" USING btree ("user_entity_id");--> statement-breakpoint
CREATE INDEX "magic_app_instances_project_idx" ON "magic_app_instances" USING btree ("project_path");--> statement-breakpoint
CREATE INDEX "message_queue_status_idx" ON "message_queue" USING btree ("status");--> statement-breakpoint
CREATE INDEX "message_queue_channel_idx" ON "message_queue" USING btree ("channel");--> statement-breakpoint
CREATE INDEX "notifications_entity_idx" ON "notifications" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "notifications_read_idx" ON "notifications" USING btree ("read");--> statement-breakpoint
CREATE INDEX "notifications_created_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "mapps_installed_source_idx" ON "mapps_installed" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "mapps_marketplace_mapp_source_idx" ON "mapps_marketplace" USING btree ("mapp_id","source_ref");--> statement-breakpoint
CREATE INDEX "mapps_marketplace_source_idx" ON "mapps_marketplace" USING btree ("source");--> statement-breakpoint
CREATE INDEX "plugins_installed_source_idx" ON "plugins_installed" USING btree ("source");--> statement-breakpoint
CREATE UNIQUE INDEX "plugins_marketplace_name_source_idx" ON "plugins_marketplace" USING btree ("name","source_ref");--> statement-breakpoint
CREATE INDEX "plugins_marketplace_source_idx" ON "plugins_marketplace" USING btree ("source");--> statement-breakpoint
CREATE INDEX "plugins_marketplace_type_idx" ON "plugins_marketplace" USING btree ("type");--> statement-breakpoint
CREATE INDEX "hf_datasets_status_idx" ON "hf_datasets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hf_installed_status_idx" ON "hf_installed" USING btree ("status");--> statement-breakpoint
CREATE INDEX "hf_installed_pipeline_idx" ON "hf_installed" USING btree ("pipeline_tag");--> statement-breakpoint
CREATE INDEX "scan_runs_status_idx" ON "scan_runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scan_runs_started_idx" ON "scan_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "security_findings_scan_idx" ON "security_findings" USING btree ("scan_id");--> statement-breakpoint
CREATE INDEX "security_findings_severity_idx" ON "security_findings" USING btree ("severity");--> statement-breakpoint
CREATE INDEX "security_findings_status_idx" ON "security_findings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "security_findings_scan_type_idx" ON "security_findings" USING btree ("scan_type");--> statement-breakpoint
CREATE INDEX "security_findings_created_idx" ON "security_findings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cost_records_ts_idx" ON "cost_records" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "cost_records_provider_idx" ON "cost_records" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "cost_records_entity_ts_idx" ON "cost_records" USING btree ("entity_id","ts");