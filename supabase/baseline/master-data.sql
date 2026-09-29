--
-- PostgreSQL database dump
--

\restrict Yoh3s0XNSbXlwthBhaMRbRc7ZE8FUyd4Koxl4gt6vCNewjrLpcu7gDtUzJ1FEyg

-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.11

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
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_settings (id, company_name, minimum_loan_amount, maximum_loan_amount, tier_1_max_amount, tier_1_interest_rate, tier_2_interest_rate, maximum_loan_term_months, interest_cycle_days, currency, timezone, updated_at, updated_by, financial_year_end, company_logo_url, company_address, term_1_max_amount, term_1_months, term_2_max_amount, term_2_months, term_3_months, interest_cycle_enabled, interest_cycle_time, short_name, company_phone, company_whatsapp, company_email) FROM stdin;
e85e0f56-40eb-4629-80be-5a0838d9f57b	LMS	100	15000	2000	40	30	6	8	ZAR	Africa/Johannesburg	2026-09-17 21:51:17.815042+00	\N	2	\N	\N	5000.00	1	8000.00	3	6	t	00:01:00	LMS	\N	\N	\N
\.


--
-- PostgreSQL database dump complete
--

\unrestrict Yoh3s0XNSbXlwthBhaMRbRc7ZE8FUyd4Koxl4gt6vCNewjrLpcu7gDtUzJ1FEyg

