# Getting started with KARNAMA

KARNAMA is a Persian-first, offline-capable Windows work journal. It stores tasks, work sessions, attachments, settings, and backups on this Windows account. The first public version supports Windows x64 only.

## Install

1. Open the [KARNAMA releases page](https://github.com/HadiSharifani/karnama/releases/latest) and download `Karnama-0.1.0-win-x64.exe`.
2. Compare the installer SHA-256 with `SHA256SUMS.txt` attached to the release. In PowerShell:

   ```powershell
   Get-FileHash .\Karnama-0.1.0-win-x64.exe -Algorithm SHA256
   ```

3. Run the installer. It installs for the current Windows user and does not require administrator access.
4. The installer is unsigned. Windows may show an unknown-publisher or SmartScreen warning. Check that the file came from the official release and that its hash matches; do not disable Windows security settings to install it.

## First launch

Complete the setup in Settings. Enter the display name and job title used on company reports, choose a daily work target, working weekdays and weekly holiday, then choose the calendar, theme, and time zone. The default Work Date boundary is 06:00 in the selected time zone. These preferences can be changed later.

The main navigation contains Dashboard, Tasks, Timer, Work Calendar, Performance Analytics, Reports, and Settings. Start by creating a task, then use Timer to record work or enter a completed session manually. General activity can also be timed without a task.

## Keep a backup

Open Settings → Backup and Restore and choose **Create manual backup**. Copy the ZIP outside this device or Windows profile. KARNAMA also makes an automatic backup about once per 24 hours while the app is running. It does not automatically remove old backups.

## Important limits

- Windows 32-bit, ARM64, macOS, and Linux are not supported in v0.1.0.
- The installer is not code-signed and KARNAMA has no automatic updater.
- Core tracking works offline. Opening a task link uses the default browser and may need internet access.

## Guides

- [User guide](USER_GUIDE_EN.md)
- [System requirements](SYSTEM_REQUIREMENTS.md)
- [Privacy and security](PRIVACY_AND_SECURITY.md)
- [Backup and restore (Persian)](BACKUP_AND_RESTORE_FA.md)
- [Troubleshooting (Persian)](TROUBLESHOOTING_FA.md)
