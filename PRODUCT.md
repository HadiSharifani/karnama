# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Electron desktop application for Windows with React, TypeScript, and Vite. This stack is specified in the project brief.

## Users

A remote Product Designer working flexible hours who needs to record assigned tasks, track actual work time, compare work with monthly commitments, and prepare reports for an employer. The first release is a personal, single-user application.

## Product Purpose

Karnama is a Persian-first personal work tracker and performance journal. It helps the user record work, understand time allocation, and report their work pattern. Success means accurate work-hour records, reliable commitment calculations, and usable Persian reports.

## Positioning

Karnama works locally and offline, with no account, cloud service, backend, or paid API. It connects task sessions and work commitments to reports while keeping tracked time distinct from productivity.

## Operating Context

The user works on Windows with a flexible schedule and may have no network access. The weekly default is Saturday through Thursday with Friday off; the initial daily commitment is eight hours. The user switches between task entry, time tracking, a work calendar, analytics, reports, and settings.

## Capabilities and Constraints

- The primary interface language is Persian with full RTL layout and Latin numerals for times, durations, and statistics.
- Jalali is the default display calendar; Gregorian is optional. Stored daily dates are canonical ISO Gregorian dates.
- Actual timestamps are stored in UTC and interpreted with an explicit IANA timezone.
- Calendar Date means when an activity actually occurred. Work Date controls reporting. Work Date defaults to a 06:00 local boundary, can vary for a specific date, and can be manually assigned to a whole session without changing its actual timestamps.
- Work Date allocations and monthly commitments are persisted so settings changes do not silently reclassify past work or replace stored monthly commitments. Changes to past records or reports require confirmation.
- After a crash, time while the application was closed is not automatically counted; the suspected interval requires user review.
- Work on a holiday counts as actual time and does not automatically reduce other days' targets. Full-day, half-day, custom-duration, and date-range leave are supported.
- The application must work offline and keep database and filesystem access in Electron main. Renderer code has no direct Node.js, database, or filesystem access.
- The monthly override's effect on daily targets is not yet specified and remains a decision for the commitment phase.

## Brand Commitments

- Product name: کارنما (Karnama).
- Tagline: «کارهایت را ثبت کن، زمانت را بشناس، عملکردت را ببین.»
- UI copy and system messages are Persian; avoid unintended English UI text.

## Evidence on Hand

`PROJECT_SPEC.md` is the source of truth for product requirements. No real user work records, customer claims, testimonials, or report data are available yet. Initial screens must not present invented statistics as real data.

## Product Principles

1. Preserve the user's work data and its history.
2. Count elapsed time from real timestamps and show how it is attributed.
3. Work offline and keep the user's data local.
4. Make Persian and RTL the default experience.
5. Treat tracked time as a record, not a measure of productivity.

## Accessibility & Inclusion

- The full interface is RTL and keyboard-accessible.
- Use clear focus states, readable contrast, Persian validation and error text, and Latin digits for time and statistics.
- Respect system reduced-motion preferences.
