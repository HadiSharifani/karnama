# KARNAMA user guide

KARNAMA helps a single user record tasks and work sessions, compare tracked time with a work schedule, and review monthly patterns. Its interface is Persian and right-to-left; this guide uses the Persian menu names shown in the app.

## Navigation

- **داشبورد (Dashboard):** today's tracked time and target, current timer, and a compact view of the work day.
- **تسک‌ها (Tasks):** create and organize tasks, add links or images, and archive completed or inactive work.
- **زمان‌سنج (Timer):** run one global timer, pause/resume/stop it, or enter a session manually.
- **تقویم کاری (Work Calendar):** inspect a month, daily commitments, holidays, leave, and activity by calendar date and Work Date.
- **تحلیل عملکرد (Performance Analytics):** review time patterns, task durations, and monthly comparisons.
- **گزارش‌ها (Reports):** prepare a company or personal monthly report and export PDF or HTML.
- **تنظیمات (Settings):** update profile, work schedule, calendar, time zone, theme, and backups.

## Profile and preferences

The profile name and job title appear in company reports. The work schedule contains daily commitment, working weekdays, weekly holiday, and the default Work Date boundary. Calendar display can be Jalali or Gregorian; stored dates remain canonical Gregorian dates. Choose system, light, or dark theme. Set the IANA time zone, for example `Asia/Tehran`, so local times and Work Dates are attributed consistently.

## Tasks and time

Create tasks with a title, description, status, priority, optional estimate, and notes. The Board and List views show active tasks; archived tasks are available through the archive control. See [Task Management (Persian)](TASK_MANAGEMENT_FA.md).

In Timer, select a task or general activity and start the global timer. Pause, resume, or stop it as needed. The app saves timer segments and allows manual sessions with start/end date and time. If KARNAMA was closed unexpectedly, review the proposed recovery interval before accepting it; time while the app was closed is not counted automatically.

## Calendar and reports

Work Date groups work for commitments and reports; Calendar Date shows when an interval actually happened. Saved allocations are not silently changed when time-zone or boundary preferences change. See [Calendar and Time (Persian)](CALENDAR_AND_TIME_FA.md).

Reports and analytics describe recorded time, not a productivity score. Archived tasks remain in the database but their sessions are excluded from active report totals. Unarchiving makes the unchanged historical sessions reportable again. See [Reports and Analytics (Persian)](REPORTS_AND_ANALYTICS_FA.md).

## Backups, privacy, and uninstall

KARNAMA stores its SQLite database and managed images in the current Windows user's Electron data directory. Settings contains a backup panel and an **Open folder** action. See [Privacy and Security](PRIVACY_AND_SECURITY.md) and [Backup and Restore (Persian)](BACKUP_AND_RESTORE_FA.md).

Uninstalling removes the application files but intentionally preserves user data. Make and copy a backup before moving to another computer or Windows account. There is no automatic updater; install a later release over the current version after backing up.
