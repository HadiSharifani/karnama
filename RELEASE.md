# راهنمای بسته‌بندی و انتشار کارنما

## وضعیت بسته‌بندی انتشار v0.1.0 — 2026-11-27

بسته‌بندی تازه و پذیرش محلی نصب/حذف روی Windows تکمیل شد. **هیچ push، tag یا GitHub Release انجام نشده است**؛ انتشار عمومی همچنان نیازمند تأیید جداگانهٔ کاربر است. Installer تاریخی Phase 6 برای این بسته استفاده نشد.

- ساخت با تنظیمات فعلی `electron-builder.yml` و خروجی مجزای `dist/v0.1.0-final/` انجام شد: `npm run package:win -- --config.directories.output=dist/v0.1.0-final`. `electron-builder` نسخهٔ `26.18.0` و Electron نسخهٔ `45.4.1` هستند؛ دریافت ابزار NSIS رسمی موردنیاز Electron Builder از GitHub موفق بود.
- نسخهٔ `package.json` برابر `0.1.0` و مجوز MIT است. executable برنامه x64 (`PE 0x8664`)، نام محصول `کارنما`، نسخهٔ محصول `0.1.0.0` و icon تعبیه‌شده دارد. امضای Authenticode ندارد.
- Installer تازه: `Karnama-0.1.0-win-x64.exe`، `134859300` بایت، SHA-256 برابر `2B9850032BA39D30C1BB475B55F65299C699EC3DB3D64B54564738754E196EF8`.
- Blockmap: `Karnama-0.1.0-win-x64.exe.blockmap`، `141862` بایت، SHA-256 برابر `0087DE12CD9F16A7524CAB742475C69D36E7621BF36C859ABE60494D465CEA62`. فایل `SHA256SUMS.txt` در همان پوشه هر دو hash را ثبت می‌کند و با محاسبهٔ مجدد تطبیق داده شد.
- نصب تمیز در مسیر ایزوله روی Windows 10 Pro x64 (build `26300.9818`) با exit code `0` انجام شد؛ executable نصب‌شده اجرا شد و سناریوهای smoke، آفلاین، گزارش‌ها، backup/restore، تنظیمات و قابلیت‌های Phase 7 را گذراندند. E2E نهایی: `7 passed, 1 skipped`. تست upgrade به‌دلیل نبود نسخهٔ عمومی قبلی برای ارتقا skip شد؛ artifact تاریخی Phase 6 جایگزین نسخهٔ قبلی نشد.
- `npm test`: ۸۱ تست در ۱۲ فایل موفق؛ `npm run typecheck`، `npm run lint`، `npm run format:check` و `npm run build:app` نیز موفق شدند.
- Uninstaller برنامه با exit code `0` اجرا شد. پوشهٔ نصب حذف شد و هر `71` فایل profile ایزوله پس از حذف باقی ماند؛ hash همهٔ فایل‌ها با وضعیت پیش از uninstall یکسان بود.
- Installer و executable unsigned هستند؛ certificate یا timestamp پیکربندی نشده است. این محدودیت را پیش از توزیع عمومی باید در نظر گرفت.
- تغییر معماری یا قابلیت برنامه انجام نشد و migration پایگاه‌داده لازم نبود. فایل‌های ساخت و profileهای آزمون داخل `dist/` و خارج از نسخهٔ کنترل‌شده‌اند.

Artifactهای نامزد فعلی فقط پس از بازبینی نهایی و تأیید انتشار باید در GitHub Release قرار گیرند. Hashهای Phase 6 در بخش تاریخی پایین صرفاً سابقه‌اند و با hashهای این بسته جایگزین نمی‌شوند.

## ساخت Windows installer

پیش‌نیازها Node.js و وابستگی‌های قفل‌شدهٔ npm در `package-lock.json` هستند. از پوشهٔ پروژه در PowerShell معمولی Windows اجرا کنید:

```powershell
npm ci
npm run package:win
```

خروجی پیش‌فرض NSIS x64 طبق `electron-builder.yml` در `dist-phase6/` قرار می‌گیرد؛ برای بستهٔ v0.1.0، خروجی به `dist/v0.1.0-final/` هدایت شد تا با buildهای پیشین تداخل نکند. نام artifact از الگوی `Karnama-<version>-win-x64.exe` استفاده می‌کند. config نصب per-user است، UAC elevation درخواست نمی‌کند و shortcutهای Desktop/Start Menu می‌سازد. پوشهٔ خروجی را پیش از ساخت پاک نکنید؛ هر release باید با نتیجهٔ واقعی Electron Builder بررسی شود.

## داده‌های کاربر و نسخهٔ پشتیبان

پوشهٔ نصب شامل دادهٔ زنده نیست. SQLite و فایل‌های پیوست زیر `app.getPath('userData')` هستند و ZIPهای پشتیبان در زیرپوشهٔ `backups` نگه‌داری می‌شوند. نام/مسیر دقیق `userData` را همان نسخهٔ نصب‌شده از Electron بگیرید؛ از روی نام فایل installer حدس نزنید. حذف برنامه نباید این پوشه را پاک کند.

برای ساخت نسخهٔ قابل‌انتقال، Settings → «پشتیبان‌گیری و بازیابی» → «ساخت نسخهٔ دستی» را بزنید. ZIP را از «پوشه» پیدا و روی رسانه‌ای مستقل کپی کنید. برنامه ۳۰ ثانیه پس از شروع موعد را بررسی می‌کند؛ اگر باز بماند، پس از ۲۴ ساعت از آخرین موفقیت نسخهٔ بعدی را می‌سازد. در صورت خطا/تداخل یک ساعت بعد retry می‌کند و در شروع بعدی نیز due بودن را می‌سنجد. برنامه نسخه‌های قدیمی را خودکار حذف نمی‌کند.

برای واردکردن ZIP، «بازیابی از فایل…» را انتخاب کنید. برنامه ابتدا archive، checksumها، سلامت SQLite، schema/migrations و پیوست‌ها را بررسی می‌کند؛ سپس جزئیات را برای تأیید نمایش می‌دهد. قبل از جایگزینی یک `pre_restore` از دادهٔ فعلی می‌سازد و پس از restore راه‌اندازی مجدد می‌شود. اگر برق یا فرایند در میانهٔ تعویض قطع شود، startup recovery از marker تراکنش برای بازگرداندن دادهٔ قبلی یا پاک‌سازی تراکنش کامل استفاده می‌کند.

## چک‌لیست پذیرش Phase 6 (سابقه)

- [x] `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test` و `npm run test:e2e`.
- [x] `npm run build:app` و `npm run package:win`؛ artifact نهایی نصب و اجرا شد.
- [x] نصب تمیز per-user، اولین اجرا و اجرای آفلاین برنامهٔ نصب‌شده.
- [x] Settings، چند تسک، sessionها، Work Date دستی، لینک‌ها، چند تصویر، شرح تصویر و backup در profile ایزوله.
- [x] restore واقعی از UI نصب‌شده، پس از تأیید و راه‌اندازی مجدد؛ داده و hash پیوست‌ها با manifest تطبیق داشتند.
- [x] cancel کردن restore؛ دادهٔ تغییریافته پس از cancel بدون تغییر ماند. recovery تراکنش ناقص نیز در تست‌های سرویس پوشش دارد.
- [x] نصب نسخهٔ ساخته‌شده از commit baseline و جایگزینی آن با installer فعلی؛ migration و حفظ داده بررسی شد. این build نسخهٔ منتشرشدهٔ قبلی نیست.
- [ ] Code signing و timestamping؛ برای توزیع عمومی هنوز باید جداگانه پیکربندی و بررسی شوند.

## سوابق پذیرش Phase 6 (تاریخی)

**بررسی نهایی 2026-11-24**

- Windows 10 Pro x64 (build `26300.9818`)، Node.js `v24.13.0`، Electron `45.4.1`، Electron Builder `26.18.0`.
- Typecheck، lint، format، build و ۶۹ تست واحد در ۱۰ فایل موفق شدند. Full E2E: چهار موفق و سه تست نصب‌شدهٔ env-gated؛ هر سه نیز جداگانه روی artifact نهایی موفق شدند: restore UI، smoke آفلاین، و baseline upgrade.
- NSIS x64 نصب‌شده در پوشهٔ ایزوله اجرا شد. در حالت offline، onboarding و ساخت/اعتبارسنجی backup موفق شدند و Renderer هیچ درخواست HTTP(S) نفرستاد.
- Restore از UI نصب‌شده با دو تسک، دو session با Work Date دستی، دو لینک، دو تصویر و شرح‌ها انجام شد. cancel دادهٔ تغییریافته را حفظ کرد؛ restore تأییدشده دادهٔ اولیه را پس از relaunch بازگرداند. SQLite `integrity_check` برابر `ok` و `foreign_key_check` خالی بود؛ اندازه و SHA-256 دو فایل با manifest backup مطابق بود. Safety backup پیش از restore ساخته و اعتبارسنجی شد؛ هیچ restore ناموفقی در UI رخ نداد. تست واحد recovery تراکنش ناقص را پوشش می‌دهد.
- Restore نصب‌شده یک پوشهٔ staging پس از relaunch باقی می‌گذاشت. پاک‌سازی پیش از relaunch و شناسایی نام staging در startup اصلاح شد و برای هر دو مسیر تست رگرسیون اضافه شد.
- فایل installer قبلی یا tag نسخهٔ منتشرشده موجود نبود. baseline pre-Phase-4 از `git archive 848be7f` در پوشهٔ مستقل build شد؛ هر دو build version `0.1.0` دارند. آزمون، جایگزینی/migration از source snapshot است و ادعای upgrade از release عمومی قدیمی نیست. دادهٔ دو تسک، دو session و تنظیمات از migrationهای ۴ به ۶ باقی ماند و پس از restart و uninstall نیز پایگاه داده حفظ شد. baseline پیش از Phase 4 بود و لینک/attachment نداشت.
- Installer نهایی: `dist-phase6/Karnama-0.1.0-win-x64.exe`، ۱۳۴٬۸۵۱٬۶۳۴ بایت، SHA-256: `C695C0098B9388736D3AA45B37469FC65FAE5F23F3400380D2794D2A4111258C`. Hash قبلی با artifact پیش از اصلاح staging تطبیق داشت؛ این artifact پس از اصلاح rebuild شد.
- PE برنامه `0x8664` (x64)، ProductVersion `0.1.0.0` و ProductName `کارنما` است. آیکون از executable استخراج و بررسی شد؛ `app.asar` و migrationهای `0000` تا `0005` همراه برنامه بودند. مسیر دادهٔ تستی خارج از install قرار داشت. uninstall برنامه را حذف کرد و ۷۱ فایل userData را بدون تغییر hash باقی گذاشت.
- `Get-AuthenticodeSignature` وضعیت `NotSigned` و بدون signer نشان داد؛ signing certificate پیکربندی نشده است. فایل unsigned نام ناشر تأییدشده ندارد و Windows SmartScreen یا policyهای سازمانی ممکن است هشدار دهند یا اجرا را محدود کنند. SHA-256 هویت ناشر را اثبات نمی‌کند. برای انتشار عمومی certificate امن در CI، امضای executable/installer/uninstaller، timestamp قابل‌اعتماد و بررسی SignTool لازم است؛ گواهی خریداری یا تنظیم نشد.
- **قبولی رسمی Phase 6:** معیارهای `PROJECT_SPEC.md` برآورده شدند: تست‌های بحرانی، backup/restore، نصب Windows و کار offline. Signing شرط معیارهای رسمی نیست، اما محدودیت انتشار عمومی است.
