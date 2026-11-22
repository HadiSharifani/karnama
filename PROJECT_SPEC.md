# Karnama — Product Specification & Development Roadmap

## Project Identity

**Product Name:** کارنما (Karnama)

**English Name:** Karnama

**Subtitle:** Personal Work Tracker & Performance Journal

**Tagline:** کارهایت را ثبت کن، زمانت را بشناس، عملکردت را ببین.

## 1. Product Overview

Build a premium, Persian-first, local-first Windows desktop application for personal work tracking, task management, working-hours monitoring, and monthly performance reporting.

The application is designed for a remote Product Designer who needs to independently record assigned tasks, track actual working hours, monitor monthly working commitments, and generate professional reports for their employer.

The application must work completely offline without requiring an account, cloud service, backend server, or paid API.

## 2. User Profile Defaults

- Job title: Product Designer
- Work model: Flexible working hours
- Weekly holiday: Friday
- Working days: Saturday through Thursday
- Default daily commitment: 8 hours
- Time tracking: Live timer + manual entry
- Reports: Company report + personal analytics
- Calendar: Jalali by default, Gregorian optional
- User name: Configurable later

All defaults must be editable.

## 3. Language and Localization

Persian is the primary and default application language.

Requirements:

- Entire UI in Persian.
- Full RTL layout.
- Persian typography using Vazirmatn or another appropriate Persian font.
- Latin numerals for statistics, durations, and time.
- Jalali calendar as default.
- Gregorian calendar as an alternative.
- Correct mixed Persian/English rendering.
- Persian error messages and notifications.
- Persian PDF report templates.
- No unintended English text in the user interface.

## 4. Technology Stack

- Electron
- React
- TypeScript
- Vite
- Tailwind CSS
- shadcn/ui
- Lucide icons
- SQLite
- Drizzle ORM
- Recharts
- Jalali calendar conversion library
- Zod
- Vitest
- Playwright
- Electron Builder

Architecture requirements:

- Secure Electron architecture.
- contextIsolation enabled.
- nodeIntegration disabled.
- Filesystem and database access restricted to Electron main process.
- Typed and validated IPC interfaces.
- Database migrations.
- Modular and maintainable code.
- No direct renderer access to Node.js APIs.

## 5. Main Navigation

1. داشبورد
2. تسک‌ها
3. زمان‌سنج
4. تقویم کاری
5. تحلیل عملکرد
6. گزارش‌ها
7. تنظیمات

## 6. Task Management

Each task must support:

- Title
- Description
- Status
- Priority
- Creation date
- Completion date
- Optional estimated duration
- Actual tracked duration
- Notes
- Multiple Figma and external links
- Multiple local image attachments
- Attachment descriptions
- Multiple work sessions across different dates

Task statuses:

- Todo
- In Progress
- Waiting for Feedback
- On Hold
- Done

A task must remain a single entity regardless of how many days it takes to complete.

Task removal uses archive by default. Archived tasks keep their work sessions and can be restored; normal task views exclude archived items.

## 7. Time Tracking

Support two methods:

### Live Timer

- Start
- Pause
- Resume
- Stop
- Global persistent timer
- Task selection
- Recovery after application restart

### Manual Time Entry

- Select task or general activity.
- Select date.
- Enter start time.
- Enter end time.
- Automatically calculate duration.
- Edit or delete existing sessions.

### Work Date and Calendar Date

`Calendar Date` is the local calendar date on which an instant actually occurs. `Work Date` is the date used to group time for work summaries and reports.

- The default work-day boundary is 06:00 in the configured IANA timezone. Instants after midnight and before 06:00 belong to the previous Work Date; the boundary instant belongs to the new Work Date.
- Users can change the default boundary and configure a boundary exception for a specific Work Date.
- When a session crosses one or more Work Date boundaries, split its duration at those boundaries for Work Date totals. Keep the original session timestamps intact.
- A user can assign an entire session to a chosen Work Date. Store that attribution separately from the actual timestamps.
- Persist each session's Work Date allocation when it is saved. Changing timezone or boundary preferences must not silently reclassify saved sessions. Reclassifying past work requires an explicit user action and confirmation.
- Show the activity timeline by Calendar Date. Group work summaries, commitments, and reports by Work Date.

Rules:

- Only one active timer at a time.
- Starting a new timer closes a previously paused run and keeps its recorded segments; a running timer must be paused or stopped before another run starts.
- Prevent overlapping work sessions.
- Support sessions spanning midnight.
- Validate start/end timestamps.
- Persist timer state safely.
- Avoid double counting.
- Calculate all durations from actual timestamps.
- Support sessions without an associated task.
- On recovery after a crash, do not automatically count the interval while the application was closed. Present the suspected interval for review and confirmation.

## 8. Work Commitment System

Users can configure:

- Daily required hours.
- Working days.
- Weekly holidays.
- Public holidays.
- Full-day leave.
- Half-day leave.
- Custom leave durations.
- Leave spanning a date range.
- Date-specific working-hour exceptions.
- Monthly commitment overrides.
- Default Work Date boundary (06:00) and date-specific boundary exceptions.

Initial defaults:

- 8 hours per working day.
- Saturday through Thursday are working days.
- Friday is a weekly holiday.
- Flexible start and end times.

### Required Calculations

Monthly commitment:
Sum of scheduled working hours minus approved leave hours.

Actual working hours:
Sum of valid work-session allocations grouped by Work Date.

Daily balance:
Actual hours for a Work Date minus that Work Date's target.

Cumulative balance:
Actual hours grouped by Work Date up to date minus scheduled commitment up to that Work Date.

Monthly remaining:
Monthly commitment minus actual monthly hours.

Required average per remaining working day:
Monthly remaining divided by remaining scheduled working days.

Display all durations as HH:MM.

Keep these metrics separate:

- Daily balance
- Cumulative balance
- Monthly remaining commitment

### Important Rules

- An incomplete current day must not be treated as a finalized deficit.
- Daily balance updates live during the current Work Date and is not a finalized deficit until that Work Date ends at its next configured boundary.
- Approved leave reduces commitment.
- Holidays do not create artificial deficits.
- Work on holidays can count as actual work without changing other days' targets.
- Monthly schedules must be historically preserved.
- Store each month's commitment independently; changing defaults must not replace a stored month.
- Changing defaults must not silently rewrite historical commitments.
- Changes that would alter a past Work Date allocation or prior report require explicit confirmation.
- Monthly overrides must be possible.
- Monthly commitment is the authoritative flexible target. Surplus or deficit on one Work Date can offset another Work Date in the same month; keep daily balance visible separately from cumulative and monthly balance.
- If a month has no remaining working days, do not calculate a daily forecast.

## 9. Calendar

- Jalali monthly calendar.
- Gregorian alternative.
- Daily working-hour summary.
- Task activity.
- Work session details.
- Leave management.
- Holiday management.
- Custom working-day exceptions.
- Monthly navigation.
- Activity heatmap.

The activity timeline is organized by actual Calendar Date. Work Date is displayed separately where useful and is the grouping key for work reports.

Distinguish:

- Working day with activity.
- Working day without activity.
- Full-day leave.
- Partial-day leave.
- Weekly holiday.
- Public holiday.
- Custom non-working day.

## 10. Attachments

Support:

- Figma links.
- External links.
- Local image uploads.
- Multiple images per task.
- Attachment captions.

Store files locally and database metadata separately.

Do not depend on original source file locations after importing attachments.

## 11. Dashboard

Display:

### Daily Summary

- Today's tracked hours.
- Today's target.
- Daily balance.
- Active timer.
- Completed tasks.
- Current tasks.

### Monthly Summary

- Total commitment.
- Actual tracked hours.
- Remaining commitment.
- Cumulative balance.
- Working days.
- Leave days.
- Remaining working days.
- Required average daily hours.

### Visualizations

- Daily work-hour chart.
- Monthly activity heatmap.
- Work-hour distribution by time of day.
- Task duration distribution.
- Monthly trend.

## 12. Personal Analytics

Provide:

- Most active hours of the day.
- Work distribution by weekday.
- Average daily working hours.
- Monthly comparisons.
- Task duration statistics.
- Estimated vs actual duration.
- Untracked intervals during configured working days.
- Work pattern analysis.

Do not equate tracked time with productivity.

## 13. Monthly Reporting

Support two report types.

### Company Report

Include:

- Employee name.
- Job title.
- Reporting period.
- Total working hours.
- Monthly required hours.
- Remaining or excess hours.
- Number of working days.
- Leave days.
- Daily working-hour breakdown.
- Completed tasks.
- In-progress tasks.
- Duration per task.
- Figma links.
- External links.
- Task attachments and screenshots.

### Personal Report

Include:

- Monthly work patterns.
- Daily and weekly trends.
- Time distribution.
- Task statistics.
- Commitment balance.
- Monthly comparisons.
- Untracked intervals.

### Export Formats

- PDF
- HTML
- JSON backup
- ZIP backup including attachments

PDF requirements:

- Professional Persian RTL layout.
- Clickable external links.
- Embedded images.
- Consistent typography.
- Multi-page support.
- Page numbers.
- Appropriate image sizing.
- Correct Persian font embedding.

## 14. Database Entities

Design appropriate relational entities for:

- UserProfile
- Tasks
- WorkSessions
- WorkDateAllocations
- WorkSchedules
- WorkDateBoundaryOverrides
- MonthlyCommitments
- DailyOverrides
- LeaveRecords
- Holidays
- Attachments
- ExternalLinks
- AppPreferences
- ReportSnapshots

Use foreign keys, indexes, migrations, and appropriate constraints.

Store canonical timestamps in UTC with explicit timezone handling. Preserve the user's configured working timezone for local calendar interpretation.

Store a session's timezone and persisted Work Date allocation separately from actual UTC timestamps.

Use ISO Gregorian dates as canonical calendar dates. Jalali dates are presentation values.

## 15. Backup and Recovery

- Manual backup.
- Automatic periodic backup.
- Restore from backup.
- Include attachments.
- Validate backups before restoring.
- Protect against accidental data loss.
- Never overwrite existing data without explicit confirmation.

## 16. UI/UX Requirements

Visual direction:

- Premium minimal desktop design.
- Neutral light surface with Indigo accent; matching dark theme.
- System, light, and dark theme modes.
- Consistent spacing.
- Clear visual hierarchy.
- High-quality Persian typography.
- Avoid decorative details and unnecessary animations; respect reduced-motion preferences.
- Responsive desktop layouts.
- Keyboard shortcuts.
- Autosave.
- Useful empty states.
- Clear validation and error states.
- Undo for important reversible operations.

Avoid unnecessary complexity and excessive cards.

## 17. Development Principles

- Build incrementally.
- Keep every phase backward-compatible.
- Do not replace working functionality unnecessarily.
- Do not use mock data as real application behavior.
- Add tests for critical calculations.
- Use reusable components.
- Keep business logic separate from UI.
- Maintain a project changelog.
- Document important architectural decisions.
- Run type checks, tests, and builds after each phase.

---

# Codex Execution Plan

## Phase 0 — Planning and Architecture

Before writing application features:

1. Inspect the development environment.
2. Verify Node.js and npm.
3. Create the project structure.
4. Define the database schema.
5. Define IPC contracts.
6. Define the design system.
7. Identify technical risks.
8. Create `PROJECT_SPEC.md`.
9. Create `DEVELOPMENT_PLAN.md`.

Do not start implementing all features yet.

Deliver a documented architecture and a concrete implementation plan.

## Phase 1 — Application Foundation

Implement:

- Electron + React + TypeScript.
- Vite configuration.
- Secure preload architecture.
- SQLite database infrastructure.
- Migration system.
- Persian RTL application shell.
- Navigation.
- System/light/dark theme.
- Settings foundation.
- User profile.
- First-run dashboard guide with real empty state and no fabricated statistics.

The initial settings must include user name, job title (`Product Designer` default), daily commitment (8 hours), working weekdays (Saturday–Thursday), weekly holiday (Friday), default calendar (Jalali), theme, visible/editable IANA timezone, and Work Date boundary (06:00 default). Initialize the timezone from Windows when no user value exists. Save settings to SQLite and restore them on restart. Per-date boundary exceptions and full commitment behavior are future work.

On the first run, the dashboard guide must offer the four setup steps (complete profile, review working hours, create first task, start tracking time), show a primary action to open Settings, and expose all seven destinations in the Sidebar. Do not show mock metrics. After the user completes Settings, show the actual dashboard empty state until real task/session data exists.

Acceptance criteria:

- Application launches successfully.
- Persian layout renders correctly.
- Database survives application restart.
- Secure IPC is working.
- Settings survive application restart and follow the confirmed defaults above.
- The first-run guide and post-settings empty dashboard show no fabricated work data.
- Production build works.

## Phase 2 — Tasks and Time Tracking

Implement:

- Task CRUD.
- Task status management.
- Task detail panel.
- Live timer.
- Manual work sessions.
- Session editing and deletion.
- Session history.
- Global timer.
- Persistent active timer.
- Overlap validation.
- Work Date allocation for each saved session, with manual whole-session assignment and persisted boundary-based segments.

Acceptance criteria:

- Multi-day tasks work correctly.
- Timer survives application restart.
- Manual and automatic entries are accurate.
- Overlapping sessions are rejected.
- Task duration is calculated correctly.
- Calendar Date remains based on actual timestamps; work reports use persisted Work Date allocations.
- After a crash, unverified downtime is not automatically counted and is presented for user review.

## Phase 3 — Work Commitment and Calendar

Implement:

- Weekly schedule configuration.
- Daily commitment.
- Monthly commitment.
- Monthly overrides.
- Friday holiday default.
- Jalali and Gregorian calendar.
- Leave management.
- Public holidays.
- Custom date exceptions.
- Default and date-specific Work Date boundaries.
- Daily and cumulative balance.
- Monthly remaining hours.
- Remaining-day forecast.

Acceptance criteria:

- All calculations have automated tests.
- Full-day and half-day leave work correctly.
- Holidays do not create artificial deficits.
- Historical monthly commitments remain unchanged.
- Flexible working hours are supported.
- Current Work Date balance is live and cannot appear as a final deficit until its configured boundary passes.
- Editing past allocations/commitments does not change earlier reports without confirmation.

## Phase 4 — Attachments

Implement:

- Figma links.
- External links.
- Local image import.
- Image previews.
- Attachment descriptions.
- Task attachment management.
- File validation.
- Safe local file storage.

Acceptance criteria:

- Attachments remain available after restarting the application.
- Deleting a task does not leave unmanaged files.
- File paths are not exposed unsafely to the renderer.

## Phase 5 — Dashboard and Reports

Implement:

- Daily dashboard.
- Monthly dashboard.
- Work-hour charts.
- Calendar heatmap.
- Personal analytics.
- Company report.
- Personal report.
- PDF generation.
- HTML report.
- Clickable links.
- Embedded task images.

Acceptance criteria:

- Reports use actual database data.
- Report calculations match dashboard calculations.
- PDF layout is readable in Persian.
- Images and links belong to the correct tasks.
- Reports support multiple pages.

## Phase 6 — Quality and Release

Implement:

- Automatic backups.
- Restore.
- Data integrity checks.
- Timer recovery tests.
- Calendar edge-case tests.
- PDF export tests.
- Error handling.
- Performance optimization.
- Windows installer.
- Release documentation.

Acceptance criteria:

- All critical tests pass.
- No data loss during normal usage.
- Backup and restore work.
- Installer works on Windows.
- Application works offline.

---

# Codex Working Instructions

Treat this document as the source of truth for product requirements.

Work only on the phase explicitly requested by the user.

Before implementing a phase:

1. Inspect existing code.
2. Identify affected files.
3. Identify dependencies.
4. Explain implementation risks.
5. Propose a small implementation plan.

After implementation:

1. Run relevant tests.
2. Run TypeScript checks.
3. Run production build.
4. Report changed files.
5. Report known limitations.
6. Do not claim completion if acceptance criteria are not met.

Do not silently change architectural decisions or product requirements.

When a requirement is ambiguous, identify it before making a potentially destructive decision.

Never sacrifice data integrity for visual convenience.

The primary success criteria are accurate work-hour tracking, reliable monthly commitment calculations, excellent Persian UX, and professional report generation.
