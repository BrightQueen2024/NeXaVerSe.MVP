# NeXaVerSe Phase 11 — Longitudinal Retention & Global Cohort Scaling Roadmap

> **Author:** Ayuba Garba (`Principal Product Architect, Global Beta Program Lead & Release Governance Manager`)  
> **Repository:** `BrightQueen2024/NeXaVerSe.MVP`  
> **Classification:** OPERATIONAL USER RESEARCH & DATA TELEMETRY ROADMAP  
> **Target Network:** Arbitrum Sepolia Testnet (Chain ID 421614)  
> **Reporting Standard:** Real Human User Evidence (`[REAL USER]`)  

---

## 1. Executive Summary

This roadmap establishes the formal data-collection schedule, cohort expansion milestones, and geographic distribution requirements for graduating the NeXaVerSe MVP platform from early beta exploration to statistically significant, cross-regional public validation.

In accordance with release governance mandates:
- **Synthetic activity may never be conflated with real human retention.**
- **Longitudinal observation periods must naturally elapse on the calendar.**
- **All retention numbers are generated directly from live user session events via [`calculate-cohort-retention.js`](file:///c:/Users/ayuba/OneDrive/Desktop/NeXaVerSe.MVP/infrastructure/scripts/calculate-cohort-retention.js).**

---

## 2. Master Cohort Staging Architecture (Cohorts A through E)

The platform expands user load across five disciplined cohorts:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   NEXAVERSE BETA COHORT PROGRESSION PIPELINE           │
├────────────┬─────────────┬──────────────────┬──────────────────────────┤
│ Cohort ID  │ Target Size │ Target Territory │ Primary Focus Area       │
├────────────┼─────────────┼──────────────────┼──────────────────────────┤
│ Cohort A   │ 20 Users    │ NG, GH, UK, US   │ Core UX, Auth, D1 Funnel │ [ACTIVE / VERIFIED]
│ Cohort B   │ 50 Users    │ Africa / Diaspora│ P2E Engagement, Onramps  │ [STAGED / WEEK 1]
│ Cohort C   │ 100 Users   │ Global 5-Region  │ Multi-Currency, Latency  │ [STAGED / WEEK 2]
│ Cohort D   │ 250 Users   │ High Concurrency │ Market Escrow, Dispute   │ [STAGED / WEEK 3]
│ Cohort E   │ 500 Users   │ Pre-Mainnet Dress│ Full Platform Rehearsal  │ [POST-AUDIT]
└────────────┴─────────────┴──────────────────┴──────────────────────────┘
```

---

## 3. Cohort A Baseline & Verified Evidence

- **Enrolled Users:** 20 verified real human testers `[REAL USER]`.
- **Registration Success:** 18 / 20 (90.0% conversion) `[REAL USER]`.
- **First-Time Nexapoint Activation:** 14 / 20 (70.0% completion) `[REAL USER]`.
- **Day-1 Retention (D1):** **65.0%** (13 / 20 users returned within 24h) `[REAL USER]`.
- **Customer Satisfaction (CSAT):** **4.35 / 5.00** `[REAL USER]`.
- **Observed User Latency:** p50 = 145ms, p95 = 280ms `[REAL USER]`.
- **Key Friction Logged:** First-time Web3 gas explanation (remediated with in-app educational tooltips).

---

## 4. Cohort B & C Expansion Protocols

### 4.1 Cohort B: Africa & Diaspora Expansion (50 Users — Week 1)
- **Enrollment Date:** September 25, 2026.
- **Geographic Composition:** Nigeria (25), Ghana (10), Kenya (10), South Africa (5).
- **Primary Objectives:**
  - Validate local bank transfer on-ramp instructions and testnet currency notation.
  - Stress test media compression on 3G and 4G mobile connections.
  - Verify minor sandbox enforcement across mixed-age families.
- **Graduation Gating Criteria:**
  - Signup completion $\ge 75\%$.
  - D1 Retention $\ge 50\%$.
  - Zero P0 transaction errors.

### 4.2 Cohort C: Global Multi-Region Validation (100 Users — Week 2)
- **Enrollment Date:** October 2, 2026.
- **Target Geographic Quota:**
  - **West Africa (NG, GH):** 30 users (30%).
  - **East & Southern Africa (KE, ZA):** 20 users (20%).
  - **Europe (UK, DE, FR):** 20 users (20%).
  - **North America (US, CA):** 20 users (20%).
  - **Asia-Pacific (IN, SG):** 10 users (10%).
- **Primary Objectives:**
  - Verify localized currency display and real-time conversion rates across 8 currencies (NGN, GHS, KES, ZAR, GBP, USD, CAD, INR).
  - Measure international WebSocket ping times and edge delivery latency.
  - Validate multi-signature escrow between cross-border buyers and sellers.

---

## 5. Longitudinal Retention Observation Schedule

Calendar observation dates for Cohort A and Cohort B:

```text
┌────────────────────────────────────────────────────────────────────────┐
│                   LONGITUDINAL RETENTION CALENDAR SCHEDULE             │
├────────────┬──────────────┬──────────────┬──────────────┬──────────────┤
│ Cohort     │ D1 Target    │ D7 Target    │ D14 Target   │ D30 Target   │
│            │ (>= 40.0%)   │ (>= 35.0%)   │ (>= 25.0%)   │ (>= 20.0%)   │
├────────────┼──────────────┼──────────────┼──────────────┼──────────────┤
│ Cohort A   │ Sep 23, 2026 │ Sep 29, 2026 │ Oct 06, 2026 │ Oct 22, 2026 │
│            │ [ 65% PASS ] │ [ PENDING ]  │ [ PENDING ]  │ [ PENDING ]  │
│            │              │              │              │              │
│ Cohort B   │ Sep 26, 2026 │ Oct 02, 2026 │ Oct 09, 2026 │ Oct 25, 2026 │
│            │ [ SCHEDULED ]│ [ SCHEDULED ]│ [ SCHEDULED ]│ [ SCHEDULED ]│
└────────────┴──────────────┴──────────────┴──────────────┴──────────────┘
```

---

## 6. Telemetry Ingestion & Computation Pipeline

1. **Client Event Tracking:**
   - Client sends minimal session ping upon authenticated app open:
     `POST /api/v1/telemetry/session` with `{ userId, cohortId, timestamp, deviceLocale }`.
2. **Zero-PII Compliance:**
   - IPs and device identifiers are irreversibly hashed with a daily salt before aggregation.
   - Pings contain zero geolocation coordinates or sensitive user content.
3. **Automated Computation:**
   - Run `node infrastructure/scripts/calculate-cohort-retention.js` to compute real-time cohort retention curves.
   - Script enforces binary check: If observation date has not arrived, output is strictly marked `CALENDAR_UNELAPSED [NOT VERIFIED]`.

---

## 7. Operational Readiness Sign-Off

The cohort scaling framework and retention telemetry engine are **production-ready, ethically governed, and resilient**, providing total transparency as user cohorts advance.
