# System requirements | نیازمندی‌های سیستم

## Windows runtime

- **Architecture:** 64-bit x86 Windows (x64). The installer and native SQLite dependency are packaged for x64.
- **32-bit Windows:** Not supported in v0.1.0. KARNAMA uses Electron `45.4.1`; no ia32 installer is provided.
- **Verified acceptance environment:** Windows 11 Pro x64, version 26H2, build `26300.9818` ([Microsoft release information](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)).
- **Windows 10:** No separate Windows 10 acceptance run is documented for v0.1.0.
- **Internet:** Not required for core app features after installation. Opening external links can use the network through the default browser.
- **Administrator rights:** Not required; the NSIS installer is configured per-user.
- **Disk:** The verified installer is `134,859,300` bytes. Installed size and a minimum free-space/RAM requirement have not been formally benchmarked; user data and backups require additional space.
- **Runtime:** End users do not need to install Node.js separately. The app includes its Electron runtime and native SQLite module.

macOS, Linux, Windows ARM64, and Windows 32-bit are not release targets for v0.1.0.

## Development

- Windows x64 development environment used for acceptance.
- Node.js `24.13.0` or later and npm, per `package.json`.
- Git and network access for `npm ci` and retrieving locked dependencies.
- The project uses Electron `45.4.1`, electron-builder `26.18.0`, TypeScript, React, Vite, and `better-sqlite3`.

Run `npm ci`, then `npm run dev`. Quality commands are listed in the root [README](../README.md).

---

## فارسی

- **معماری:** Windows x64؛ installer و وابستگی native SQLite برای این معماری ساخته شده‌اند.
- **Windows 32-bit:** در نسخهٔ ۰٫۱٫۰ پشتیبانی نمی‌شود. برنامه Electron نسخهٔ `45.4.1` دارد و installer ia32 ارائه نشده است.
- **محیط آزموده‌شده:** Windows 11 Pro x64، نسخهٔ 26H2، build `26300.9818` ([اطلاعات انتشار Microsoft](https://learn.microsoft.com/en-us/windows/release-health/windows11-release-information)).
- **Windows 10:** آزمون پذیرش جداگانه برای Windows 10 در اسناد نسخهٔ ۰٫۱٫۰ ثبت نشده است.
- **اینترنت:** پس از نصب برای قابلیت‌های اصلی لازم نیست؛ بازکردن لینک خارجی از مرورگر پیش‌فرض ممکن است به شبکه نیاز داشته باشد.
- **دسترسی Administrator:** لازم نیست؛ نصب‌کننده برای کاربر فعلی Windows است.
- **فضای ذخیره‌سازی:** فایل installer تأییدشده `134,859,300` بایت است. حجم نصب‌شده و حداقل RAM/فضای خالی به‌صورت رسمی benchmark نشده‌اند؛ داده و backup فضای اضافه می‌خواهند.
- **Runtime:** کاربر نهایی لازم نیست Node.js جداگانه نصب کند؛ Electron و SQLite native همراه برنامه بسته‌بندی شده‌اند.

macOS، Linux، Windows ARM64 و Windows 32-bit هدف انتشار نسخهٔ ۰٫۱٫۰ نیستند.

برای توسعه، Windows x64، Node.js `24.13.0` یا جدیدتر و npm لازم است. `npm ci` وابستگی‌ها را نصب می‌کند؛ سپس `npm run dev` را اجرا کنید.
