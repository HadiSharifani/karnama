# KARNAMA v0.1.0 — First public release

KARNAMA v0.1.0 is the first public Windows x64 release of the Persian-first, local work journal.

## What's included

- Task Board and List views, statuses, priorities, search, saved ordering, archive/restore, task links, and local image attachments.
- A persistent global timer, manual work sessions, crash recovery review, and Calendar Date / Work Date attribution.
- Jalali and Gregorian calendar display, configurable schedule, holidays, leave, and monthly commitment overrides.
- Dashboard, monthly reports, personal analytics, and PDF/HTML exports.
- Manual and scheduled ZIP backups, validation, safety backup before restore, and recovery after interrupted restore.
- Archived-task sessions are excluded from active reports; restoring the task makes unchanged history reportable again.

## Download

Download `Karnama-0.1.0-win-x64.exe` from the [KARNAMA Releases page](https://github.com/HadiSharifani/karnama/releases/latest). Verify the file against the attached `SHA256SUMS.txt` before running it. The installer is unsigned; Windows may show an unknown-publisher or SmartScreen warning.

Installer SHA-256: `2B9850032BA39D30C1BB475B55F65299C699EC3DB3D64B54564738754E196EF8`

## Compatibility and limitations

- Windows x64 only. **Windows 32-bit is not supported in v0.1.0.** macOS, Linux, and ARM64 are not release targets.
- The installer is unsigned and has no timestamp; the checksum does not authenticate the publisher.
- There is no automatic updater or cloud synchronization.
- Core tracking works offline. External task links open in the system browser.
- Backup ZIPs are not encrypted by KARNAMA. Protect copies that contain personal work data.
- The app measures recorded work time. It cannot infer untracked work intervals or turn tracked duration into a productivity score.

## Verification

The release installer was built from the v0.1.0 project configuration, installed into a clean isolated path, launched, exercised with backup/restore and offline scenarios, and uninstalled. The install folder was removed while the isolated user-data profile remained unchanged. The installed-app E2E run had 7 passing tests and 1 skipped upgrade test because no previous public version existed.

See the [Getting Started guide](GETTING_STARTED_EN.md), [System Requirements](SYSTEM_REQUIREMENTS.md), and the Persian [Backup and Restore guide](BACKUP_AND_RESTORE_FA.md).

---

# یادداشت انتشار فارسی

کارنما ۰٫۱٫۰ نخستین نسخهٔ عمومی برنامهٔ فارسی و محلی برای Windows x64 است.

## امکانات این نسخه

- برد و فهرست تسک، وضعیت، اولویت، جست‌وجو و ترتیب ذخیره‌شده، بایگانی/بازیابی، لینک و تصویر محلی.
- تایمر سراسری، جلسهٔ دستی، بررسی بازهٔ بازیابی پس از crash و تخصیص Calendar Date / Work Date.
- نمایش تقویم شمسی یا میلادی، برنامهٔ کاری، تعطیلی، مرخصی و تعهد اختصاصی ماه.
- داشبورد، گزارش ماهانه، تحلیل شخصی و خروجی PDF/HTML.
- ZIP پشتیبان دستی و زمان‌بندی‌شده، اعتبارسنجی، نسخهٔ ایمنی پیش از restore و بازیابی تراکنش ناقص.
- زمان تسک بایگانی‌شده از گزارش‌های فعال کنار می‌رود؛ با بازیابی تسک، سابقهٔ بدون تغییر دوباره گزارش‌پذیر می‌شود.

## دریافت و نصب

فایل `Karnama-0.1.0-win-x64.exe` را از [صفحهٔ انتشار KARNAMA](https://github.com/HadiSharifani/karnama/releases/latest) بگیرید و پیش از اجرا checksum آن را با `SHA256SUMS.txt` تطبیق دهید. نصب‌کننده امضای دیجیتال ندارد و Windows ممکن است هشدار ناشر ناشناس/SmartScreen نشان دهد.

SHA-256 نصب‌کننده: `2B9850032BA39D30C1BB475B55F65299C699EC3DB3D64B54564738754E196EF8`

## سازگاری و محدودیت‌ها

- فقط Windows x64؛ **Windows 32-bit در نسخهٔ ۰٫۱٫۰ پشتیبانی نمی‌شود.** macOS، Linux و ARM64 هدف انتشار نیستند.
- امضا و timestamp کد وجود ندارد؛ checksum هویت ناشر را اثبات نمی‌کند.
- به‌روزرسان خودکار و همگام‌سازی ابری وجود ندارد.
- قابلیت‌های اصلی آفلاین‌اند؛ لینک خارجی در مرورگر سیستم باز می‌شود.
- ZIP پشتیبان در خود کارنما رمزگذاری نمی‌شود.
- برنامه زمان ثبت‌شده را گزارش می‌کند، نه فعالیت ثبت‌نشده یا امتیاز بهره‌وری را.

نصب‌کننده روی مسیر نصب ایزوله اجرا و آزمون شد؛ برنامه اجرا، backup/restore و کار آفلاین بررسی و سپس uninstall شد. پوشهٔ نصب حذف شد و profile دادهٔ کاربر بدون تغییر ماند. E2E نصب‌شده ۷ موفق و یک تست ارتقا ردشده داشت؛ نسخهٔ عمومی قبلی برای ارتقا وجود نداشت.
