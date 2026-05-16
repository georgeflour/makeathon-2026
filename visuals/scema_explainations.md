# Supabase Schema — NR2Dashboard

Five flat tables in PostgreSQL (Supabase). ~10,000 banking voicebot conversations over 90 days (Greek & English).

---

## `conversations` — one row per call

| Column | Type | Meaning |
|---|---|---|
| `conversation_id` | TEXT PK | Unique call identifier (`conv_<hex>`). Primary key for joining to all other tables. |
| `agent_id` | TEXT | Which bot version handled the call — `agt_bank_voicebot_v2_2_1` (pre-release) or `agt_bank_voicebot_v2_3_0` (post-release). |
| `agent_name` | TEXT | Always `bank_voicebot` in this dataset. |
| `user_id` | TEXT | Stable identifier per caller — the same person calling twice has the same user_id. Use for repeat-caller analysis. |
| `status` | TEXT | Call processing status — always `done` in this dataset. |
| `start_time` | TIMESTAMPTZ | Timestamp when the call started (UTC). Base field for time-series analysis. |
| `start_date` | DATE | Date portion of start_time. Convenient for daily aggregations. |
| `start_hour` | INT | Hour of day (0–23) the call started. Use for intraday volume patterns. |
| `start_dow` | INT | Day of week (0=Sunday, 6=Saturday). Weekend volume is ~30% of weekday. |
| `call_duration_secs` | BIGINT | Total call length in seconds from start to end (AHT). Includes hold, transfer, and bot speech time. |
| `cost_amount` | FLOAT | Estimated EUR cost of the call, computed from duration. |
| `cost_currency` | TEXT | Always `EUR`. |
| `call_direction` | TEXT | Always `inbound` — callers always initiate. |
| `from_number` | TEXT | Caller's phone number in E.164 format, or `anonymous` if withheld. |
| `termination_reason` | TEXT | How the call ended: `completed` (natural end), `transferred_to_human` (escalated), `caller_hung_up` (abandoned), `silence_timeout` (no response detected). |
| `bot_version` | TEXT | `2.2.1` = pre-release build; `2.3.0` = post-release. v2.3.0 outperforms v2.2.1 on auth-category metrics. |
| `transcript_summary` | TEXT | One-sentence AI-generated summary of what happened on the call, in the call's language. |
| `call_successful` | TEXT | Whether the bot resolved the call without human help: `success` = fully resolved, `failure` = bot failed, `unknown` = transferred to human (the bot didn't fail, but didn't finish either). Basis for containment rate. |
| `main_language` | TEXT | Detected spoken language: `el` (Greek) or `en` (English). Detected from speech — may differ from `preferred_language` or `declared_language`. |
| `dv_user_id` | TEXT | Duplicate of `user_id` sourced from the dynamic variables passed at call initiation. Usually identical to `user_id`. |
| `segment` | TEXT | Customer tier set in the bank's CRM and passed at call start: `new` (first-time customer), `returning` (existing standard), `premium` (high-value), `business` (corporate). Premium has the best resolution & CSAT; new has the worst. |
| `region` | TEXT | Customer's registered geographic region: `attica` (Athens), `thessaloniki`, `crete`, `patras`, `larissa`, `other_gr`, `international`. Attica has the highest volume; intent mix differs internationally. |
| `preferred_language` | TEXT | Language preference stored in the customer's bank profile (`el`/`en`). Independent of what language they actually spoke (`main_language`) or selected in the IVR (`declared_language`). |
| `channel_origin` | TEXT | Always `phone` in this dataset — all calls come through the phone channel. |
| `csat_score` | FLOAT | Post-call satisfaction score (1.0–5.0) collected via IVR survey. NULL on ~70% of calls where the survey was not completed or not offered. Average only over non-null rows. |
| `csat_collected` | BOOL | Computed column: TRUE if `csat_score IS NOT NULL`. Indicates whether the customer filled in the post-call survey. |
| `outcome` | TEXT | Ground-truth call outcome label: `resolved` (need met), `escalated` (transferred to human), `abandoned` (caller hung up), `timeout` (silence timeout). Aligns with `call_successful` by construction: resolved ↔ success, escalated ↔ unknown. |

**Key metric formulas:**
- Containment/resolution rate: `AVG(CASE WHEN call_successful='success' THEN 1.0 ELSE 0.0 END)` — threshold 0.85
- Escalation rate: `AVG(CASE WHEN call_successful='unknown' THEN 1.0 ELSE 0.0 END)`
- Abandonment rate: `AVG(CASE WHEN termination_reason='caller_hung_up' THEN 1.0 ELSE 0.0 END)`
- CSAT: `AVG(csat_score) WHERE csat_score IS NOT NULL`
- AHT: `AVG(call_duration_secs)`

---

## `turns` — one row per utterance

Each conversation has multiple turns — alternating between bot (`agent`) and caller (`user`).

| Column | Type | Meaning |
|---|---|---|
| `id` | BIGSERIAL PK | Row identifier. |
| `conversation_id` | TEXT FK | Which call this turn belongs to. |
| `start_time` | TIMESTAMPTZ | Timestamp of this utterance. |
| `agent_id` | TEXT | Bot version that produced this turn. |
| `main_language` | TEXT | `el` / `en` — language of this turn. |
| `role` | TEXT | Who spoke: `agent` (the bot) or `user` (the caller). |
| `time_in_call_secs` | BIGINT | How many seconds into the call this turn started. Use to compute time-to-first-intent. |
| `message` | TEXT | The transcribed text of the utterance. |
| `detected_intent` | TEXT | The banking intent identified from this turn (e.g. `check_balance`, `transfer_money_iban`). Only populated on the specific user turn where the intent first surfaced — NULL on most turns. Filter by `role='user' AND detected_intent IS NOT NULL` to get one intent row per conversation. |
| `intent_confidence` | FLOAT | Model confidence for `detected_intent` (0.78–0.97 range). NULL when `detected_intent` is NULL. |
| `sentiment` | TEXT | Sentiment of this utterance: `positive` / `neutral` / `negative`. Populated on every turn. |
| `turn_number` | BIGINT | Sequential position of this turn within the conversation (1 = first turn). |
| `tool_calls_count` | BIGINT | Number of backend tool calls the bot made during this agent turn (0 on user turns). |

**Intent catalog** (detected_intent values):

| Intent | Category | Auth required |
|---|---|---|
| `check_balance`, `recent_transactions`, `mini_statement` | accounts | yes |
| `report_lost_card`, `block_card`, `card_activation`, `pin_reset`, `replacement_card_status` | cards | yes |
| `transfer_money_iban`, `transfer_status`, `scheduled_transfer_setup` | transfers | yes |
| `loan_info` | loans | no |
| `loan_application_status`, `installment_inquiry` | loans | yes |
| `ebanking_login_issue`, `password_reset` | auth | no |
| `dispute_transaction` | disputes | yes |
| `branch_locator`, `fx_rates` | general | no |
| `update_contact_info` | self_service | yes |

---

## `evaluations` — one row per (conversation × criterion)

Each call is evaluated against 8 quality criteria by an LLM judge. Use this table to compute per-criterion pass rates, compare bot versions, or spot regressions over time.

| Column | Type | Meaning |
|---|---|---|
| `id` | BIGSERIAL PK | Row identifier. |
| `conversation_id` | TEXT FK | Which call this evaluation belongs to. |
| `start_time` | TIMESTAMPTZ | Timestamp of the call (copied for convenience). |
| `agent_id` | TEXT | Bot version. |
| `bot_version` | TEXT | `2.2.1` / `2.3.0`. |
| `main_language` | TEXT | `el` / `en`. |
| `segment` | TEXT | Customer segment (copied for slicing). |
| `region` | TEXT | Geographic region (copied for slicing). |
| `criterion_id` | TEXT | Which quality criterion is being evaluated (see below). |
| `result` | TEXT | Evaluation outcome: `success` / `failure` / `unknown`. `unknown` means the criterion was not applicable for this call. When computing pass rates, exclude `unknown` rows. |
| `rationale` | TEXT | LLM-generated explanation of why this criterion passed or failed on this specific call. |

**criterion_id — what each criterion measures:**

| criterion_id | What `success` means | Notes |
|---|---|---|
| `authentication_completed` | The caller successfully authenticated when the intent required it | `unknown` for intents that don't need auth (e.g. `branch_locator`) |
| `intent_resolved` | The bot fully addressed the caller's need without handing off to a human | LLM judge — agrees with `call_successful` ~95% of the time; 5% disagreement cases are interesting |
| `escalation_triggered` | A handoff to a human agent actually occurred during the call | `success` means it DID happen — this is a state flag, not a quality signal; interpret in context |
| `compliance_disclaimer_given` | The required regulatory disclaimer was read (for loan/dispute intents) | `unknown` for intents where no disclaimer is legally required |
| `pii_handled_safely` | The bot avoided repeating or logging sensitive personal data (IBAN, card numbers, etc.) | Failure rate slightly higher on v2.2.1 |
| `fallback_count_acceptable` | The call had ≤2 "I didn't understand" fallback turns | Strongly correlated with pain-point intents and poor CSAT |
| `language_consistency` | The bot responded in the caller's detected language throughout the entire call | ~3% failure rate overall |
| `tool_call_success_rate` | >80% of backend tool calls on this call succeeded | Failures spike during the incident window for transfer-category intents |

---

## `data_collection` — one row per (conversation × extracted field)

Each call produces 14 extracted data fields — structured facts the LLM pulled from the conversation. `value` is always TEXT; `unknown` means the field was not applicable or could not be determined.

| Column | Type | Meaning |
|---|---|---|
| `id` | BIGSERIAL PK | Row identifier. |
| `conversation_id` | TEXT FK | Which call this data belongs to. |
| `start_time` | TIMESTAMPTZ | Timestamp of the call (copied for convenience). |
| `agent_id` | TEXT | Bot version. |
| `bot_version` | TEXT | `2.2.1` / `2.3.0`. |
| `main_language` | TEXT | `el` / `en`. |
| `segment` | TEXT | Customer segment (copied for slicing). |
| `region` | TEXT | Geographic region (copied for slicing). |
| `field_id` | TEXT | Which data field was extracted (see below). |
| `value` | TEXT | The extracted value as a string. Always cast explicitly in SQL if you need numeric comparisons. |
| `rationale` | TEXT | LLM-generated explanation of why this value was assigned. |

**field_id — extracted fields and their values:**

| field_id | Values | Notes |
|---|---|---|
| `customer_segment` | `new` / `returning` / `premium` / `business` / `unknown` | Same as `conversations.segment` — duplicated here for the analysis layer |
| `region` | `attica` / `thessaloniki` / `crete` / `patras` / `larissa` / `other_gr` / `international` | Same as `conversations.region` |
| `declared_language` | `el` / `en` | What the caller selected in the IVR menu — may differ from `main_language` (detected) and `preferred_language` (CRM profile) |
| `caller_line_type` | `mobile` / `landline` / `international` / `withheld` | Type of phone line used; `withheld` (number hidden) correlates with higher escalation |
| `account_type_referenced` | `savings` / `checking` / `credit_card` / `loan` / `unknown` | The type of bank account discussed; only populated when the intent involves accounts/cards/loans |
| `transfer_amount_bucket` | `<100` / `100-500` / `500-2000` / `2000-10000` / `>10000` / `unknown` | Transfer value range; only populated for transfer intents; `>10000` has elevated escalation rate |
| `transfer_destination_country` | `gr` / `eu` / `non_eu` / `unknown` | Where the transfer was going; only populated for transfer intents |
| `card_type_referenced` | `debit` / `credit` / `prepaid` / `unknown` | Type of card discussed; only populated for card intents |
| `loan_type_inquired` | `personal` / `mortgage` / `auto` / `business` / `unknown` | Type of loan discussed; only populated for loan intents |
| `auth_method_used` | `otp_sms` / `biometric` / `security_questions` / `none` / `failed` | How the caller authenticated; biometric share jumps significantly on v2.3.0 vs v2.2.1 |
| `self_service_completed` | `true` / `false` / `not_applicable` | Whether the caller completed the action themselves without a human; the primary KPI most ops teams track |
| `promised_callback` | `true` / `false` | Whether a callback was promised to the caller; baseline ~6%, rises to ~25% during the incident window |
| `complaint_detected` | `true` / `false` | Whether the caller expressed a complaint — distinct from `sentiment` (a calm complaint still flags `true`) |
| `topic_tags` | comma-separated string, 0–3 tags | Free-form topic labels from a ~30-tag vocabulary describing what the call was about |

---

## `tool_calls` — one row per backend tool invocation

The bot calls backend tools (e.g. account lookup, transfer initiation) during agent turns. This table records each invocation for reliability and latency analysis.

| Column | Type | Meaning |
|---|---|---|
| `id` | BIGSERIAL PK | Row identifier. |
| `conversation_id` | TEXT FK | Which call triggered this tool invocation. |
| `start_time` | TIMESTAMPTZ | When the tool was called. |
| `agent_id` | TEXT | Bot version. |
| `main_language` | TEXT | `el` / `en`. |
| `time_in_call_secs` | BIGINT | How many seconds into the call the tool was invoked. |
| `tool_name` | TEXT | Name of the backend tool called (e.g. `get_account_balance`, `initiate_transfer`). |
| `success` | BOOL | Whether the tool call returned successfully. Tool failures spike during the incident window for transfer-category intents. |
| `latency_ms` | BIGINT | Round-trip response time in milliseconds. Use median or p95 — the mean is inflated by outliers. |

**Key metric formulas:**
- Tool success rate per tool: `AVG(CAST(success AS FLOAT)) GROUP BY tool_name`
- Latency p95 per tool: `PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_ms) GROUP BY tool_name`
