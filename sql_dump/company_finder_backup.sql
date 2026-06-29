--
-- PostgreSQL database dump
--

\restrict ooKggaaURZi8phev0pnlzGoegYzwSwTCghs4XYSvehaSUmI1wagwa5e2HwpLZ8s

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.4

-- Started on 2026-06-25 15:17:45

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- TOC entry 17 (class 2615 OID 2200)
-- Name: public; Type: SCHEMA; Schema: -; Owner: pg_database_owner
--

CREATE SCHEMA public;


ALTER SCHEMA public OWNER TO pg_database_owner;

--
-- TOC entry 4088 (class 0 OID 0)
-- Dependencies: 17
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: pg_database_owner
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- TOC entry 487 (class 1255 OID 34224)
-- Name: convert_demo_to_paid(uuid, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.convert_demo_to_paid(p_company_id uuid, p_plan text, p_months integer DEFAULT 12) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE companies SET
    plan              = p_plan,
    is_demo           = FALSE,
    demo_converted    = TRUE,
    status            = 'active',
    setup_fee_paid    = FALSE,
    renewal_fee_paid  = FALSE,
    plan_start_date   = NOW(),
    plan_end_date     = NOW() + (p_months || ' months')::INTERVAL,
    demo_expires_at   = NULL
  WHERE id = p_company_id;

  DELETE FROM demo_feature_flags WHERE company_id = p_company_id;
  DELETE FROM demo_usage         WHERE company_id = p_company_id;
END;
$$;


ALTER FUNCTION public.convert_demo_to_paid(p_company_id uuid, p_plan text, p_months integer) OWNER TO postgres;

--
-- TOC entry 486 (class 1255 OID 34223)
-- Name: create_demo_company(text, text, integer); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.create_demo_company(p_name text, p_email text, p_days integer DEFAULT 7) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_company_id UUID;
BEGIN
  INSERT INTO companies (
    name, email, plan, status, is_demo,
    demo_expires_at, setup_fee_paid, renewal_fee_paid,
    plan_start_date, plan_end_date
  ) VALUES (
    p_name, p_email, 'demo', 'active', TRUE,
    NOW() + (p_days || ' days')::INTERVAL, TRUE, TRUE,
    NOW(), NOW() + (p_days || ' days')::INTERVAL
  )
  RETURNING id INTO v_company_id;

  INSERT INTO demo_usage (company_id) VALUES (v_company_id);
  INSERT INTO demo_feature_flags (company_id) VALUES (v_company_id);

  RETURN v_company_id;
END;
$$;


ALTER FUNCTION public.create_demo_company(p_name text, p_email text, p_days integer) OWNER TO postgres;

--
-- TOC entry 484 (class 1255 OID 33893)
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.handle_new_user() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  );
  RETURN NEW;
END;
$$;


ALTER FUNCTION public.handle_new_user() OWNER TO postgres;

--
-- TOC entry 488 (class 1255 OID 34225)
-- Name: suspend_expired_demos(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.suspend_expired_demos() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE companies SET
    status = 'suspended',
    notes  = 'Demo expired on ' || NOW()::DATE
  WHERE
    is_demo          = TRUE
    AND demo_converted = FALSE
    AND demo_expires_at < NOW()
    AND status         = 'active';
END;
$$;


ALTER FUNCTION public.suspend_expired_demos() OWNER TO postgres;

--
-- TOC entry 489 (class 1255 OID 34226)
-- Name: suspend_expired_plans(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.suspend_expired_plans() RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE companies SET status = 'suspended'
  WHERE
    is_demo      = FALSE
    AND plan_end_date < NOW()
    AND status   = 'active';
END;
$$;


ALTER FUNCTION public.suspend_expired_plans() OWNER TO postgres;

--
-- TOC entry 485 (class 1255 OID 34221)
-- Name: update_usage_summary(); Type: FUNCTION; Schema: public; Owner: postgres
--

CREATE FUNCTION public.update_usage_summary() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_month TEXT := TO_CHAR(NEW.created_at, 'YYYY-MM');
BEGIN
  INSERT INTO usage_monthly_summary (company_id, month)
  VALUES (NEW.company_id, v_month)
  ON CONFLICT (company_id, month) DO NOTHING;

  IF NEW.action = 'google_search' THEN
    UPDATE usage_monthly_summary
    SET scrape_count = scrape_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;

  ELSIF NEW.action = 'email_sent' THEN
    UPDATE usage_monthly_summary
    SET email_count = email_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;

  ELSIF NEW.action = 'export' THEN
    UPDATE usage_monthly_summary
    SET export_count = export_count + NEW.units, updated_at = NOW()
    WHERE company_id = NEW.company_id AND month = v_month;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION public.update_usage_summary() OWNER TO postgres;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- TOC entry 359 (class 1259 OID 33920)
-- Name: companies; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.companies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    email text,
    industry text,
    location text,
    plan text DEFAULT 'starter'::text,
    status text DEFAULT 'inactive'::text,
    setup_fee_paid boolean DEFAULT false,
    renewal_fee_paid boolean DEFAULT false,
    plan_start_date timestamp with time zone,
    plan_end_date timestamp with time zone,
    is_demo boolean DEFAULT false,
    demo_expires_at timestamp with time zone,
    demo_converted boolean DEFAULT false,
    demo_notes text,
    assigned_sales_rep text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.companies OWNER TO postgres;

--
-- TOC entry 358 (class 1259 OID 33913)
-- Name: plan_limits; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.plan_limits (
    plan text NOT NULL,
    scrape_limit integer NOT NULL,
    email_limit integer NOT NULL,
    export_limit integer,
    max_leads integer,
    setup_fee numeric NOT NULL,
    renewal_fee numeric NOT NULL,
    duration_days integer
);


ALTER TABLE public.plan_limits OWNER TO postgres;

--
-- TOC entry 362 (class 1259 OID 34091)
-- Name: usage_monthly_summary; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usage_monthly_summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    month text NOT NULL,
    scrape_count integer DEFAULT 0,
    email_count integer DEFAULT 0,
    export_count integer DEFAULT 0,
    total_cost numeric DEFAULT 0,
    updated_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.usage_monthly_summary OWNER TO postgres;

--
-- TOC entry 369 (class 1259 OID 34227)
-- Name: admin_company_overview; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.admin_company_overview AS
 SELECT c.id,
    c.name,
    c.email,
    c.plan,
    c.status,
    c.is_demo,
    c.demo_expires_at,
    c.demo_converted,
    c.plan_end_date,
    c.setup_fee_paid,
    c.renewal_fee_paid,
    COALESCE(s.scrape_count, 0) AS scrapes_this_month,
    COALESCE(s.email_count, 0) AS emails_this_month,
    COALESCE(s.export_count, 0) AS exports_this_month,
    pl.scrape_limit,
    pl.email_limit,
    pl.export_limit
   FROM ((public.companies c
     LEFT JOIN public.plan_limits pl ON ((pl.plan = c.plan)))
     LEFT JOIN public.usage_monthly_summary s ON (((s.company_id = c.id) AND (s.month = to_char(now(), 'YYYY-MM'::text)))))
  ORDER BY c.created_at DESC;


ALTER VIEW public.admin_company_overview OWNER TO postgres;

--
-- TOC entry 363 (class 1259 OID 34112)
-- Name: demo_usage; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.demo_usage (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    scrape_used integer DEFAULT 0,
    emails_used integer DEFAULT 0,
    leads_visible integer DEFAULT 0,
    last_active timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.demo_usage OWNER TO postgres;

--
-- TOC entry 370 (class 1259 OID 34232)
-- Name: admin_demo_overview; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.admin_demo_overview AS
 SELECT c.id,
    c.name,
    c.email,
    c.status,
    c.demo_expires_at,
    round((EXTRACT(epoch FROM (c.demo_expires_at - now())) / (86400)::numeric)) AS days_remaining,
    c.demo_converted,
    c.demo_notes,
    COALESCE(du.scrape_used, 0) AS scrapes_used,
    COALESCE(du.emails_used, 0) AS emails_used,
    COALESCE(du.leads_visible, 0) AS leads_viewed,
    du.last_active
   FROM (public.companies c
     LEFT JOIN public.demo_usage du ON ((du.company_id = c.id)))
  WHERE (c.is_demo = true)
  ORDER BY c.demo_expires_at;


ALTER VIEW public.admin_demo_overview OWNER TO postgres;

--
-- TOC entry 364 (class 1259 OID 34128)
-- Name: demo_feature_flags; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.demo_feature_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    can_generate_leads boolean DEFAULT true,
    can_view_leads boolean DEFAULT true,
    max_leads_visible integer DEFAULT 20,
    can_send_emails boolean DEFAULT true,
    can_view_templates boolean DEFAULT true,
    can_create_templates boolean DEFAULT false,
    can_export boolean DEFAULT false,
    can_scrape boolean DEFAULT true,
    can_view_dashboard boolean DEFAULT true,
    can_view_usage boolean DEFAULT true,
    can_view_billing boolean DEFAULT false,
    can_invite_users boolean DEFAULT false,
    can_change_plan boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.demo_feature_flags OWNER TO postgres;

--
-- TOC entry 373 (class 1259 OID 34247)
-- Name: email_campaigns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.email_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    template_id uuid,
    name text,
    status text DEFAULT 'draft'::text,
    total_recipients integer DEFAULT 0,
    sent_count integer DEFAULT 0,
    opened_count integer DEFAULT 0,
    clicked_count integer DEFAULT 0,
    bounced_count integer DEFAULT 0,
    scheduled_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.email_campaigns OWNER TO postgres;

--
-- TOC entry 374 (class 1259 OID 34273)
-- Name: email_events; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.email_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    campaign_id uuid,
    email text,
    event text,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.email_events OWNER TO postgres;

--
-- TOC entry 360 (class 1259 OID 34032)
-- Name: email_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    title text,
    subject text,
    body text,
    tag text,
    use_count integer DEFAULT 0,
    last_used timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.email_templates OWNER TO postgres;

--
-- TOC entry 365 (class 1259 OID 34154)
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    invoice_type text NOT NULL,
    amount numeric NOT NULL,
    currency text DEFAULT 'NGN'::text,
    status text DEFAULT 'pending'::text,
    due_date date,
    paid_date date,
    payment_method text,
    reference text,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.invoices OWNER TO postgres;

--
-- TOC entry 355 (class 1259 OID 17560)
-- Name: leads; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.leads (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    job_id uuid,
    place_id text NOT NULL,
    name text NOT NULL,
    address text,
    website text,
    emails text[] DEFAULT '{}'::text[],
    phones text[] DEFAULT '{}'::text[],
    status text DEFAULT 'new'::text NOT NULL,
    mail_sent boolean DEFAULT false NOT NULL,
    category text,
    location text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid,
    state text,
    local_govt text,
    lead_score integer DEFAULT 0,
    linkedin_url text,
    source text DEFAULT 'google_places'::text,
    enriched_at timestamp with time zone,
    CONSTRAINT leads_status_check CHECK ((status = ANY (ARRAY['new'::text, 'contacted'::text, 'qualified'::text, 'ignored'::text])))
);


ALTER TABLE public.leads OWNER TO postgres;

--
-- TOC entry 356 (class 1259 OID 17581)
-- Name: mail_templates; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.mail_templates (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    title text NOT NULL,
    subject text NOT NULL,
    body text NOT NULL,
    tag text DEFAULT 'General'::text NOT NULL,
    use_count integer DEFAULT 0 NOT NULL,
    last_used timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT mail_templates_tag_check CHECK ((tag = ANY (ARRAY['Outreach'::text, 'Follow-up'::text, 'Partnership'::text, 'Introduction'::text, 'Promotion'::text, 'General'::text])))
);


ALTER TABLE public.mail_templates OWNER TO postgres;

--
-- TOC entry 366 (class 1259 OID 34173)
-- Name: overage_charges; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.overage_charges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    invoice_id uuid,
    month text NOT NULL,
    action text NOT NULL,
    units_over integer NOT NULL,
    rate numeric NOT NULL,
    total numeric NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.overage_charges OWNER TO postgres;

--
-- TOC entry 371 (class 1259 OID 34237)
-- Name: renewals_due; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.renewals_due AS
 SELECT id,
    name,
    email,
    plan,
    plan_end_date,
    renewal_fee_paid,
    round((EXTRACT(epoch FROM (plan_end_date - now())) / (86400)::numeric)) AS days_until_renewal
   FROM public.companies
  WHERE ((status = 'active'::text) AND (is_demo = false) AND ((plan_end_date >= now()) AND (plan_end_date <= (now() + '30 days'::interval))))
  ORDER BY plan_end_date;


ALTER VIEW public.renewals_due OWNER TO postgres;

--
-- TOC entry 372 (class 1259 OID 34241)
-- Name: revenue_summary; Type: VIEW; Schema: public; Owner: postgres
--

CREATE VIEW public.revenue_summary AS
 SELECT count(*) AS total_clients,
    count(*) FILTER (WHERE (c.status = 'active'::text)) AS active_clients,
    count(*) FILTER (WHERE (c.is_demo = true)) AS demo_clients,
    count(*) FILTER (WHERE (c.status = 'suspended'::text)) AS suspended_clients,
    sum(i.amount) FILTER (WHERE (i.status = 'paid'::text)) AS total_revenue_ngn,
    count(i.*) FILTER (WHERE (i.status = 'pending'::text)) AS pending_invoices,
    sum(i.amount) FILTER (WHERE (i.status = 'pending'::text)) AS pending_amount_ngn
   FROM (public.companies c
     LEFT JOIN public.invoices i ON ((i.company_id = c.id)));


ALTER VIEW public.revenue_summary OWNER TO postgres;

--
-- TOC entry 367 (class 1259 OID 34193)
-- Name: sales_pipeline; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sales_pipeline (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    contact_name text,
    contact_role text,
    email text,
    phone text,
    linkedin_url text,
    source text,
    status text DEFAULT 'not_contacted'::text,
    deal_value numeric,
    notes text,
    last_contacted timestamp with time zone,
    follow_up_date date,
    assigned_to text,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.sales_pipeline OWNER TO postgres;

--
-- TOC entry 354 (class 1259 OID 17547)
-- Name: scrape_jobs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.scrape_jobs (
    id uuid DEFAULT extensions.uuid_generate_v4() NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    category text NOT NULL,
    location text NOT NULL,
    total integer DEFAULT 0 NOT NULL,
    processed integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    company_id uuid,
    state text,
    local_govt text,
    error_msg text,
    started_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    CONSTRAINT scrape_jobs_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'completed'::text, 'failed'::text])))
);


ALTER TABLE public.scrape_jobs OWNER TO postgres;

--
-- TOC entry 368 (class 1259 OID 34205)
-- Name: system_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid,
    action text NOT NULL,
    target_id uuid,
    details jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.system_logs OWNER TO postgres;

--
-- TOC entry 361 (class 1259 OID 34072)
-- Name: usage_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.usage_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_id uuid,
    action text NOT NULL,
    units integer DEFAULT 1,
    cost numeric DEFAULT 0,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);


ALTER TABLE public.usage_logs OWNER TO postgres;

--
-- TOC entry 357 (class 1259 OID 33876)
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    company_id uuid,
    email text NOT NULL,
    full_name text,
    role text DEFAULT 'company_admin'::text NOT NULL,
    is_active boolean DEFAULT true NOT NULL,
    last_login timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- TOC entry 4071 (class 0 OID 33920)
-- Dependencies: 359
-- Data for Name: companies; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.companies (id, name, email, industry, location, plan, status, setup_fee_paid, renewal_fee_paid, plan_start_date, plan_end_date, is_demo, demo_expires_at, demo_converted, demo_notes, assigned_sales_rep, notes, created_at) FROM stdin;
1f7583d8-4b4e-4b5a-ada4-c9fabc608533	AnchorHMO	team@anchorhmo.com	\N	\N	enterprise	active	t	t	2026-06-25 11:40:29.53165+00	2027-06-25 11:40:29.53165+00	f	\N	f	\N	\N	\N	2026-06-25 11:40:29.53165+00
\.


--
-- TOC entry 4076 (class 0 OID 34128)
-- Dependencies: 364
-- Data for Name: demo_feature_flags; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.demo_feature_flags (id, company_id, can_generate_leads, can_view_leads, max_leads_visible, can_send_emails, can_view_templates, can_create_templates, can_export, can_scrape, can_view_dashboard, can_view_usage, can_view_billing, can_invite_users, can_change_plan, created_at) FROM stdin;
\.


--
-- TOC entry 4075 (class 0 OID 34112)
-- Dependencies: 363
-- Data for Name: demo_usage; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.demo_usage (id, company_id, scrape_used, emails_used, leads_visible, last_active, created_at) FROM stdin;
\.


--
-- TOC entry 4081 (class 0 OID 34247)
-- Dependencies: 373
-- Data for Name: email_campaigns; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.email_campaigns (id, company_id, template_id, name, status, total_recipients, sent_count, opened_count, clicked_count, bounced_count, scheduled_at, completed_at, created_at) FROM stdin;
\.


--
-- TOC entry 4082 (class 0 OID 34273)
-- Dependencies: 374
-- Data for Name: email_events; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.email_events (id, company_id, campaign_id, email, event, metadata, created_at) FROM stdin;
\.


--
-- TOC entry 4072 (class 0 OID 34032)
-- Dependencies: 360
-- Data for Name: email_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.email_templates (id, company_id, title, subject, body, tag, use_count, last_used, created_at) FROM stdin;
96c3b106-0044-432c-b1bb-09d7a643add2	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	check up	check up	how are you doing	General	0	\N	2026-05-26 15:28:33.646425+00
\.


--
-- TOC entry 4077 (class 0 OID 34154)
-- Dependencies: 365
-- Data for Name: invoices; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.invoices (id, company_id, invoice_type, amount, currency, status, due_date, paid_date, payment_method, reference, notes, created_at) FROM stdin;
\.


--
-- TOC entry 4067 (class 0 OID 17560)
-- Dependencies: 355
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.leads (id, job_id, place_id, name, address, website, emails, phones, status, mail_sent, category, location, created_at, company_id, state, local_govt, lead_score, linkedin_url, source, enriched_at) FROM stdin;
d8d63f57-b6b6-47e3-b1e6-20536b7fb449	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJ6ZkVN0j1OxARChq_C64Bhtg	Pinnacle Oil & Gas Limited	6 Sir Samuel Manuwa St, Victoria Island, Lagos 106104, Lagos, Nigeria	https://pinnacleoilandgas.com/	{Island+234-908-750-2020info@pinnacleoilandgas.com,info@pinnacleoilandgas.com}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:22:37.412832+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
eb0202f5-74b4-4114-ae3e-942480a93ab7	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJ6VBdqi31OxARh3j-sUvtd1I	Sun Trust Oil	7A Akin Olugbade St, Victoria Island, Lagos 106104, Lagos, Nigeria	http://www.suntrustatlantic.com/	{Addressinfo@suntrustatlantic.comAbout}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:41.113477+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
13451a92-d4cf-4fb5-a926-4bbf676ffcdb	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJhY9IoUiZQhARL4P9tcJ11_k	Learnedsoft Technology	da lead plaza at. 44, st. micheal's road by mosque, Aba, 450101, Abia, Nigeria	http://learnedsoft.com/	{contact@learnedsoft.com,contact@Learnedsoft.com}	{}	new	f	Technology Companies	Abia	2026-06-22 13:35:45.522717+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
0c6af2b3-d219-4269-a6fd-ce2e72dfee7f	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJB6Z3mTDDQhAR6i7keTEV8L0	ECR Technology services	51 Macaulay St, Umu Obasi, Umuahia 440236, Abia, Nigeria	https://www.ecr-ts.com/	{}	{}	new	f	Technology Companies	Abia	2026-06-22 13:35:48.558678+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
d69492c2-ed38-446e-be53-dc48fdad919e	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJUe9qU6XdQhARzxH2-hlJ4PI	Softicu Tech Hub	10, by Ogoja St, Okigwe Rd, Umuahia, 440221, Abia, Nigeria	https://softicuhub.org/	{hello@softicuhub.org}	{}	new	f	Technology Companies	Abia	2026-06-22 13:35:52.360991+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
c31d5167-975e-4842-9ddf-770fd6317e5e	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJx6Xsab5XXRARniFtAm0Z7FA	Seal-World Technologies: Digital Marketing & Website Design Company in Nigeria	7 Nsikak Eduok Ave, Uyo 520103, Akwa Ibom, Nigeria	https://www.sealworld.com.ng/	{info@sealworld.com.ng}	{+2348033563242}	new	f	Technology Companies	Abia	2026-06-22 13:35:57.100898+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
c9c36bb7-2285-49cd-83b4-6b9ac6d96fc8	726be333-ee5d-4b7a-a931-181f8246f1ef	ChIJoYLM3tWTQxAR3BkDi-Vf4Rg	Chukwunenye Microfinance Bank Ltd	35 Nnobi - Nkpor Rd, beside Catholic Cathedral Premises, Nkpor, Nnewi 434105, Anambra, Nigeria	http://chukwunenyemfb.com/	{}	{}	new	f	Microfinance Banks	Anambra	2026-06-22 14:34:25.105346+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
daf0f4e2-d9ed-46ab-b43d-ae7efbbd0ccd	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJtRJIch6OOxARajN_vyAoe6M	Sahara Group	Airport Rd, Mafoluku Oshodi, Lagos 102214, Lagos, Nigeria	http://www.sahara-group.com/	{}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:46.465093+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
eed84757-d885-4e7d-9580-4ea9d1b4aff4	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJkdh8A_aTOxAREQ_7Cy2S9bU	Masters Energy Oil & Gas Ltd.	21 Remi Fani-Kayode Ave, Ikeja GRA, Lagos 101233, Lagos, Nigeria	https://www.mastersenergyltd.com/	{customerservice@mastersenergyltd.com,Emailinfo@mastersenergyltd.com}	{+2349068671826,06864929199}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:53.556404+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
6e765ff9-51ef-45b8-b77e-8e2398cee18d	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJSQq3KcfTQBARNbgMUhHQY_8	Dubri Oil Company Limited	13a A.J. Marinho Dr, Victoria Island, Lagos 106104, Lagos, Nigeria	http://www.dubri.com/	{}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:58.263231+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
471ff19d-a1bb-4271-9627-6b551897ed98	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJ2ZMKvC6LOxARo6JlPtGWXZE	11PLC (formerly Mobil Oil Nig. Plc)	1 Mobil Rd, Apapa, Lagos 102272, Lagos, Nigeria	http://www.11plc.com/	{info@iwv.irn.temporary.site,info@11plc.com}	{00000000000,00000818030,03130954586,02127075195}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:24:05.763842+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
6a16e51b-66ac-4d28-9e98-ce185ed7369a	5656212a-d80c-47e2-99a1-12bfe388f9b9	ChIJL6DTSYKMOxARzm0UaOkq4F8	Asset Matrix Microfinance Bank Limited	68 Herbert Macaulay Street, Ebute Metta, Adekunle, Lagos 101245, Lagos, Nigeria	https://www.assetmatrixmfb.com/	{info@assetmatrixmfb.com}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:05.610963+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2beb1e28-ec2f-4a3a-ba8a-bc0c41c62443	5656212a-d80c-47e2-99a1-12bfe388f9b9	ChIJrchVaV-MOxAR6vSd7BjRK8Y	Baobab Microfinance Bank Nigeria Limited	314 Herbert Macaulay Wy, Sabo yaba, Lagos 101245, Lagos, Nigeria	http://baobab.bz/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:13.732188+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
951fab4a-764e-438c-8711-4b66d8a60e51	5656212a-d80c-47e2-99a1-12bfe388f9b9	ChIJybe_LMONOxAR6ZgcdM9Q7Q8	EDFIN MICROFINANCE BANK LTD	152 Ogunlana Dr, Surulere, Lagos 101283, Lagos, Nigeria	https://edfinmfb.com/	{contactus@edfinmfb.com,whistleblowing@edfinmfb.comRegulated}	{08098866334,08094546334}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:22.027917+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
0e566321-e9ff-4736-a53a-13795f254a8c	5656212a-d80c-47e2-99a1-12bfe388f9b9	ChIJNVS9lhKLOxARDqtY7Yihnuw	ALERT MICROFINANCE BANK	123 Herbert Macaulay Wy, Lagos Island, Lagos 101212, Lagos, Nigeria	http://www.alertmfb.com.ng/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:47.530536+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
d7bcc289-626f-46f4-a262-0142774849d9	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJX44RzAyMOxARrqRckhADbJo	Charis Microfinance Bank Ltd	82 Bode Thomas St, Surulere, Lagos 101211, Lagos, Nigeria	https://www.charismfb.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:09:47.139361+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
b7d03691-6d28-462f-b7f4-4557cbbf93bf	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJvYjaYAqLOxARER5hNyfWXK8	VFD Microfinance Bank Limited (VBank)	5th Floor, Elephant House, 214 Broad St, Marina Island, Lagos 100221, Lagos, Nigeria	http://www.vbank.ng/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:09.613965+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
e3e2f513-c47f-4c13-ad60-c350e6160e68	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJQ1cQeD2MOxARhyL3M5VAyac	PERSONAL TRUST MICROFINANCE BANK LIMITED	32 Ikorodu Rd, Jibowu, Lagos 102215, Lagos, Nigeria	http://www.personaltrustmfb.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:09:53.492396+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
915c0a7b-bf6b-40eb-b4dd-133c86d8052f	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJIbiazBGLOxARKqb7Sgdm-qA	CAPSTONE MICROFINANCE BANK LTD	187 Igbosere Rd, Lagos Island, Lagos 102273, Lagos, Nigeria	https://www.capstonemfb.com/	{605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com,8eb368c655b84e029ed79ad7a5c1718e@sentry.wixpress.com}	{00000095367}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:54.772531+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
05d5820d-8440-47c2-b775-ed15373845c0	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJS10MkySLOxARNoCRCEsyPrc	Boctrust Microfinance Bank	1st Floor, 26 Moloney St, Lagos Island, Lagos 101231, Lagos, Nigeria	http://www.boctrustmfb.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:17.532412+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
3e9ccc1f-bc55-4edb-a7fc-4a2b081f2104	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJr55ahuSNOxARzHjB3j_1Xvo	Fortress Microfinance Bank	Local Government Area, 223 Ikorodu Rd, Ilupeju, Lagos 102215, Lagos, Nigeria	https://www.fortressmicrofinancebank.com/	{info@fortressmicrofinancebank.com}	{07035836168}	new	f	Microfinance Banks	Lagos	2026-05-18 11:11:00.568996+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
a6197389-f816-47aa-bac9-37d7b52de3c2	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJl4ixFXCSOxARKV8CADr_9w4	MKOBO Microfinance Bank	13 Hughes Ave, Alagomeji-Yaba, Lagos 101245, Lagos, Nigeria	https://www.mkobobank.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:09:59.129684+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
a3aa0721-0110-4691-a5c1-d98520c772ba	5656212a-d80c-47e2-99a1-12bfe388f9b9	ChIJdS8_t5uSOxAR0V4WWwAERis	Supreme Microfinance Bank	159 Ogudu Rd, Ogudu, Lagos 105102, Lagos, Nigeria	http://suprememfb.com/	{info@suprememfb.com,smfbinfo@yahoo.com,suprememfb@yahoo.com}	{07046519331,07046384373,07046384389,07046384386,00000000000,00000818030,03130954586,02127075195,07046384387,07046384385}	new	f	Microfinance Banks	Lagos	2026-05-18 11:11:15.482596+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
c2e9a060-161a-4d56-b687-94a6c344e6d6	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJRzs0uTuSOxARg3-Dowd2MN0	Resolution Law Firm	Resolution House, 161 Ajao Rd, off Obafemi Awolowo Way, Ikeja, Lagos 101233, Lagos, Nigeria	https://www.resolutionlawng.com/	{}	{}	new	f	Law Firms	Lagos	2026-05-18 14:46:45.225584+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
91f2f5e5-6d8e-4e07-a78d-1d76bd3c7b3e	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJp9ZU2IqSOxARffeJTjrmN4Y	DavoDani Microfinance Bank (DDMFB)	28 Ogudu Rd, Ojota, Lagos 105102, Lagos, Nigeria	https://davodanimfb.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:10:38.280224+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2de6d3cf-775e-4acb-9c49-9de225d2781f	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJSTvgzBaTOxARRJOLBFurkp0	BAM & GAD SOLICITORS	17/19 Allen Avenue Ikeja, Allen, Lagos 100001, Lagos, Nigeria	http://www.bamandgadsolicitors.com.ng/	{info@bamandgadsolicitors.com.ng}	{}	new	f	Law Firms	Lagos	2026-05-18 14:47:15.601438+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
43740f23-e84a-4821-af07-15a35c23063d	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJH8TKrzrBOxARaB4AeZafXiw	CHAMAN LAW FIRM	115, Obafemi Awolowo Way, Allen, beside Lagos Airport Hotel, Ikeja, 100281, Lagos, Nigeria	https://www.chamanlawfirm.com/	{info@chamanlawfirm.com,chamanlawfirm@gmail.com}	{08065553671,08096888818,+2348096888818,+2348065553671,+2348024200080}	new	f	Law Firms	Lagos	2026-05-18 14:47:42.161024+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
66e0a1b3-68ee-470d-96ec-44eddecea27f	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJJbxxhQOROxARaQ3z-vbRj8E	Stellas Microfinance Bank	164 Lagos-Abeokuta Expy, Ijaiye, Lagos 102212, Lagos, Nigeria	http://www.stellasbank.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 14:49:26.03353+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
fda3a03b-2da1-4ec5-ad5c-32f3764042c4	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJGfScBCuLOxARrJ-nHwBO5B8	Banwo & Ighodalo	48 Awolowo Rd, Ikoyi, Lagos 106104, Lagos, Nigeria	http://www.banwo-ighodalo.com/	{banwigho@banwo-ighodalo.com}	{02013302934}	new	f	Law Firms	Lagos	2026-05-18 14:49:29.090678+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2c1df79f-05ba-49b9-866c-386b16456cba	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJM6TY9ySSOxAR2tupruU_D8I	Headway Microfinance Bank Limited	1 Atunwa St, Opebi, Lagos 101233, Lagos, Nigeria	http://headwaymfbng.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 14:49:33.525104+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
e981b836-60aa-4a98-99c0-be6b3687f130	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJnbzMFEePOxARyIi8yysWhw4	Adeola Oyinlade & Co	50 Olonode St, Yaba, Lagos 101245, Lagos, Nigeria	https://www.adeolaoyinlade.com/	{}	{}	new	f	Law Firms	Lagos	2026-05-18 14:49:33.564195+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
505f4a44-72e9-403b-b3af-1831af122cd9	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJE9QsfF-ROxAR5q6LprKzlEc	Shepherd Trust Microfinance Bank	No 12 Oladele Kadiri Cl, Ogba, Lagos 101233, Lagos, Nigeria	http://www.stmfb.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 14:49:37.65001+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
7767933c-61e9-4a3f-95a3-4d6f9ff82c6b	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJ4bhAoM30OxARhyTSJO7KOow	Aluko & Oyebode	1 Murtala Muhammed Dr, Ikoyi, Lagos 106104, Lagos, Nigeria	http://www.aluko-oyebode.com/	{}	{09534470144,09992846172,09084790765,01224908590}	new	f	Law Firms	Lagos	2026-05-18 14:49:47.153411+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
5112832a-c2f9-4b1b-8b1a-f14664650837	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJ2-MJUxiLOxARkni9RyJ713o	G Elias	6 Broad St, Lagos Island, Lagos 102273, Lagos, Nigeria	http://www.gelias.com/	{gelias@gelias.com}	{}	new	f	Law Firms	Lagos	2026-05-18 14:49:58.909977+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
b341bd4c-ebb2-46aa-a5cc-143f5e7e4689	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJB3Cz0zyLOxARq_SNDcoMt_0	Baines Credit Microfinance Bank Ltd.	161C Raufu Taylor Cl, off Idejo Street, Victoria Island, Lagos 106104, Lagos, Nigeria	http://bainescredit.com/	{Lagos.Emailinfo@bainescredit.comPhone,info@bainescredit.com,0677Emailinfo@bainescredit.comBainesCreditPioneering}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 14:49:59.612238+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
b60a49ad-99c1-4529-8037-90236d64dfe0	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJYZr5EH2LOxARf0_Di6K5smI	The Trusted Advisors Legal Practice	8/10 Broad St, Marina Rd, Lagos Island, Lagos 101001, Lagos, Nigeria	https://trustedadvisorslaw.com/	{1908info@trustedadvisorslaw.comLagos,1908info@trustedadvisorslaw.comFacebookXLinkedInInstagramYouTube,ProtectionTeamInsightsContactinfo@trustedadvisorslaw.com,u003einfo@trustedadvisorslaw.com}	{+2348101599159}	new	f	Law Firms	Lagos	2026-05-18 14:50:05.861347+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
19b6333c-bc0c-4469-bab8-b0f83db614c3	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJs7g3aW6LOxARIR0iauVLzBI	Dulbarr & Thark, Solicitors and Advocates	10, 12 Strachan St, Lagos Island, Lagos 100001, Lagos, Nigeria	http://dulbarrthark.legal/	{dulbarrtharkgroup@gmail.com,dulbarrtharklf@gmail.com,adeola@dulbarrthark.legal,sideeqah@dulbarrthark.legal}	{07071032609,09018361947,07071029860}	new	f	Law Firms	Lagos	2026-05-18 14:50:14.459723+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
59ff59be-eb42-4e97-bf0f-2f69ec81aff7	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJY5rOCSySOxARtnkr9sT_mvQ	Empire Trust Microfinance Bank	Empire Building, 35 Oba Akran Ave, Ikeja, 101233, Lagos, Nigeria	http://empiretrustmfb.com/	{info@empiretrustmfb.comloan,loan@empiretrustmfb.com}	{07032926390,07000036747}	new	f	Microfinance Banks	Lagos	2026-05-18 14:50:17.286336+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
313a635a-e0a2-4d54-9dda-768626a23b7a	5656212a-d80c-47e2-99a1-12bfe388f9b9	ChIJTcJwIj2LOxAR6W_7kJ9UQ1o	Addosser Microfinance Bank Ltd	32 Lewis St, Lagos Island, Lagos 102273, Lagos, Nigeria	http://www.addosser.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 11:11:07.860978+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
a01acb3f-94e2-4fa1-bb99-9529b8b78ee7	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJH5c4VZD0OxAR2eDUpQTSznc	Olaniwun Ajayi	Plot L2, Plot 12 401 Cl, Banana Island, Lagos 106104, Lagos, Nigeria	http://www.olaniwunajayi.net/	{LAWYERS@OLANIWUNAJAYI.NET,lawyers@olaniwunajayi.net,lawyers@olaniwunajayi.netWAYFIELD}	{00000000000,00002220446,04925031308,08472633361,09801101684,07612037658,03532409667,05200195312,06969833374,03955411911,09936523437,04180240631,00102233886,02869796752,00056076049,02999877929,02435302734,04919910430,09933471679}	new	f	Law Firms	Lagos	2026-05-18 14:50:19.750138+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
88bd6ed0-75f7-4574-b9d7-f67f9936a52a	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJ6bZMxkCTOxARFdHW1ccLPIs	Spectrum Microfinance Bank	23 Ogunusi Road,beside Boat House,Afis Bus-Stop Ogba, Ojodu, Lagos 101233, Lagos, Nigeria	http://www.spectrummfb.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 14:50:48.649493+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
296e07de-80d9-47b5-a427-56c9931390cf	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJmx_aFzv1OxARHKN63H_T6gw	TEMPLARS	5th Floor, The Octagon, 13A A.J. Marinho Dr, Victoria Island, Lagos 106104, Lagos, Nigeria	http://www.templars-law.com/	{Nigerias-Upstream-Decommissioning-3@2x.jpg,From-TaxPro-Max-to-Rev360-3@2x.jpg,ENR-TRANSCRIPT-3@2x.jpg,TL-BANNER-WEB-2@3x-scaled-aspect-ratio-400-250-scaled.jpg,Protecting-Business-Brands-4@2x-aspect-ratio-400-250.jpg,Nigerias-Withholding-Tax-thumbnail-2@2x-aspect-ratio-400-250.jpg,TALKING-LEGAL-thumbnail-2@2x-1-aspect-ratio-400-250.jpg,TALKING-LEGAL-thumbnail-2@2x-aspect-ratio-400-250.jpg,Domestic-Crude-Oil-Supply-1@3x-aspect-ratio-400-250-1.jpg}	{04460492503}	new	f	Law Firms	Lagos	2026-05-18 14:53:23.584506+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
ad419b89-de3f-4b1c-92c5-b80e53ab2a44	45083b42-f471-4e07-8fa0-ca7d2f1ed983	ChIJhR3PoFaTOxARjEMXbbVWAt4	First Option Microfinance Bank Limited	7, Olowu Street, Off Obafemi Awolowo Wy, Allen, Ikeja 101233, Lagos, Nigeria	https://firstoptionfinance.com/	{}	{}	new	f	Microfinance Banks	Lagos	2026-05-18 14:53:23.899836+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
93f47940-3686-4499-98aa-baf3e0740dc6	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJoyhK5Gb1OxARuDscyZ-DlHg	OSUYA & OSUYA LAW FIRM	6 Balogun St, off Obafemi Awolowo Way, Ikeja, Lagos 100271, Lagos, Nigeria	http://www.osuyalawfirm.com.ng/	{services@osuyalawfirm.com.ng}	{}	new	f	Law Firms	Lagos	2026-05-18 14:53:35.430147+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
10c5cfc3-2a69-4599-b45d-829c70b6e2d7	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJ7bhoJOWLOxARueQJ44IcG58	CHIEF FEMI ODUFOWOKAN & CO	33, Isaac John street Off, Ikorodu Road, Close to Igbobi College, Local Government, old gate, Somolu, Lagos 100231, Lagos, Nigeria	https://bestnigerialawyers.com.ng/	{femiodufowokan@gmail.comadmin}	{+2348033085824}	new	f	Law Firms	Lagos	2026-05-18 14:54:02.060807+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
611b7c77-bb0c-431d-b449-018c33eab1e6	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJoV5Z-SOLOxARlAMS6XwI5C8	ALP NG & Co	15 Military St, Lagos Island, Lagos 101231, Lagos, Nigeria	https://alp.company/	{alp@alp.company}	{}	new	f	Law Firms	Lagos	2026-05-18 14:54:14.407864+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
6a7b2f19-1807-46da-ba71-6498109802c3	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJ1TabDmCTOxAR9w8tx532ijI	Agatha Legal	No 9, Sarah's Place, Along Channels Tv Avenue, Opic, Isheri, Lagos 100214, Lagos, Nigeria	https://agathalegal.com/	{agatha@agathalegal.com}	{}	new	f	Law Firms	Lagos	2026-05-18 14:54:36.646758+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
8291c678-0b36-4439-ba79-9391110d17c3	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJf7DbmwCLOxARhKuy63hPE7o	Nomos Legal Practice	Suite CA7, Club Arcade, beside TBS Banquet Hall, opposite Our Saviour's Anglican Church, Lagos Island, Lagos 102273, Lagos, Nigeria	http://nomoslegalpractice.com/	{info@nomoslegalpractice.com,nomoslegalpractice@gmail.com,E-mailinfo@nomoslegalpractice.com}	{}	new	f	Law Firms	Lagos	2026-05-18 14:55:15.232186+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
953d8bd6-2295-4cfd-895a-be67297d1af1	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJ21jPC6X1OxARXN-2bZcycpo	LAGOS LOGISTICS LIMITED	127 Adewale Kolawole Cres, Marwa, Lekki 106104, Lagos, Nigeria	http://lagoslogistics.com.ng/	{}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 14:56:14.491192+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
93ca0edc-4e14-435d-8bd8-538bdc1769d6	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJqcInry6LOxARoDcDzKpwxho	The Law Crest LLP	Continental Re Centre, 17 Olosa St, Victoria Island, Lagos 101241, Lagos, Nigeria	http://www.thelawcrest.com/	{info@thelawcrest.com}	{}	new	f	Law Firms	Lagos	2026-05-18 14:56:17.124672+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
ed1fc31c-7236-4ad0-916e-cd49ba3da0c8	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJhYKBg6iPOxARohgibWAoWnw	Law Office of Amara Aniche & Associates	31 Ejigbo Rd, Idimu, Lagos 100276, Lagos, Nigeria	https://lawclinicpro.com/	{exceptionalattorneys@gmail.com}	{08030881289,+2348030881289}	new	f	Law Firms	Lagos	2026-05-18 14:57:33.18452+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
e7a0e8a2-8238-4b50-a22e-df3982ad59b6	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJofq5kBGOOxARet-nR2LMCIE	AB Logistics	53 Airport Rd, Ajao Estate, Ikeja 102214, Lagos, Nigeria	http://www.ablogistics.com.ng/	{info@ablogistics.com.ng}	{+2347046145125}	new	f	Logistics & Courier	Lagos	2026-05-18 14:57:33.198643+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
81909508-f45a-4a61-8183-140edda9e326	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJ7aY9uUeTOxARVj4LAKAaKYw	Pectratech Logistics (Courier services)	Lagos NG, Suite 47, No, 14 Francis Oremeji St, Ikeja, 100001, Lagos, Nigeria	https://pectratech.com/	{pectratech@pectratech.com}	{+2349125406759}	new	f	Logistics & Courier	Lagos	2026-05-18 14:57:43.872524+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
6aeac476-645b-4ba6-91ba-2334aed388bd	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJU5B-9RGOOxARsEHnFR3CTto	Fortune Global Shipping & Logistics Limited	15 Fatai Irawo St, off Airport Road, Ajao Estate, Lagos 102214, Lagos, Nigeria	https://fglobalshipping.com/	{Nigeria@fglobalshipping.com,usa@fglobalshipping.com,benin@fglobalshipping.com,info.nbo@fglobalshiping.com,ghana@fglobalshipping.com,info@fglobalshipping.com,enquiries@fglobalshipping.com,warehouse@fglobalshipping.com}	{07034424082,08147208322}	new	f	Logistics & Courier	Lagos	2026-05-18 14:57:54.706368+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
fde9ab07-0b1c-4e49-b331-984d3ec81fe2	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJW0XU9YCOOxARLzEmiqxqV9w	Abiel Logistics	32 Oyegunwa St, Oshodi, Lagos 100003, Lagos, Nigeria	http://www.abiellogistics.com/	{sales@abiellogistics.com}	{+2348134666153,+2348054632657}	new	f	Logistics & Courier	Lagos	2026-05-18 15:00:57.985516+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
f6e9e0fc-7ba4-49d1-b952-a9c53d2f2ca9	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJQaukawyOOxAR0tErs1VNuUI	CourierPlus Services Limited	42, Concord Way, Off Local Airport Lagos, Mafoluku Oshodi, Ikeja 102214, Lagos, Nigeria	http://www.courierplus-ng.com/	{info@courierplus-ng.com,5679EMAILinfo@courierplus-ng.com,enquiries@courierplus-ng.com,pickup@courierplus-ng.comBelow}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:01:14.20703+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
b54e55bb-ad43-4b39-9483-a16818614838	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJWVyNiUqPOxAR_rzPanorAe4	VDS Global Logistics Ltd. ~ Clearing and Forwarding Company in Lagos. Ship from China to Lagos. Shipping company in Nigeria.	7 St Finbarr's College Rd, Akoka, Lagos 100001, Lagos, Nigeria	https://vdsgloballogistics.com/	{}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:02:43.232539+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2cae196f-622e-4694-a3c4-b312685573e1	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJNdS1VGCROxARHgjII6_u1fw	RTG Cargo And Logistics Nigeria Limited	14, Oduyemi Street Opposite Ikeja Local Govt Ikeja, Ikeja, Lagos 100282, Lagos, Nigeria	http://rtgcargo.com/	{rtg_cargo@yahoo.com,info@rtgcargo.com,admin@rtgcargo.com}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:02:54.233094+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
dbe80819-1fba-46de-b794-a418cf0c5f5f	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJaeh_gXeNOxARcx8ZXGkXwkQ	Tamak Logistics	4 Tafawa Balewa Cres, off Adeniran Ogunsanya, Surulere, Lagos 101241, Lagos, Nigeria	http://www.tamakng.com/	{business@tamakng.com}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:03:05.115878+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
9c0f2650-ea63-4232-910f-4da2e68a0824	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJEcWWVMmLOxAR1Tpb1mL8ZOI	GWX Logistics	35 Awolowo Rd, Ikoyi, Lagos 106104, Lagos, Nigeria	https://www.greaterwashingtonng.com/	{}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:03:22.129444+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
b93d5093-89c8-4fba-804c-e53b61a9b6dc	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJHxMOUmGTOxAR7aoTjxR0TyI	ACORN GLOBAL SHIPPING & LOGISTICS LTD	2 Shomide St, Dopemu, Ikeja 102212, Lagos, Nigeria	http://www.acornglobal.net/	{}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:03:35.207443+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
4ab43e32-9737-488c-b3b6-6bc023661602	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJZ7rkKuKNOxARctSJW5AR2lY	Skynet Worldwide Express Nigeria	19/21 Balogun St, LG, Anifowoshe, Ikeja 100282, Lagos, Nigeria	http://skynetworldwide.com.ng/	{}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:03:41.147423+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
933ef939-1c36-4c0a-8d1c-b86b00592473	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJK8NjvSiSOxARYgVSlvR7ZRU	KTG Shipping International (Lagos)	29a, suite 103, off Afolabi Aina St, Awolowo way, Ikeja, 101233, Lagos, Nigeria	http://www.ktgshipping.com/	{}	{}	new	f	Logistics & Courier	Lagos	2026-05-18 15:04:06.906948+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
7c9e9938-d383-4ad6-b0b1-614210370441	54174d5e-af85-4097-843b-ed2d0a83d745	ChIJvfJGLhCOOxARxfo8o5NVXRM	Professional Shipping & Logistics Limited	1, Aviation Estate, Adeola Ajayi Cres, Orile Oshodi, Lagos 100001, Lagos, Nigeria	http://www.professionalshippingng.com/	{1840info@professionalshippingng.com,freightexpress@mail.com,info@professionalshippingng.com}	{03727386009,03155517578}	new	f	Logistics & Courier	Lagos	2026-05-18 15:04:24.713727+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
672372fd-b7dd-449b-a9cc-fb789cd6ec9a	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJ1cRUq8-KOxARMr0oLYpInkM	CW REAL ESTATE LAGOS	3, 5 Modupe Alakija Cres, Ikoyi, Lagos 100001, Lagos, Nigeria	http://www.cwlagos.com/	{1343hello@cwlagos.comAddress,Addresshello@cwlagos.comLocation}	{+2349088072107,+2347048089361,+2347026024170,+2349062511344,+2347048089360,+2349062511345}	new	f	Real Estate Firms	Lagos	2026-05-24 14:17:51.413087+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
5f11bc66-9547-4b01-8b79-cb47e9e117c9	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJJ8uLoin3OxARUve0bsc3k3Y	Ramos Real Estate Nigeria	Chevron Dr, Eti-Osa, Lekki 101233, Lagos, Nigeria	http://www.ramosrealestateng.com/	{hello@ramosrealestateng.com}	{08133355522}	new	f	Real Estate Firms	Lagos	2026-05-24 14:18:02.274996+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2639fb80-01cf-4e46-a53d-951d01e7e622	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJ5Zpa8PySOxAR3cjBE9UwXkA	KGL Realty Pro | Luxury Real Estate in Lagos | Buy luxury Property in Lagos	IKOTA SHOPPING COMPLEX, SUIT 53 Rd 5, Victoria garden City, Lekki 101245, Lagos, Nigeria	http://kglrealtypro.com/	{hello@kglrealtypro.com}	{+2347038141774}	new	f	Real Estate Firms	Lagos	2026-05-24 14:19:03.912197+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
9f55ed0e-d9af-4017-a084-5a662cdfebe9	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJ_f5VpLyTOxARGmkODtINmDU	WestPoint Realtors Limited Lagos, Nigeria	111 Ogunlowo St, Obafemi Awolowo Wy, Ikeja, Lagos 100211, Lagos, Nigeria	http://westpointr.com/	{info@westpointr.com,E-mailinfo@westpointr.com}	{+2349132045774}	new	f	Real Estate Firms	Lagos	2026-05-24 14:19:09.313655+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
c7684278-d81c-4fb2-920e-6f8b4552b3d0	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJE7iAOpj3OxARg79OMujxoVI	DPKay Homes and Property Ltd | Real Estate Company in Lagos	Suite 1, Level 4, Dominion Plaza Eti-Osa 140/141, Lekki Expressway, Igbo Efon Lagos NG, Lekki Penninsula II, Lekki 234001, Lagos, Nigeria	https://www.dpkayhomes.com/	{}	{}	new	f	Real Estate Firms	Lagos	2026-05-24 14:24:41.435822+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
72ce40eb-889d-4770-9709-ecccdb404aaf	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJcWeSrIz1OxARP_SRsdc7cSM	Numero Homes | Real Estate Development Company InLekki Lagos	37 Dr Ladi Alakija street Ibeju lekki, Lekki Phase 1, Lagos 106104, Lagos, Nigeria	http://www.numerohomes.com/	{}	{}	new	f	Real Estate Firms	Lagos	2026-05-24 14:26:53.58627+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
27b1282d-e1d2-4ae0-ae87-5c62f5ec4063	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJp8ssWzf0OxARaHSI4IcY81g	Children'S International School	8 Amore St, Lekki Phase 1, Lagos 106104, Lagos, Nigeria	https://www.cislagos.com/	{info@cislagos.org}	{}	new	f	Private Schools	Lagos	2026-05-26 18:45:53.463924+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
cde88d87-8dc4-4af8-9985-5316e99dd573	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJI6YW1FCMOxAR2SYOzy1Q3yU	Blooming Greens School	3, Connal Road, Off Herbert Macaulay Wy, Yaba, Lagos 101245, Lagos, Nigeria	http://www.bloominggreensschool.com/	{info@bloominggreensschool.com,usinfo@bloominggreensschool.com,Lagos.+2348145027214info@bloominggreensschool.com}	{+2348145027214,+2349057190953,+2349027537352}	new	f	Private Schools	Lagos	2026-05-26 18:46:05.67556+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
7f609963-6bf0-401d-9185-c1cbe0a8c0ab	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJX9f3Dtj0OxARs-8Qe_DGsdY	American International School of Lagos	Behind 1004, CCPM+FC8 Federal Estates, Victoria Island, Lagos 106104, Lagos, Nigeria	http://www.aislagos.org/	{}	{}	new	f	Private Schools	Lagos	2026-05-26 18:46:14.990501+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
61297f32-eb03-45f2-bef1-6b33e9fb29db	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJi3RBEAT1OxAR0ie1LgB9yL0	The RiverBank School	Maroko, Oniru, VI, Chief Yesufu Abiodun Oniru Rd, COD Road, Oniru, Lagos, Lagos 101241, Lagos, Nigeria	http://www.riverbankschools.org/	{Info@riverbankschools.org}	{}	new	f	Private Schools	Lagos	2026-05-26 18:46:25.965513+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2314bb7c-23a3-480f-a941-d4682d6412c5	c03911c8-510c-4bba-863d-8bcc5cf018a7	ChIJWxNy8eyTOxAREzIF5yqKRfA	Tope Adebayo LP	3rd Floor, The Phoenix, 31 Mobolaji Bank Anthony Way, Opebi, Ikeja 101233, Lagos, Nigeria	http://topeadebayolp.com/	{info@topeadebayolp.com}	{}	new	f	Law Firms	Lagos	2026-05-18 14:53:49.979789+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
4f3514bc-bfc3-4a4f-ba22-2b597ef7b72e	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJAQAAADGSOxARR1u5InL0abs	Chrisland Schools (Primary, Secondary & Sixth form / A'Level) - Ikeja, Lekki, VGC, Abuja, Idimu Festac Area	26 Opebi Rd, Opebi, Lagos 100281, Lagos, Nigeria	http://www.chrislandschools.com/	{}	{04349322389,07486814516,05411842556,08109726434,06720534159,02254494698,04137987856,06956178394,03836768936,02028591687,09063135544,08082873098,08023421214,08064640556,08023369900,08035029813,08033348747,08030839541,08087579810,08094236404,07038587224,08147677310,08034065896,07088088408,08057469697,08037193587,07012013123,02014542479,08053746607,09063133018,08130101818,07016402937,07068880785,08052382728,08142664266,08101192841,08102836774,08034051863,09022671657,08023096656,08136929006,08027746482,08036448479,08038398628,08164848576,08023199882,08036485770}	new	f	Private Schools	Lagos	2026-05-26 18:46:37.437932+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
30b83ad0-1881-410d-af83-15cb923b5094	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJffA3KW75OxAR24jog3izN3Q	KAYRON INTERNATIONAL SCHOOLS (Day & Boarding)	Heritage Garden Estate, Mopo Rd, Lekki - Epe Expy, Ajah, Sangotedo 106104, Lagos, Nigeria	https://kayronschools.com/	{headadmin@kayronschool.com}	{09161472479}	new	f	Private Schools	Lagos	2026-05-26 18:46:47.392515+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
72243889-a334-4634-a00e-58bd45eea0d9	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJI0Ozjy-LOxARvVZN6xv-24A	St. Gregory's College	18/19 St Gregory's College Rd, Ikoyi, Lagos 106104, Lagos, Nigeria	http://stgregoryscollege.ng/	{}	{}	new	f	Private Schools	Lagos	2026-05-26 18:47:05.80444+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
7eb6de42-b4cb-483d-9612-4269e8dde76a	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJCyMWRKiTOxARldDcx26iusU	Supreme Education Foundation Schools	Phase 2, G.R.A, 23 Emmanuel Keshi St, Magodo, Ikosi Ketu, Lagos 100248, Lagos, Nigeria	http://supremeeducation.com/	{}	{+2348112390403,08112390403,08182983143,08182984015}	new	f	Private Schools	Lagos	2026-05-26 18:47:19.890342+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2307dbe7-22cd-4f58-8d0b-39e856f87785	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJh2qLxxz1OxARfQBY60WdcAs	British International School	Private Estate, 1 Land Bridge Ave, Maroko, Lagos 106104, Lagos, Nigeria	https://bisnigeria.org/	{registrar@bisnigeria.org,registrar@bisnigeria.orgSTART}	{+2347011991819,+2348106891610,+2349034664342}	new	f	Private Schools	Lagos	2026-05-26 18:47:29.284804+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
cbedb97c-fb98-472e-8352-42df2fc31182	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJ0_ZWJBaSOxART2SXy9i3jyc	Avi-Cenna International School	6 Harold Sodipo Cres, Ikeja GRA, Ikeja 101233, Lagos, Nigeria	https://avi-cenna.com/	{info@avi-cenna.com,hr_admin@avi-cenna.com,info@avi-cenna.comOur}	{}	new	f	Private Schools	Lagos	2026-05-26 18:47:39.551211+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
b0a79ba2-62d7-4124-b906-5a069165bf7e	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJVVVVlXGSOxARr33oH4_RRRw	Halifield Schools, Maryland	2 Oki Ln, Mende, Lagos 100001, Lagos, Nigeria	http://www.halifieldschools.com.ng/	{mails@halifieldschools.com.ng,mails.lekki@halifieldschools.com.ng,admissions@halifieldschools.com.ng}	{09014420788,09014385928,+2348150904614}	new	f	Private Schools	Lagos	2026-05-26 18:47:52.020932+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
7c73d238-9ed2-4793-b992-368dec350485	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJ6-X4F2SQOxARvnj-x_x5wJQ	Honeyland School Isolo	4 Oluade Way, Oke Afa Rd, Isolo, Lagos 102214, Lagos, Nigeria	https://honeylandschools.ng/	{honeylandschools@yahoo.com,Lagos.Emailmagodo@honeylandschools.ng,honeylandmagodo@yahoo.comPhone,2.EmailLekki@honeylandschools.ng,honeylandcollegelekki@gmail.comPhoneLekki,Lagos.Emailipaja@honeylandschools.ng,honeylandschools@yahoo.comPhoneIpaja,Lagos.Emailbaruwa@honeylandschools.ng,honeylandbaruwa@yahoo.comPhoneBaruwa,Lagos.Emailhoneylandschoolisolo@gmail.comPhoneIsolo,Lagos.Emailajasa@honeylandschools.ng,honeylandschsajasa@gmail.comPhoneAjasa,LagosEmailIkeja@honeylandschools.ng,honeylandschoolagidingbi@gmail.comPhoneIkeja}	{09095257722,07033371881,07057488855,08074711800,09074949529,07071536612,07051925708,08117711657,08037194970,07039999111,08100053261,08024545564,08034379618,08162618992,08062758566,07039998111}	new	f	Private Schools	Lagos	2026-05-26 18:48:58.475985+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
8557a8d4-39ea-4cd0-8da2-9e1d85caed73	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJ9U5-ZmSNOxARZx2tmkquIRY	BRAINPOINT SCHOOLS INTERNATIONAL	G988+2X3, 13 Okesuna St, Jibowu, Lagos 101241, Lagos, Nigeria	http://brainpointschools.com/	{}	{}	new	f	Private Schools	Lagos	2026-05-26 18:49:11.076278+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
e3f46a1f-3845-46a5-8f10-114897bafbbc	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJf9cSD4iOOxARNGVlu9kRiMI	Headstart Private School	1 Jimoh Faronbi Drive, Ire Akari Estate Road, 351-353 Ugali St, Oshodi-Isolo, Lagos 102214, Lagos, Nigeria	http://www.headstartprivateschool.com/	{}	{}	new	f	Private Schools	Lagos	2026-05-26 18:49:18.071468+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
0c6059e6-5710-45e7-bcef-111666c9582c	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJP3ebpjCSOxARL8nMgk3NfXE	Wellspring College	25B Somide Odujinrin Ave, Street, Lagos 105102, Lagos, Nigeria	http://www.wellspringcollege.org/	{}	{01193184124,08186483476,00000000000,00000818030,03130954586,02127075195}	new	f	Private Schools	Lagos	2026-05-26 18:51:01.28542+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
06005947-bb5c-4772-b35f-8949ab806dd0	4e934374-3aca-4d88-a021-69879f7cd515	ChIJ33UxRCSMOxAR4MgINUr5cJs	Event Flavours Foods n Drinks	16 Adegbola St., lawanson, Lagos 101283, Lagos, Nigeria	http://www.instagram.com/event_flavours	{}	{04049927506,04675331767}	new	f	Food & Beverage	Lagos	2026-05-27 13:55:15.069414+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
91a9faa3-923f-4e9b-832a-3c538bda3f34	4e934374-3aca-4d88-a021-69879f7cd515	ChIJAQAwfBj1OxARp7WIgqEUXxc	Drinks.ng	Plot 307 Adeola Odeku St, Victoria Island, Lagos 101241, Lagos, Nigeria	https://www.drinks.ng/	{}	{06819224729,05459136579,06110083554}	new	f	Food & Beverage	Lagos	2026-05-27 13:55:24.618102+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
aa78d9ad-1d4f-4937-a5ff-e053d5dcacc5	4e934374-3aca-4d88-a021-69879f7cd515	ChIJTYD7nqWPOxARVu37R4f1jy8	Drinks n ice services (MOCKTAILS AND COCKTAILS in lagos)	Adora Cl, Mende, Lagos 105102, Lagos, Nigeria	http://drinksnice.bumpa.shop/	{}	{}	new	f	Food & Beverage	Lagos	2026-05-27 13:55:35.93268+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
fb38aaab-6c07-4cfb-9cb7-9e9379b92e87	4e934374-3aca-4d88-a021-69879f7cd515	ChIJfyR3h9_0OxARNedg3NyriY0	Cactus Restaurant	20/24 Ozumba Mbadiwe Ave, Victoria Island, Lagos 106104, Lagos, Nigeria	https://www.facebook.com/CactusBakery	{}	{03917882008,04049927506,04675331767,08321475982,08577239513,00050942666,01008657085,05903857493,05475869741}	new	f	Food & Beverage	Lagos	2026-05-27 13:55:42.41865+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
accc7ea9-de0b-451f-8b40-de1ed91c8c0f	4e934374-3aca-4d88-a021-69879f7cd515	ChIJHSu0lPyNOxAR8i3yCjirPlw	Grenade Drinks - Mobile Bar Services, Lagos, Nigeria.	41 Modupe Street, Fola Agoro St, Somolu, Lagos 100001, Lagos, Nigeria	https://instagram.com/grenadedrinks?utm_medium=copy_link	{}	{04049927506,04675331767}	new	f	Food & Beverage	Lagos	2026-05-27 13:55:51.131167+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
fe4e229b-a5a1-4fe8-aa95-d55fa2e8c9c2	4e934374-3aca-4d88-a021-69879f7cd515	ChIJVUftO7r1OxARUCfrp6T_0jc	Eric Kayser - Victoria Island	864a Bishop Aboyade Cole St, Victoria Island, Lagos 106104, Lagos, Nigeria	https://www.maison-kayser.com/boulangeries/23-31-nigeria	{}	{}	new	f	Food & Beverage	Lagos	2026-05-27 13:56:06.144796+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
76d6ffc0-9196-4ea3-948d-a0a2c3ff9cb8	4e934374-3aca-4d88-a021-69879f7cd515	ChIJAUxacoOPOxARiHBs3unGFyU	Gifty’s thirsty delight(zobo drink)	9 off Atunrase St, Ishaga Rd, Surulere, Lagos 102215, Lagos, Nigeria	https://shop.dailysalesrecordapp.com/Gifty-s-thirsty-delight-65e755cd8f10c	{support@dailysalesrecordapp.com}	{}	new	f	Food & Beverage	Lagos	2026-05-27 13:56:11.19165+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
d6093958-bcfb-4473-910f-b06eadd2d4b0	4e934374-3aca-4d88-a021-69879f7cd515	ChIJy6PIcyj1OxARuMP_Nq9vUnE	SABOR LAGOS	134 Ahmadu Bello Wy, beside Silverbird Cinema, Victoria Island, Lagos 106104, Lagos, Nigeria	http://www.saborlagos.com/	{info@saborlagos.com}	{}	new	f	Food & Beverage	Lagos	2026-05-27 13:56:21.416399+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
ef58edab-0013-4f1d-a1d9-ab484279fadf	4da775f5-ff45-4fab-8518-74f9cea1b5fc	ChIJ0ZpOSCQh_BARZF44u6W0OXo	H&W Rice Company limited	Km 1 Numan-Yola Road LGA, Demsa 642103, Adamawa, Nigeria	http://www.aarinvest.com/hw.rice	{}	{}	new	f	Manufacturing Companies	Adamawa	2026-06-07 08:49:02.312357+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Adamawa	\N	0	\N	google_places	\N
f4a848a4-9f7d-47d2-a0cf-9dfdc72d68b7	4da775f5-ff45-4fab-8518-74f9cea1b5fc	ChIJ7dMk3Vtr_BARF_bO46ljc3s	Solar company in Yola Adamawa state	Galadima Aminu Wy, Jimeta, 640284, Adamawa, Nigeria	http://solarcompanyinyolaadamawa.com.ng/	{okec323@gmail.com}	{+2340912467230}	new	f	Manufacturing Companies	Adamawa	2026-06-07 08:49:09.594293+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Adamawa	\N	0	\N	google_places	\N
f23714bd-99ec-4893-baad-020354e82ad6	4da775f5-ff45-4fab-8518-74f9cea1b5fc	ChIJydImUjlr_BAR9rUR0w6UF98	Sainana Resources Nigeria Ltd	103 Abubakar Atiku Rd, Jimeta, Yola 640102, Adamawa, Nigeria	http://sainanaresources.com.ng/	{}	{}	new	f	Manufacturing Companies	Adamawa	2026-06-07 08:49:12.885926+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Adamawa	\N	0	\N	google_places	\N
966eb6d7-2a04-48f1-adf6-61787e0701d9	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJERz_4jyTQxARlOUMsRiZ0j0	Kabbiz Legal & Advisory	4th Floor, Ezeude Plaza, 60 Francis St, GRA, Onitsha 430231, Anambra, Nigeria	https://www.kabbizlegal.com/	{contact@kabbizlegal.com}	{+2348064231176}	new	f	Law Firms	Anambra	2026-06-22 09:37:05.63692+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
880206e0-ab51-4ae9-9670-183cfe0f63e7	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJ6TevdD6TQxARfk12s2Lpgvg	Egonu Chambers	46 Niger Dr, Trans Nkissi Phase I, Onitsha 430272, Anambra, Nigeria	http://www.egonuchambers.com/	{info@egonuchambers.com}	{+2348035884943,+2347017777130}	new	f	Law Firms	Anambra	2026-06-22 09:37:11.171264+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
94e6a614-4a1e-426c-99ef-bdae0a61424d	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJocFrbuOSQxARtTu5QfIn7g8	Ibegbu&Ibegbu Lawfirm.	Martins St, GRA, Onitsha 434106, Anambra, Nigeria	http://www.ibegbuandibegbu.com/	{}	{}	new	f	Law Firms	Anambra	2026-06-22 09:37:14.358034+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
9e3723ae-deeb-463d-8229-94469cbe868c	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJC4fHF1WSQxAR57phO4wxV-w	Allen & Marylebone	By Ekene Junction, No 24 Dumomodi Lane, off Oguta Road, City Centre, Onitsha 430261, Anambra, Nigeria	http://www.allen-marylebone.com/	{}	{}	new	f	Law Firms	Anambra	2026-06-22 09:37:25.363882+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
bf1ce189-6f22-47f5-bc1e-d3d85e6e691e	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJmxX1h9qDQxARl5zFWcrWpCQ	SILVERSTONE LEGAL SERVICES	Emmav Plaza, 12 Zik Ave, Local, opposite Zenith bank & Access bank, Government Area, Awka 420108, Anambra, Nigeria	http://www.silverstonelegals.com/	{Anniefa@gmail.com,divya009@gmail.com,tracyST@hotmail.com,info@silverstonelegals.comOpens,info@silverstonelegals.com}	{}	new	f	Law Firms	Anambra	2026-06-22 09:37:34.524006+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
6f016208-d442-4598-8c59-c3f1a3e096e3	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJjWJpIJqTQxARQBee5gBbpBg	ILOEGBUNE OKOYE & COMPANY	No. 4 Amechi Ekwerekwu Close, off Court Road, GRA, Onitsha 434241, Anambra, Nigeria	https://iloegbuneokoyeandco.com/	{info@iloegbuneokoyeandco.com}	{+2348037144042,+2348055519504,+2348165921500}	new	f	Law Firms	Anambra	2026-06-22 09:37:41.839796+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
7ea658a0-cf69-41e7-aee2-230c27ca012a	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJ_XX-FtiTQxAR86pnLvIO_eI	Ebelechukwu Law Firm	25 Limca Rd, Isiafor Layout, Nkpor 434104, Anambra, Nigeria	http://www.elawfirm.ng/	{}	{}	new	f	Law Firms	Anambra	2026-06-22 09:37:54.592999+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
f62f57f0-0e9a-468a-8ebe-45fc46833638	2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	ChIJpy8GvvCTQxAR8wYYhk0tv7c	Saxum Legal - Afuba, Anaenugwu, Obi and Partners	13 Ridge Rd, GRA, Onitsha 431102, Anambra, Nigeria	https://www.saxumlegal.ng/	{}	{}	new	f	Law Firms	Anambra	2026-06-22 09:37:58.634944+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	0	\N	google_places	\N
c0fb7e8c-aa91-4d70-b4d2-677ddc88aa4f	68fa0c6b-33ef-4442-8238-f43877a51d46	ChIJeVSqaEXXVBAR3Kft9-ysyr4	Jikan Inga and Co enterprise	Unguwan kur railway bauchi, Jahun Road, quarters, Bauchi 740241, Bauchi, Nigeria	https://jikan-inga-co-enterprise.business.site/?utm_source=gmb&utm_medium=referral	{}	{}	new	f	Manufacturing Companies	Bauchi	2026-06-22 10:30:21.164787+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	0	\N	google_places	\N
9a91b212-88c7-4f05-8360-b3ce67c21c8d	68fa0c6b-33ef-4442-8238-f43877a51d46	ChIJt0RSwTeZOxARzRFNDKGnGfQ	Propak Industries Limited	adalemo bustop, 8 Tarmac Rd, Otta, Ifako-Ijaiye, Ota 112101, Ogun State, Nigeria	http://propak.org/	{}	{}	new	f	Manufacturing Companies	Bauchi	2026-06-22 10:31:02.623545+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	0	\N	google_places	\N
6ff6e0e3-55ce-431a-8cc8-5cb9557e5339	05061054-154d-4ed2-b135-b6e8cf9e1d2b	ChIJuVmfJzZzVRARc2wYq1wx8dQ	DHL Service Point (DHL BAUCHI)	6 Yandoka Rd, beside Total Filling Station, Bauchi 740102, Bauchi, Nigeria	https://locator.dhl.com/results?address=id:ABV331&language=en&lc=NG&resultUom=km&clientAppCode=GYD	{}	{}	new	f	Logistics & Courier	Bauchi	2026-06-22 11:14:05.990979+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	0	\N	google_places	\N
745d7d35-d493-405b-a02f-bdbe25bed1bb	05061054-154d-4ed2-b135-b6e8cf9e1d2b	ChIJ532WWZ7XVBARITpyIz0E0CY	Ifex Express Logistics BAUCHI	4, HOLY TRINITY PLAZA, BEFORE OBUNA ROYAL HOTEL, Ahmadu Bello Way, Bauchi 740212, Bauchi, Nigeria	https://ifexexpressnig.com/branches	{}	{}	new	f	Logistics & Courier	Bauchi	2026-06-22 11:14:09.2423+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	0	\N	google_places	\N
7ba49153-cfad-4697-8b35-66a46aadcd6f	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJpascWbaTOxARLZQMfKsL-1M	Oparah Realty	No 16A, Sule Abuka Close off Opebi Road by GTBank Opebi-Ikeja, Opebi, Lagos 100001, Lagos, Nigeria	https://oparahrealty.com/	{}	{05388004560}	new	f	Real Estate Firms	Lagos	2026-05-24 14:18:11.166741+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
049576a8-35ec-4bf8-a378-30d0b3c747e1	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJ9el0tiP_OxAR_56JPEWlazA	Vines Realty	Suite 4A, Dominion Plaza,Igbo-Efon Bus Stop, Lekki-Epe Expressway Lekki Lagos Eti-Osa L.G.A, Lekki Penninsula II, Lekki 100001, Lagos, Nigeria	http://www.vinesrealtyng.com/	{RelationMediaBloginfo@vinesrealtyng.com,605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com,dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com,c183baa23371454f99f417f6616b724d@sentry.wixpress.com,8c4075d5481d476e945486754f783364@sentry.io,98b21aa53d68482b8414e892d9af0e5f@sentry-next.wixpress.com,cd64ba1f47df485bba2b0076c0dd3b25@sentry.wixpress.com,ed436f5053144538958ad06a5005e99a@sentry.wixpress.com,460ff4620fa44cba8df530afde949785@sentry.wixpress.com,1eeb89147c984dc6bc3ffafd9e6cd089@sentry.wixpress.com,18d2f96d279149989b95faf0a4b41882@sentry-next.wixpress.com,2062d0a4929b45348643784b5cb39c36@sentry.wixpress.com,8eb368c655b84e029ed79ad7a5c1718e@sentry.wixpress.com,271e9fa3230b4eec94b02bf95780f5f2@sentry.wixpress.com,a18507e8883842d8a1ba47257fee81ac@sentry.wixpress.com,5d1795a2db124a268f1e1bd88f503500@sentry.wixpress.com,info@vinesrealtyng.com,careers@vinesrealtyng.comSend}	{05314453895,03900000000,05154471132,06249312375}	new	f	Real Estate Firms	Lagos	2026-05-24 14:18:19.599492+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
1943fa0d-bfca-419b-86c3-c445779037b5	56fa9d50-a7f3-4679-a208-105714ede4bc	ChIJDSs4Y4-XOxARztn8Ymm_CjE	G.O.E Realtors Global Services Ltd.	3 Egbatedo Cl, Iju, Lagos 100215, Lagos, Nigeria	https://giwaoluomoenterprises.estateagentsng.com/	{}	{08164516261,08023247585,08127040605}	new	f	Real Estate Firms	Lagos	2026-05-24 14:18:25.65419+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
7375fdb3-6a87-4369-ae7c-9c4fef39eae3	05061054-154d-4ed2-b135-b6e8cf9e1d2b	ChIJ_-Lw3SrXVBARO7Okoblbt30	Speedaf Bauchi Office	69 Nassarawa Road, Bauchi 740102, Bauchi, Nigeria	https://www.google.com/search?kgmid=%2Fg%2F11jt2md3x0&hl=en-NG&q=Speedaf%20Bauchi%20Office&shndl=30&shem=lcuae&source=sh%2Fx%2Floc%2Fosrp%2Fm1%2F4&kgs=0308af13d645b820	{}	{}	new	f	Logistics & Courier	Bauchi	2026-06-22 11:14:14.956495+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	0	\N	google_places	\N
0942ccf9-f552-4d48-8f13-b6925c6c999b	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJnQ9PX8XcQhAR-n2rz5tsCvM	Abia Tech Hub	6 Warri St, Umuahia, 440234, Abia, Nigeria	https://abiatechhub.com/	{}	{}	new	f	Technology Companies	Abia	2026-06-22 13:35:00.374284+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
dd1ba114-6b05-438c-9890-d816cdf94cc6	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJwS5HJ0-ZQhARRibt9ZEUiAY	RAD5 Tech Hub	181 Aba-Owerri Rd, opposite JBM, Along Obinna Nwachukwu Close, Aba, 453111, Abia, Nigeria	https://rad5.com.ng/	{}	{}	new	f	Technology Companies	Abia	2026-06-22 13:35:10.406531+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
6b7b4f13-9f3f-41f0-9822-48a37d7c30e7	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJqw4HExrNaRAR9dw0CMiYfa4	Webdeves Technologies	56 Azikiwe Rd, beside Union Bank, Aba, 450272, Abia, Nigeria	https://webdeves.com/	{info@webdeves.com}	{+2348099111234}	new	f	Technology Companies	Abia	2026-06-22 13:35:14.316056+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
cbf7cb73-c7ff-4e4d-8cfc-87a4cb26443a	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJM4TtsDaZQhARXm5kXDGsaaQ	Ashpot	11 Nicholas Street, Aba, 450721, Abia, Nigeria	https://ashpotmicrosystems.com/	{info@ashpotmicrosystems.com,support@ashpotmicrosystems.com}	{+2348063409307,+2348184503319}	new	f	Technology Companies	Abia	2026-06-22 13:35:19.104693+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
85e97a1b-cb43-4d8e-b194-65d602bc9e56	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJw54OOYaZQhARSq3ogCwplHU	Johad Tech – Web Design & Software Development Company In Abia State	Aba-Owerri Rd, Local, near Okpanu Plaza, Abayi, Aba 453115, Abia, Nigeria	https://johadtech.com.ng/	{hello@johadtech.com.ng}	{+2347085352316}	new	f	Technology Companies	Abia	2026-06-22 13:35:22.999151+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
d0388a98-9cac-4b2e-b56e-c9bb6784df04	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJLQuEG_DFQhARgkmtc8TUedo	BERGE TECH LIMITED	Km 4 Ahiaeke, Ikot Ekpene - Umuahia Rd, Umuahia 100001, Abia, Nigeria	https://bergetech.com/	{}	{}	new	f	Technology Companies	Abia	2026-06-22 13:35:26.559004+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
0e2193a4-385a-44f1-bcb6-dff3dd121c59	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJlwV9HmSZQhARoiK1A1ojcZE	Vicmie Corp	46 Aba-Owerri Rd, beside MTN office, Aba, 450102, Abia, Nigeria	https://vicmie.com/	{}	{}	new	f	Technology Companies	Abia	2026-06-22 13:35:29.006378+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
221eab3e-fb18-4b73-b8d5-87db65a4cae7	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJq6raMMKPOxARjoX2_bbxx7w	Prestige Coding and Technology Limited	1, By Ojike St, Bende Rd, Umu Obasi, Umuahia 440001, Abia, Nigeria	https://prestigecodingtech.com/	{}	{+2348162023360,+2349029083285}	new	f	Technology Companies	Abia	2026-06-22 13:35:42.5132+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
131fa60f-9e88-41d1-b067-211862842509	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJcXuS1ppXXRAR9Ko4I9PUHBo	UKEME EBONG & CO. CHAMBERS	84 Aka Rd, Uyo 520241, Akwa Ibom, Nigeria	http://www.ukemeebong.com/	{}	{}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:37:24.219237+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
f5d40799-ec71-4b1c-9ed3-923149abb84c	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJfW5GB8RXXRARX1dw1lHZMQM	The Jubilee Chambers - Notary Public	5 Udotung Ubo St, Uyo 520102, Akwa Ibom, Nigeria	http://www.jubileedeeds.com/	{contact@jubileedeeds.com,baristaobot@gmail.com}	{}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:37:30.938569+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
132dde6b-6a2a-46f9-94c1-44bbcf94ec11	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJld3z6wBXXRARCBbHaqf2McQ	Aerius Law Firm	47A Ukana Offot St, Uyo 520251, Akwa Ibom, Nigeria	https://aeriuslawfirm.com/	{info@aeriuslawfirm.com}	{+2348124958897,07062726217,08124958897,00000000000,00000555111,02118158340}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:37:36.699096+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
4d14d0fc-a7cd-42fe-bb8e-f7a782127434	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJi1eMRMxXXRAR808q2_lkVbM	Legal Emperors	13A Akpanakpa Etuk St, Uyo 520102, Akwa Ibom, Nigeria	http://www.legalemperors.com.ng/	{contact@legalemperors.com.ng,+234-8037707496contact@legalemperors.com.ngMonday,clientrelations@legalemperors.com.ng}	{}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:37:44.631358+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
014b330c-1423-4be4-b21a-395ece94dfa4	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJg3ziU39XXRARln9pp8dcVYE	Legal Emperors	32 Wellington Bassey Way, Street, Uyo 520103, Akwa Ibom, Nigeria	https://www.legalemperors.com.ng/	{contact@legalemperors.com.ng,+234-8037707496contact@legalemperors.com.ngMonday,clientrelations@legalemperors.com.ng}	{}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:37:49.817518+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
3f1537d2-6fe3-4a52-b1e1-ac44c75be2c0	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJdfgV3mlXXRARNO2fByS46hA	Brime Solicitors	50 IBB Ave, opposite Information Drive, Uyo 520001, Akwa Ibom, Nigeria	http://www.brimesolicitors.com/	{}	{}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:37:53.261534+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
b0c233e2-fd22-44e8-8227-670275b9c60d	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJ9wxKB8RXXRARY2bP95AJgok	Lex Artifex LLP	37 New Birth Avenue, Osongama Estate, Uyo 500001, Akwa Ibom, Nigeria	http://www.lexartifexllp.com/	{lexartifexllp@lexartifexllp.com}	{+2348039795959}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:37:58.507866+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
317c0c6b-defe-49bc-a9d0-af930fedd0dd	34949bc2-4231-4e3a-9fc4-573a631bd2b7	ChIJq9p8UjbdZxAR2j1o9sYGl78	Justice Forte Chambers	Plot 179 Eket - Oron Rd, Eket 524101, Akwa Ibom, Nigeria	https://justiceforte.com/	{info@justiceforte.com}	{}	new	f	Law Firms	Akwa Ibom	2026-06-22 12:38:02.670142+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	0	\N	google_places	\N
437ba510-4a66-4647-b476-b0efeee0f526	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJBecUTFch7aQR9LAIIu_5vtk	OGS TECHNOLOGIES	POWA Shops, 25 local, opp. St Finbarrs Cath church, government area, Umuahia 440002, Abia, Nigeria	http://www.ogstek.blogspot.com/	{}	{00183708200,08037093951,07710174111,02897027711,03272767034,05807778028,01875484291,09798378589}	new	f	Technology Companies	Abia	2026-06-22 13:36:03.863732+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
b9087bbb-4a92-4153-8f0e-2e31468bafed	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJc7_Vaj6SOxARTIRhU6E-rs0	Grange School, Lagos	Harold Sodipo Cres, Ikeja GRA, Ikeja 101233, Lagos, Nigeria	http://grangeschool.com/	{info@grangeschool.com,recruitment@grangeschool.com}	{+2349098846332,+2347089500515,+2347076885663}	new	f	Private Schools	Lagos	2026-05-26 18:49:27.822729+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
de2ba6fe-defa-421d-907a-e2f70837ff7a	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJV2dB-SeLOxARchIhhO_LBJ8	Netherlands International School Lagos	4 Onitana Road, Off Mobolaji Johnson Ave, Ikoyi, Lagos 106104, Lagos, Nigeria	http://www.nislagos.org/	{}	{}	new	f	Private Schools	Lagos	2026-05-26 18:49:40.103584+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
489baedf-69e4-4ef5-8b9f-46a6ba1b9a5a	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJnUD3QYz0OxARx-wnyB-L77s	Banana Island International School	227 Cl, Banana Island, Lagos 106104, Lagos, Nigeria	http://www.bananaislandschool.com/	{training@bananaislandschool.combottom,605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com,460ff4620fa44cba8df530afde949785@sentry.wixpress.com,ed436f5053144538958ad06a5005e99a@sentry.wixpress.com,dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com,c183baa23371454f99f417f6616b724d@sentry.wixpress.com,9a65e97ebe8141fca0c4fd686f70996b@sentry.wixpress.com,18d2f96d279149989b95faf0a4b41882@sentry-next.wixpress.com,2062d0a4929b45348643784b5cb39c36@sentry.wixpress.com,8eb368c655b84e029ed79ad7a5c1718e@sentry.wixpress.com,271e9fa3230b4eec94b02bf95780f5f2@sentry.wixpress.com,5d1795a2db124a268f1e1bd88f503500@sentry.wixpress.com,Emailinfo@mysite.comSocial}	{05314453895,01357421324,06492596394}	new	f	Private Schools	Lagos	2026-05-26 18:49:49.547334+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
f134d5f2-9e4c-497d-85e2-c132ab200d6b	a5981fc1-7ba4-4b99-aaa1-4349043fc931	ChIJF8rP8UWROxARTzXR2bGvM9M	Taqwa Schools	7-11 Taqwa Cres, Ifako-Ijaiye, Lagos 101232, Lagos, Nigeria	https://taqwaschools.org/	{}	{}	new	f	Private Schools	Lagos	2026-05-26 18:50:51.120278+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
2133b11d-f732-4d85-9096-573b3aa45294	4da775f5-ff45-4fab-8518-74f9cea1b5fc	ChIJO90SNz9r_BARjc_bjgJ5ln4	Yola Electricity Distribution Company	Karewa, Jimeta 640101, Adamawa, Nigeria	https://yedc.com.ng/team.html	{}	{}	new	f	Manufacturing Companies	Adamawa	2026-06-07 08:49:05.852157+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Adamawa	\N	0	\N	google_places	\N
b19c44e3-5107-4c9a-ad26-e11a240461db	68fa0c6b-33ef-4442-8238-f43877a51d46	ChIJvVakjzzXVBARJHMqEij-jEk	Malcomines Minor Metals Bauchi	8R6G+4MR, Abdulkadir Ahmed Rd, Bauchi 740102, Bauchi, Nigeria	http://www.malcomines.com/	{605a7baede844d278b89dc95ae0a9123@sentry-next.wixpress.com,dd0a55ccb8124b9c9d938e3acf41f8aa@sentry.wixpress.com,c183baa23371454f99f417f6616b724d@sentry.wixpress.com,9a65e97ebe8141fca0c4fd686f70996b@sentry.wixpress.com,8eb368c655b84e029ed79ad7a5c1718e@sentry.wixpress.com}	{02814901962,02492031325}	new	f	Manufacturing Companies	Bauchi	2026-06-22 10:30:15.622281+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	0	\N	google_places	\N
284bf2ef-958c-4244-8e49-cbd63e3ba377	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJoZBpNjKKOxARat_UzZZ37Ag	MRS Oil & Gas Co. Ltd	Tin-Can Island, 2 Port Road, Apapa, Lagos 102272, Lagos, Nigeria	http://www.mrsholdings.com/	{info@mrsholdings.com}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:22:44.69935+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
523b4da7-8e07-4fdc-8da1-d2abb6eee182	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJT6fDQqb1OxARAeDcMmkLRs8	Techno Oil Limited	7b Prince Alaba Abiodun Oniru Rd, Victoria Island, Lagos 106104, Lagos, Nigeria	http://www.technooil.com/	{Emailbusiness@technooil.com,business@technooil.com,info@technooil.com}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:22:49.674031+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
0964c598-3e65-4fa7-9cf0-cf534642530e	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJkXO-WB6OOxARGgq0r7XVUOA	CITA ENERGIES LIMITED	Int'l Airport Rd, Mafoluku Oshodi, Lagos 102214, Lagos, Nigeria	http://www.citaenergies.com/	{info@citaenergies.com}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:22:54.671281+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
d43b1aa7-eec6-4de7-a321-5dae34091cd2	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJEyqipy_1OxARBYJ3pYPNq5w	Bell Oil And Gas Limited	12 Saka Jojo St, Victoria Island, Lagos 106104, Lagos, Nigeria	http://www.belloil.com/	{}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:22:59.580293+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
d744b1ae-34cc-4dc7-969d-499b04cc4eac	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJu3vf9uv0OxARG7QbhLo304I	A2M Energy Limited	56A Itafaji Rd, Dolphin Estate, Lagos 106104, Lagos, Nigeria	http://www.a2menergy.com/	{info@a2menergy.com}	{09166982000}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:13.436447+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
095cd491-57f9-4a30-a1be-2e71408871f1	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJpyJ0_DL1OxAR04LdmE2yE3Q	Midwestern Oil & Gas Company Limited	10 Otunba Adedoyin Ogungbe Cres, Lekki Phase I, Lagos 106104, Lagos, Nigeria	http://www.midwesternog.com/	{info@midwesternog.com}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:21.587909+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
b0598175-b814-4a04-b804-0813d6c74586	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJL6ZroBCLOxARMkTUCdIRpq8	Shell Nigeria Gas Limited	21, 22 Marina Rd, Lagos Island, Lagos 102273, Lagos, Nigeria	http://www.shell.com.ng/	{}	{}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:25.70293+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
8eaf0e1b-1207-4d0a-be5d-5ed7a044efd3	0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	ChIJ_-LWCE6MOxARyFW0TZnt3so	Lonadek Global Services	No 12 Jibowu St, Yaba, Lagos 101245, Lagos, Nigeria	https://www.lonadek.com/	{contact@lonadek.com}	{+2349062832077}	new	f	Oil & Gas Companies	Lagos	2026-05-17 22:23:33.882472+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	0	\N	google_places	\N
069b0410-5cfb-47ef-9517-3e668fab0511	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJkaxzKEyZQhARvnGWubNLyw8	Innovation Growth Hub	10 Calabar Street, Aba, 450211, Abia, Nigeria	https://www.ighub.ng/	{info@ighub.com.ng,contact@ighub.ng,mCZB@FXY.MK}	{07087946083}	new	f	Technology Companies	Abia	2026-06-22 13:36:16.966618+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
87e03528-fd4e-4488-a080-85a33e8d087e	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJhw_4GbuZQhARWl7mFiROi_o	STEFF GLOBAL TECH	No 4 Ugwumba St, off Seven Bottling Company, Ogbor Hill, Aba 450101, Abia, Nigeria	http://www.steffglobaltech.com/	{steffglobaltech@gmail.com,steffiglobalteche@gmail.com}	{}	new	f	Technology Companies	Abia	2026-06-22 13:36:33.336211+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
c63f397f-7521-4644-adf6-d462ab114d03	b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	ChIJt8wmbu2ZQhARw6TlXyk5r4o	Webdeves Academy	56 Azikiwe Rd, beside Union Bank, Aba, 450272, Abia, Nigeria	https://webdevesacademy.com/	{support@webdevesacademy.com,info@webdevesacademy.com}	{}	new	f	Technology Companies	Abia	2026-06-22 13:36:39.454715+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	0	\N	google_places	\N
\.


--
-- TOC entry 4068 (class 0 OID 17581)
-- Dependencies: 356
-- Data for Name: mail_templates; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.mail_templates (id, title, subject, body, tag, use_count, last_used, created_at) FROM stdin;
96c3b106-0044-432c-b1bb-09d7a643add2	check up	check up	how are you doing	General	0	\N	2026-05-26 15:28:33.646425+00
\.


--
-- TOC entry 4078 (class 0 OID 34173)
-- Dependencies: 366
-- Data for Name: overage_charges; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.overage_charges (id, company_id, invoice_id, month, action, units_over, rate, total, created_at) FROM stdin;
\.


--
-- TOC entry 4070 (class 0 OID 33913)
-- Dependencies: 358
-- Data for Name: plan_limits; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.plan_limits (plan, scrape_limit, email_limit, export_limit, max_leads, setup_fee, renewal_fee, duration_days) FROM stdin;
demo	3	10	0	20	0	0	7
starter	30	1000	20	\N	700000	300000	\N
growth	80	10000	50	\N	1200000	500000	\N
enterprise	200	50000	\N	\N	1700000	700000	\N
\.


--
-- TOC entry 4079 (class 0 OID 34193)
-- Dependencies: 367
-- Data for Name: sales_pipeline; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.sales_pipeline (id, company_name, contact_name, contact_role, email, phone, linkedin_url, source, status, deal_value, notes, last_contacted, follow_up_date, assigned_to, created_at) FROM stdin;
\.


--
-- TOC entry 4066 (class 0 OID 17547)
-- Dependencies: 354
-- Data for Name: scrape_jobs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.scrape_jobs (id, status, category, location, total, processed, created_at, company_id, state, local_govt, error_msg, started_at, completed_at) FROM stdin;
05061054-154d-4ed2-b135-b6e8cf9e1d2b	completed	Logistics & Courier	Bauchi	7	6	2026-06-22 11:14:01.66421+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	\N	2026-06-25 12:13:02.43459+00	\N
45083b42-f471-4e07-8fa0-ca7d2f1ed983	completed	Microfinance Banks	Lagos	20	20	2026-05-18 14:46:45.241731+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
4c888573-874e-407d-9156-16dd70288be5	completed	Microfinance Banks	Anambra	20	9	2026-06-22 14:34:21.965301+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	\N	2026-06-25 12:13:02.43459+00	\N
a5981fc1-7ba4-4b99-aaa1-4349043fc931	completed	Private Schools	Lagos	20	20	2026-05-26 18:43:38.937084+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
05d324ac-15d0-46ef-9e7c-a01334453d9f	running	Food & Beverage	Lagos	0	0	2026-05-27 13:48:32.376967+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
0532a42e-5a7c-4af4-84c4-80ea3d0a24f1	completed	Oil & Gas Companies	Lagos	20	20	2026-05-17 22:22:28.88733+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
726be333-ee5d-4b7a-a931-181f8246f1ef	completed	Microfinance Banks	Anambra	20	9	2026-06-22 14:34:21.448887+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	\N	2026-06-25 12:13:02.43459+00	\N
daa0fce9-2e74-4529-873e-2d757a0b4ff5	completed	Law Firms	Akwa Ibom	20	15	2026-06-22 12:37:20.751286+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	\N	2026-06-25 12:13:02.43459+00	\N
c03911c8-510c-4bba-863d-8bcc5cf018a7	completed	Law Firms	Lagos	20	20	2026-05-18 14:44:13.732868+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
4e934374-3aca-4d88-a021-69879f7cd515	completed	Food & Beverage	Lagos	20	20	2026-05-27 13:54:35.828349+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
5656212a-d80c-47e2-99a1-12bfe388f9b9	completed	Microfinance Banks	Lagos	20	20	2026-05-18 11:09:42.937267+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
54174d5e-af85-4097-843b-ed2d0a83d745	completed	Logistics & Courier	Lagos	20	19	2026-05-18 14:55:15.232247+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
7187fdd7-a3f4-48c0-8b4d-ad4b5a75540c	running	Real Estate Firms	Lagos	20	0	2026-05-18 15:46:09.63988+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
f5a9e0a3-1a54-4217-80a2-08b6b6d2e3c4	running	Construction Companies	Lagos	0	0	2026-05-21 14:17:16.476569+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
4da775f5-ff45-4fab-8518-74f9cea1b5fc	completed	Manufacturing Companies	Adamawa	20	14	2026-06-07 08:48:52.471079+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Adamawa	\N	\N	2026-06-25 12:13:02.43459+00	\N
34949bc2-4231-4e3a-9fc4-573a631bd2b7	completed	Law Firms	Akwa Ibom	20	15	2026-06-22 14:38:47.244097+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	\N	2026-06-25 12:13:02.43459+00	\N
56fa9d50-a7f3-4679-a208-105714ede4bc	running	Real Estate Firms	Lagos	20	9	2026-05-24 14:17:08.818953+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
ab5412b0-9c96-4f99-8d20-0964d2111c2c	running	Construction Companies	Lagos	0	0	2026-05-26 15:33:00.634253+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Lagos	\N	\N	2026-06-25 12:13:02.43459+00	\N
2b42e3a9-6dd3-4b57-aa80-2c4f343feb95	completed	Law Firms	Anambra	20	19	2026-06-22 09:36:55.644395+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Anambra	\N	\N	2026-06-25 12:13:02.43459+00	\N
175d3333-c634-4c3f-bfed-86f9af302b65	completed	Law Firms	Akwa Ibom	20	15	2026-06-22 13:33:07.671263+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	\N	2026-06-25 12:13:02.43459+00	\N
9abfb39b-0150-4bfc-8410-e07fbbd20119	completed	Law Firms	Akwa Ibom	20	15	2026-06-22 13:33:08.53201+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Akwa Ibom	\N	\N	2026-06-25 12:13:02.43459+00	\N
79c96dd7-880c-4994-bc2a-61ffa2bc8b9c	completed	Manufacturing Companies	Bauchi	20	15	2026-06-22 10:30:07.102625+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	\N	2026-06-25 12:13:02.43459+00	\N
42fd218a-c11d-4d53-9a82-f8deed2242c3	completed	Manufacturing Companies	Bauchi	20	20	2026-06-22 10:30:45.409119+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	\N	2026-06-25 12:13:02.43459+00	\N
2938e926-187f-4ecd-9b2f-d7cc12495e48	completed	Manufacturing Companies	Bauchi	20	15	2026-06-22 10:31:16.500175+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	\N	2026-06-25 12:13:02.43459+00	\N
68fa0c6b-33ef-4442-8238-f43877a51d46	completed	Manufacturing Companies	Bauchi	20	20	2026-06-22 10:32:04.762251+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Bauchi	\N	\N	2026-06-25 12:13:02.43459+00	\N
b9dd686e-7ca4-4e9a-adb5-6e4402b7db2c	completed	Technology Companies	Abia	20	20	2026-06-22 13:34:57.268455+00	1f7583d8-4b4e-4b5a-ada4-c9fabc608533	Abia	\N	\N	2026-06-25 12:13:02.43459+00	\N
\.


--
-- TOC entry 4080 (class 0 OID 34205)
-- Dependencies: 368
-- Data for Name: system_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.system_logs (id, admin_id, action, target_id, details, created_at) FROM stdin;
\.


--
-- TOC entry 4073 (class 0 OID 34072)
-- Dependencies: 361
-- Data for Name: usage_logs; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.usage_logs (id, company_id, action, units, cost, metadata, created_at) FROM stdin;
\.


--
-- TOC entry 4074 (class 0 OID 34091)
-- Dependencies: 362
-- Data for Name: usage_monthly_summary; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.usage_monthly_summary (id, company_id, month, scrape_count, email_count, export_count, total_cost, updated_at) FROM stdin;
\.


--
-- TOC entry 4069 (class 0 OID 33876)
-- Dependencies: 357
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: postgres
--

COPY public.users (id, company_id, email, full_name, role, is_active, last_login, created_at) FROM stdin;
e2aba7f3-76b1-4468-bf29-078d780468b7	\N	osimesimon@gmail.com	Admin	admin	t	\N	2026-06-24 19:20:22.018808+00
\.


--
-- TOC entry 3823 (class 2606 OID 33934)
-- Name: companies companies_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_pkey PRIMARY KEY (id);


--
-- TOC entry 3843 (class 2606 OID 34147)
-- Name: demo_feature_flags demo_feature_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_feature_flags
    ADD CONSTRAINT demo_feature_flags_pkey PRIMARY KEY (id);


--
-- TOC entry 3841 (class 2606 OID 34121)
-- Name: demo_usage demo_usage_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_usage
    ADD CONSTRAINT demo_usage_pkey PRIMARY KEY (id);


--
-- TOC entry 3863 (class 2606 OID 34261)
-- Name: email_campaigns email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);


--
-- TOC entry 3867 (class 2606 OID 34281)
-- Name: email_events email_events_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_pkey PRIMARY KEY (id);


--
-- TOC entry 3828 (class 2606 OID 34041)
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- TOC entry 3848 (class 2606 OID 34164)
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- TOC entry 3807 (class 2606 OID 17573)
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- TOC entry 3810 (class 2606 OID 17575)
-- Name: leads leads_place_id_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_place_id_key UNIQUE (place_id);


--
-- TOC entry 3814 (class 2606 OID 17592)
-- Name: mail_templates mail_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.mail_templates
    ADD CONSTRAINT mail_templates_pkey PRIMARY KEY (id);


--
-- TOC entry 3851 (class 2606 OID 34181)
-- Name: overage_charges overage_charges_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.overage_charges
    ADD CONSTRAINT overage_charges_pkey PRIMARY KEY (id);


--
-- TOC entry 3820 (class 2606 OID 33919)
-- Name: plan_limits plan_limits_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.plan_limits
    ADD CONSTRAINT plan_limits_pkey PRIMARY KEY (plan);


--
-- TOC entry 3855 (class 2606 OID 34202)
-- Name: sales_pipeline sales_pipeline_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sales_pipeline
    ADD CONSTRAINT sales_pipeline_pkey PRIMARY KEY (id);


--
-- TOC entry 3800 (class 2606 OID 17559)
-- Name: scrape_jobs scrape_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scrape_jobs
    ADD CONSTRAINT scrape_jobs_pkey PRIMARY KEY (id);


--
-- TOC entry 3860 (class 2606 OID 34213)
-- Name: system_logs system_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_pkey PRIMARY KEY (id);


--
-- TOC entry 3833 (class 2606 OID 34082)
-- Name: usage_logs usage_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_pkey PRIMARY KEY (id);


--
-- TOC entry 3835 (class 2606 OID 34105)
-- Name: usage_monthly_summary usage_monthly_summary_company_id_month_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_monthly_summary
    ADD CONSTRAINT usage_monthly_summary_company_id_month_key UNIQUE (company_id, month);


--
-- TOC entry 3837 (class 2606 OID 34103)
-- Name: usage_monthly_summary usage_monthly_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_monthly_summary
    ADD CONSTRAINT usage_monthly_summary_pkey PRIMARY KEY (id);


--
-- TOC entry 3817 (class 2606 OID 33885)
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- TOC entry 3821 (class 1259 OID 33942)
-- Name: companies_is_demo_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX companies_is_demo_idx ON public.companies USING btree (is_demo);


--
-- TOC entry 3824 (class 1259 OID 33941)
-- Name: companies_plan_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX companies_plan_idx ON public.companies USING btree (plan);


--
-- TOC entry 3825 (class 1259 OID 33940)
-- Name: companies_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX companies_status_idx ON public.companies USING btree (status);


--
-- TOC entry 3844 (class 1259 OID 34153)
-- Name: demo_flags_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX demo_flags_company_idx ON public.demo_feature_flags USING btree (company_id);


--
-- TOC entry 3839 (class 1259 OID 34127)
-- Name: demo_usage_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX demo_usage_company_idx ON public.demo_usage USING btree (company_id);


--
-- TOC entry 3861 (class 1259 OID 34272)
-- Name: email_campaigns_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX email_campaigns_company_idx ON public.email_campaigns USING btree (company_id);


--
-- TOC entry 3864 (class 1259 OID 34293)
-- Name: email_events_campaign_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX email_events_campaign_idx ON public.email_events USING btree (campaign_id);


--
-- TOC entry 3865 (class 1259 OID 34292)
-- Name: email_events_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX email_events_company_idx ON public.email_events USING btree (company_id);


--
-- TOC entry 3868 (class 1259 OID 34294)
-- Name: email_events_type_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX email_events_type_idx ON public.email_events USING btree (event);


--
-- TOC entry 3826 (class 1259 OID 34047)
-- Name: email_templates_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX email_templates_company_idx ON public.email_templates USING btree (company_id);


--
-- TOC entry 3845 (class 1259 OID 34170)
-- Name: invoices_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_company_idx ON public.invoices USING btree (company_id);


--
-- TOC entry 3846 (class 1259 OID 34172)
-- Name: invoices_due_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_due_idx ON public.invoices USING btree (due_date);


--
-- TOC entry 3849 (class 1259 OID 34171)
-- Name: invoices_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX invoices_status_idx ON public.invoices USING btree (status);


--
-- TOC entry 3801 (class 1259 OID 34022)
-- Name: leads_company_category_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_company_category_idx ON public.leads USING btree (company_id, category);


--
-- TOC entry 3802 (class 1259 OID 34020)
-- Name: leads_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_company_idx ON public.leads USING btree (company_id);


--
-- TOC entry 3803 (class 1259 OID 34021)
-- Name: leads_company_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_company_status_idx ON public.leads USING btree (company_id, status);


--
-- TOC entry 3804 (class 1259 OID 17593)
-- Name: leads_job_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_job_id_idx ON public.leads USING btree (job_id);


--
-- TOC entry 3805 (class 1259 OID 34024)
-- Name: leads_local_govt_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_local_govt_idx ON public.leads USING btree (local_govt);


--
-- TOC entry 3808 (class 1259 OID 17595)
-- Name: leads_place_id_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_place_id_idx ON public.leads USING btree (place_id);


--
-- TOC entry 3811 (class 1259 OID 34023)
-- Name: leads_state_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_state_idx ON public.leads USING btree (state);


--
-- TOC entry 3812 (class 1259 OID 17594)
-- Name: leads_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX leads_status_idx ON public.leads USING btree (status);


--
-- TOC entry 3852 (class 1259 OID 34192)
-- Name: overage_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX overage_company_idx ON public.overage_charges USING btree (company_id);


--
-- TOC entry 3853 (class 1259 OID 34204)
-- Name: sales_pipeline_follow_up; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sales_pipeline_follow_up ON public.sales_pipeline USING btree (follow_up_date);


--
-- TOC entry 3856 (class 1259 OID 34203)
-- Name: sales_pipeline_status_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sales_pipeline_status_idx ON public.sales_pipeline USING btree (status);


--
-- TOC entry 3798 (class 1259 OID 34031)
-- Name: scrape_jobs_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX scrape_jobs_company_idx ON public.scrape_jobs USING btree (company_id);


--
-- TOC entry 3857 (class 1259 OID 34220)
-- Name: system_logs_action_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX system_logs_action_idx ON public.system_logs USING btree (action);


--
-- TOC entry 3858 (class 1259 OID 34219)
-- Name: system_logs_admin_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX system_logs_admin_idx ON public.system_logs USING btree (admin_id);


--
-- TOC entry 3829 (class 1259 OID 34089)
-- Name: usage_logs_company_action_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX usage_logs_company_action_idx ON public.usage_logs USING btree (company_id, action);


--
-- TOC entry 3830 (class 1259 OID 34088)
-- Name: usage_logs_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX usage_logs_company_idx ON public.usage_logs USING btree (company_id);


--
-- TOC entry 3831 (class 1259 OID 34090)
-- Name: usage_logs_created_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX usage_logs_created_idx ON public.usage_logs USING btree (created_at);


--
-- TOC entry 3838 (class 1259 OID 34111)
-- Name: usage_summary_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX usage_summary_company_idx ON public.usage_monthly_summary USING btree (company_id);


--
-- TOC entry 3815 (class 1259 OID 33943)
-- Name: users_company_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_company_idx ON public.users USING btree (company_id);


--
-- TOC entry 3818 (class 1259 OID 33892)
-- Name: users_role_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX users_role_idx ON public.users USING btree (role);


--
-- TOC entry 3888 (class 2620 OID 34222)
-- Name: usage_logs trg_update_usage_summary; Type: TRIGGER; Schema: public; Owner: postgres
--

CREATE TRIGGER trg_update_usage_summary AFTER INSERT ON public.usage_logs FOR EACH ROW EXECUTE FUNCTION public.update_usage_summary();


--
-- TOC entry 3874 (class 2606 OID 33935)
-- Name: companies companies_plan_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.companies
    ADD CONSTRAINT companies_plan_fkey FOREIGN KEY (plan) REFERENCES public.plan_limits(plan);


--
-- TOC entry 3879 (class 2606 OID 34148)
-- Name: demo_feature_flags demo_feature_flags_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_feature_flags
    ADD CONSTRAINT demo_feature_flags_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3878 (class 2606 OID 34122)
-- Name: demo_usage demo_usage_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.demo_usage
    ADD CONSTRAINT demo_usage_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3884 (class 2606 OID 34262)
-- Name: email_campaigns email_campaigns_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3885 (class 2606 OID 34267)
-- Name: email_campaigns email_campaigns_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.email_templates(id);


--
-- TOC entry 3886 (class 2606 OID 34287)
-- Name: email_events email_events_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id);


--
-- TOC entry 3887 (class 2606 OID 34282)
-- Name: email_events email_events_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_events
    ADD CONSTRAINT email_events_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3875 (class 2606 OID 34042)
-- Name: email_templates email_templates_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3872 (class 2606 OID 33944)
-- Name: users fk_users_company; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT fk_users_company FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE SET NULL;


--
-- TOC entry 3880 (class 2606 OID 34165)
-- Name: invoices invoices_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3870 (class 2606 OID 33992)
-- Name: leads leads_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3871 (class 2606 OID 17576)
-- Name: leads leads_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.scrape_jobs(id) ON DELETE CASCADE;


--
-- TOC entry 3881 (class 2606 OID 34182)
-- Name: overage_charges overage_charges_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.overage_charges
    ADD CONSTRAINT overage_charges_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3882 (class 2606 OID 34187)
-- Name: overage_charges overage_charges_invoice_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.overage_charges
    ADD CONSTRAINT overage_charges_invoice_id_fkey FOREIGN KEY (invoice_id) REFERENCES public.invoices(id);


--
-- TOC entry 3869 (class 2606 OID 34026)
-- Name: scrape_jobs scrape_jobs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.scrape_jobs
    ADD CONSTRAINT scrape_jobs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3883 (class 2606 OID 34214)
-- Name: system_logs system_logs_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_logs
    ADD CONSTRAINT system_logs_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.users(id);


--
-- TOC entry 3876 (class 2606 OID 34083)
-- Name: usage_logs usage_logs_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_logs
    ADD CONSTRAINT usage_logs_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3877 (class 2606 OID 34106)
-- Name: usage_monthly_summary usage_monthly_summary_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.usage_monthly_summary
    ADD CONSTRAINT usage_monthly_summary_company_id_fkey FOREIGN KEY (company_id) REFERENCES public.companies(id) ON DELETE CASCADE;


--
-- TOC entry 3873 (class 2606 OID 33886)
-- Name: users users_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- TOC entry 4046 (class 0 OID 33920)
-- Dependencies: 359
-- Name: companies; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4051 (class 0 OID 34128)
-- Dependencies: 364
-- Name: demo_feature_flags; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.demo_feature_flags ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4050 (class 0 OID 34112)
-- Dependencies: 363
-- Name: demo_usage; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.demo_usage ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4056 (class 0 OID 34247)
-- Dependencies: 373
-- Name: email_campaigns; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4057 (class 0 OID 34273)
-- Dependencies: 374
-- Name: email_events; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4047 (class 0 OID 34032)
-- Dependencies: 360
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4052 (class 0 OID 34154)
-- Dependencies: 365
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4061 (class 3256 OID 34298)
-- Name: email_campaigns isolate_email_campaigns; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY isolate_email_campaigns ON public.email_campaigns USING ((company_id = ( SELECT users.company_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- TOC entry 4062 (class 3256 OID 34299)
-- Name: email_events isolate_email_events; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY isolate_email_events ON public.email_events USING ((company_id = ( SELECT users.company_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- TOC entry 4060 (class 3256 OID 34297)
-- Name: email_templates isolate_email_templates; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY isolate_email_templates ON public.email_templates USING ((company_id = ( SELECT users.company_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- TOC entry 4064 (class 3256 OID 34301)
-- Name: invoices isolate_invoices; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY isolate_invoices ON public.invoices USING ((company_id = ( SELECT users.company_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- TOC entry 4058 (class 3256 OID 34295)
-- Name: leads isolate_leads; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY isolate_leads ON public.leads USING ((company_id = ( SELECT users.company_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- TOC entry 4059 (class 3256 OID 34296)
-- Name: scrape_jobs isolate_scrape_jobs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY isolate_scrape_jobs ON public.scrape_jobs USING ((company_id = ( SELECT users.company_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- TOC entry 4063 (class 3256 OID 34300)
-- Name: usage_logs isolate_usage_logs; Type: POLICY; Schema: public; Owner: postgres
--

CREATE POLICY isolate_usage_logs ON public.usage_logs USING ((company_id = ( SELECT users.company_id
   FROM public.users
  WHERE (users.id = auth.uid()))));


--
-- TOC entry 4042 (class 0 OID 17560)
-- Dependencies: 355
-- Name: leads; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4043 (class 0 OID 17581)
-- Dependencies: 356
-- Name: mail_templates; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.mail_templates ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4053 (class 0 OID 34173)
-- Dependencies: 366
-- Name: overage_charges; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.overage_charges ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4045 (class 0 OID 33913)
-- Dependencies: 358
-- Name: plan_limits; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.plan_limits ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4054 (class 0 OID 34193)
-- Dependencies: 367
-- Name: sales_pipeline; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.sales_pipeline ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4041 (class 0 OID 17547)
-- Dependencies: 354
-- Name: scrape_jobs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4055 (class 0 OID 34205)
-- Dependencies: 368
-- Name: system_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.system_logs ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4048 (class 0 OID 34072)
-- Dependencies: 361
-- Name: usage_logs; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.usage_logs ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4049 (class 0 OID 34091)
-- Dependencies: 362
-- Name: usage_monthly_summary; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.usage_monthly_summary ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4044 (class 0 OID 33876)
-- Dependencies: 357
-- Name: users; Type: ROW SECURITY; Schema: public; Owner: postgres
--

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

--
-- TOC entry 4089 (class 0 OID 0)
-- Dependencies: 17
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: pg_database_owner
--

GRANT USAGE ON SCHEMA public TO postgres;
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT USAGE ON SCHEMA public TO service_role;


--
-- TOC entry 4090 (class 0 OID 0)
-- Dependencies: 487
-- Name: FUNCTION convert_demo_to_paid(p_company_id uuid, p_plan text, p_months integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.convert_demo_to_paid(p_company_id uuid, p_plan text, p_months integer) TO anon;
GRANT ALL ON FUNCTION public.convert_demo_to_paid(p_company_id uuid, p_plan text, p_months integer) TO authenticated;
GRANT ALL ON FUNCTION public.convert_demo_to_paid(p_company_id uuid, p_plan text, p_months integer) TO service_role;


--
-- TOC entry 4091 (class 0 OID 0)
-- Dependencies: 486
-- Name: FUNCTION create_demo_company(p_name text, p_email text, p_days integer); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.create_demo_company(p_name text, p_email text, p_days integer) TO anon;
GRANT ALL ON FUNCTION public.create_demo_company(p_name text, p_email text, p_days integer) TO authenticated;
GRANT ALL ON FUNCTION public.create_demo_company(p_name text, p_email text, p_days integer) TO service_role;


--
-- TOC entry 4092 (class 0 OID 0)
-- Dependencies: 484
-- Name: FUNCTION handle_new_user(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.handle_new_user() TO anon;
GRANT ALL ON FUNCTION public.handle_new_user() TO authenticated;
GRANT ALL ON FUNCTION public.handle_new_user() TO service_role;


--
-- TOC entry 4093 (class 0 OID 0)
-- Dependencies: 488
-- Name: FUNCTION suspend_expired_demos(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.suspend_expired_demos() TO anon;
GRANT ALL ON FUNCTION public.suspend_expired_demos() TO authenticated;
GRANT ALL ON FUNCTION public.suspend_expired_demos() TO service_role;


--
-- TOC entry 4094 (class 0 OID 0)
-- Dependencies: 489
-- Name: FUNCTION suspend_expired_plans(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.suspend_expired_plans() TO anon;
GRANT ALL ON FUNCTION public.suspend_expired_plans() TO authenticated;
GRANT ALL ON FUNCTION public.suspend_expired_plans() TO service_role;


--
-- TOC entry 4095 (class 0 OID 0)
-- Dependencies: 485
-- Name: FUNCTION update_usage_summary(); Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON FUNCTION public.update_usage_summary() TO anon;
GRANT ALL ON FUNCTION public.update_usage_summary() TO authenticated;
GRANT ALL ON FUNCTION public.update_usage_summary() TO service_role;


--
-- TOC entry 4096 (class 0 OID 0)
-- Dependencies: 359
-- Name: TABLE companies; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.companies TO anon;
GRANT ALL ON TABLE public.companies TO authenticated;
GRANT ALL ON TABLE public.companies TO service_role;


--
-- TOC entry 4097 (class 0 OID 0)
-- Dependencies: 358
-- Name: TABLE plan_limits; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.plan_limits TO anon;
GRANT ALL ON TABLE public.plan_limits TO authenticated;
GRANT ALL ON TABLE public.plan_limits TO service_role;


--
-- TOC entry 4098 (class 0 OID 0)
-- Dependencies: 362
-- Name: TABLE usage_monthly_summary; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.usage_monthly_summary TO anon;
GRANT ALL ON TABLE public.usage_monthly_summary TO authenticated;
GRANT ALL ON TABLE public.usage_monthly_summary TO service_role;


--
-- TOC entry 4099 (class 0 OID 0)
-- Dependencies: 369
-- Name: TABLE admin_company_overview; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.admin_company_overview TO anon;
GRANT ALL ON TABLE public.admin_company_overview TO authenticated;
GRANT ALL ON TABLE public.admin_company_overview TO service_role;


--
-- TOC entry 4100 (class 0 OID 0)
-- Dependencies: 363
-- Name: TABLE demo_usage; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.demo_usage TO anon;
GRANT ALL ON TABLE public.demo_usage TO authenticated;
GRANT ALL ON TABLE public.demo_usage TO service_role;


--
-- TOC entry 4101 (class 0 OID 0)
-- Dependencies: 370
-- Name: TABLE admin_demo_overview; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.admin_demo_overview TO anon;
GRANT ALL ON TABLE public.admin_demo_overview TO authenticated;
GRANT ALL ON TABLE public.admin_demo_overview TO service_role;


--
-- TOC entry 4102 (class 0 OID 0)
-- Dependencies: 364
-- Name: TABLE demo_feature_flags; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.demo_feature_flags TO anon;
GRANT ALL ON TABLE public.demo_feature_flags TO authenticated;
GRANT ALL ON TABLE public.demo_feature_flags TO service_role;


--
-- TOC entry 4103 (class 0 OID 0)
-- Dependencies: 373
-- Name: TABLE email_campaigns; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.email_campaigns TO anon;
GRANT ALL ON TABLE public.email_campaigns TO authenticated;
GRANT ALL ON TABLE public.email_campaigns TO service_role;


--
-- TOC entry 4104 (class 0 OID 0)
-- Dependencies: 374
-- Name: TABLE email_events; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.email_events TO anon;
GRANT ALL ON TABLE public.email_events TO authenticated;
GRANT ALL ON TABLE public.email_events TO service_role;


--
-- TOC entry 4105 (class 0 OID 0)
-- Dependencies: 360
-- Name: TABLE email_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.email_templates TO anon;
GRANT ALL ON TABLE public.email_templates TO authenticated;
GRANT ALL ON TABLE public.email_templates TO service_role;


--
-- TOC entry 4106 (class 0 OID 0)
-- Dependencies: 365
-- Name: TABLE invoices; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.invoices TO anon;
GRANT ALL ON TABLE public.invoices TO authenticated;
GRANT ALL ON TABLE public.invoices TO service_role;


--
-- TOC entry 4107 (class 0 OID 0)
-- Dependencies: 355
-- Name: TABLE leads; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.leads TO anon;
GRANT ALL ON TABLE public.leads TO authenticated;
GRANT ALL ON TABLE public.leads TO service_role;


--
-- TOC entry 4108 (class 0 OID 0)
-- Dependencies: 356
-- Name: TABLE mail_templates; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.mail_templates TO anon;
GRANT ALL ON TABLE public.mail_templates TO authenticated;
GRANT ALL ON TABLE public.mail_templates TO service_role;


--
-- TOC entry 4109 (class 0 OID 0)
-- Dependencies: 366
-- Name: TABLE overage_charges; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.overage_charges TO anon;
GRANT ALL ON TABLE public.overage_charges TO authenticated;
GRANT ALL ON TABLE public.overage_charges TO service_role;


--
-- TOC entry 4110 (class 0 OID 0)
-- Dependencies: 371
-- Name: TABLE renewals_due; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.renewals_due TO anon;
GRANT ALL ON TABLE public.renewals_due TO authenticated;
GRANT ALL ON TABLE public.renewals_due TO service_role;


--
-- TOC entry 4111 (class 0 OID 0)
-- Dependencies: 372
-- Name: TABLE revenue_summary; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.revenue_summary TO anon;
GRANT ALL ON TABLE public.revenue_summary TO authenticated;
GRANT ALL ON TABLE public.revenue_summary TO service_role;


--
-- TOC entry 4112 (class 0 OID 0)
-- Dependencies: 367
-- Name: TABLE sales_pipeline; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sales_pipeline TO anon;
GRANT ALL ON TABLE public.sales_pipeline TO authenticated;
GRANT ALL ON TABLE public.sales_pipeline TO service_role;


--
-- TOC entry 4113 (class 0 OID 0)
-- Dependencies: 354
-- Name: TABLE scrape_jobs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.scrape_jobs TO anon;
GRANT ALL ON TABLE public.scrape_jobs TO authenticated;
GRANT ALL ON TABLE public.scrape_jobs TO service_role;


--
-- TOC entry 4114 (class 0 OID 0)
-- Dependencies: 368
-- Name: TABLE system_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.system_logs TO anon;
GRANT ALL ON TABLE public.system_logs TO authenticated;
GRANT ALL ON TABLE public.system_logs TO service_role;


--
-- TOC entry 4115 (class 0 OID 0)
-- Dependencies: 361
-- Name: TABLE usage_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.usage_logs TO anon;
GRANT ALL ON TABLE public.usage_logs TO authenticated;
GRANT ALL ON TABLE public.usage_logs TO service_role;


--
-- TOC entry 4116 (class 0 OID 0)
-- Dependencies: 357
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO anon;
GRANT ALL ON TABLE public.users TO authenticated;
GRANT ALL ON TABLE public.users TO service_role;


--
-- TOC entry 2472 (class 826 OID 16494)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- TOC entry 2473 (class 826 OID 16495)
-- Name: DEFAULT PRIVILEGES FOR SEQUENCES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON SEQUENCES TO service_role;


--
-- TOC entry 2471 (class 826 OID 16493)
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- TOC entry 2475 (class 826 OID 16497)
-- Name: DEFAULT PRIVILEGES FOR FUNCTIONS; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON FUNCTIONS TO service_role;


--
-- TOC entry 2470 (class 826 OID 16492)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: postgres
--

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO service_role;


--
-- TOC entry 2474 (class 826 OID 16496)
-- Name: DEFAULT PRIVILEGES FOR TABLES; Type: DEFAULT ACL; Schema: public; Owner: supabase_admin
--

ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO postgres;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO anon;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public GRANT ALL ON TABLES TO service_role;


-- Completed on 2026-06-25 15:18:06

--
-- PostgreSQL database dump complete
--

\unrestrict ooKggaaURZi8phev0pnlzGoegYzwSwTCghs4XYSvehaSUmI1wagwa5e2HwpLZ8s

