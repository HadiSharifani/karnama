# Frequently asked questions

### Does KARNAMA need internet access?

No for task, timer, calendar, analytics, and backup features. Opening an external task link uses the Windows default browser and may require internet access.

### Is 32-bit Windows supported?

No. v0.1.0 ships a Windows x64 installer only. Windows 32-bit is not supported in v0.1.0.

### Does KARNAMA count time while it is closed?

No. After an unexpected shutdown, the app asks you to review a possible recovery interval. It is recorded only if you accept it.

### What is the difference between Calendar Date and Work Date?

Calendar Date is when the activity actually happened. Work Date is the day used for work summaries and reports. See [Calendar and Time (Persian)](CALENDAR_AND_TIME_FA.md).

### Does archiving delete a task's sessions?

No. The task and its history remain. Archived-task time is excluded from active reports and becomes reportable again after the task is restored.

### Are backup ZIPs encrypted?

No. They contain integrity hashes but KARNAMA does not encrypt them. Store them securely or encrypt them with a tool you trust before transferring them.

### Does uninstall remove my data?

No. Uninstall removes application files and preserves user data and backups. Make an independent backup before manually deleting profile data.

### Why does Windows warn that the publisher is unknown?

The v0.1.0 installer is unsigned. Download it from the official Releases page and compare its SHA-256 with the published manifest.
