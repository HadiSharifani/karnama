# Privacy and Security | حریم خصوصی و امنیت

## English

KARNAMA v0.1.0 is a single-user desktop application. Core task, timer, calendar, analytics, and backup functions require no account, cloud service, or network connection. The application stores its SQLite database, managed image attachments, and backups in Electron's per-user `userData` directory. Its exact location depends on the Windows account and app installation; use Settings → Backup and Restore → **Open folder** to locate backups.

KARNAMA does not provide cloud sync or an account recovery service. If the Windows profile or device is lost, recovery depends on a separate backup that you control. Keep copies on a different device or protected storage.

Backup ZIPs include the database and managed attachments plus a manifest with file sizes and SHA-256 hashes. Hashes help detect corruption or mismatch; they do **not** encrypt data, authenticate the publisher, or protect a backup from someone who can read it. KARNAMA does not encrypt its SQLite database or backup ZIPs at rest. Use Windows account/device protections and encrypt sensitive backup media with a tool you trust.

PDF/HTML reports can include profile name, job title, task titles, descriptions or notes, links, and embedded task images. Review an export before sending it to an employer or another person. External links are opened only when you ask KARNAMA to open them, using the system browser; that browser may contact the linked service.

The application window enables context isolation, sandboxing, web security, and disables renderer Node.js integration. IPC calls are checked against the expected app origin. These implementation controls reduce attack surface but do not replace Windows updates, source review, backups, or safe handling of files.

The v0.1.0 Windows installer and executable are unsigned and have no signing certificate or timestamp. Windows may show an unknown-publisher or SmartScreen warning. Verify the SHA-256 published with the release; a matching hash confirms file consistency with that published value, not publisher identity. Do not disable Windows security protections to run the app.

Uninstalling removes application files but intentionally preserves the user's data. A later installer does not include an automatic updater; create an independent backup before upgrading or migrating.

## فارسی

کارنما نسخهٔ ۰٫۱٫۰ برنامه‌ای تک‌کاربره برای دسکتاپ است. قابلیت‌های اصلی تسک، تایمر، تقویم، تحلیل و پشتیبان‌گیری به حساب آنلاین یا اتصال شبکه نیاز ندارند. پایگاه دادهٔ SQLite، تصویرهای مدیریت‌شده و نسخه‌های پشتیبان در پوشهٔ `userData` همان کاربر Windows نگه‌داری می‌شوند. مسیر دقیق به حساب و نصب بستگی دارد؛ از تنظیمات ← «پشتیبان‌گیری و بازیابی» ← «پوشه» محل نسخه‌های پشتیبان را پیدا کنید.

همگام‌سازی ابری یا سرویس بازیابی حساب وجود ندارد. اگر پروفایل Windows یا دستگاه از دست برود، بازیابی به نسخهٔ مستقلی وابسته است که خودتان نگه داشته‌اید. یک کپی را روی دستگاه یا رسانه‌ای دیگر حفظ کنید.

ZIP پشتیبان شامل پایگاه داده، پیوست‌های مدیریت‌شده و manifest اندازه/hash فایل‌هاست. checksum برای تشخیص خرابی یا mismatch است؛ داده را **رمزگذاری نمی‌کند**، هویت ناشر را تأیید نمی‌کند و از backup در برابر خواندن توسط شخص دارای دسترسی محافظت نمی‌کند. SQLite و ZIPها در خود کارنما رمزگذاری at-rest ندارند. از محافظت حساب/دستگاه Windows استفاده کنید و رسانهٔ حساس را با ابزار مورداعتماد خود رمزگذاری کنید.

گزارش PDF/HTML می‌تواند نام و عنوان شغلی پروفایل، عنوان/شرح/یادداشت تسک، لینک و تصویر پیوست را شامل شود. پیش از ارسال گزارش برای کارفرما یا شخص دیگر، محتوای آن را بررسی کنید. لینک خارجی فقط با فرمان شما در مرورگر پیش‌فرض باز می‌شود و مرورگر ممکن است به سرویس لینک‌شده وصل شود.

پنجرهٔ برنامه context isolation و sandbox دارد، web security فعال است و Node.js در renderer در دسترس نیست. درخواست‌های IPC با مبدأ موردانتظار برنامه تطبیق داده می‌شوند. این کنترل‌ها سطح حمله را کاهش می‌دهند اما جایگزین به‌روزرسانی Windows، بازبینی فایل، پشتیبان‌گیری و نگه‌داری امن داده نیستند.

Installer و executable نسخهٔ ۰٫۱٫۰ امضای دیجیتال یا timestamp ندارند؛ Windows ممکن است هشدار ناشر ناشناس یا SmartScreen نشان دهد. SHA-256 انتشار را تطبیق دهید؛ تطابق hash فقط یکسانی فایل با مقدار منتشرشده را می‌سنجد و هویت ناشر را اثبات نمی‌کند. برای اجرای برنامه، محافظت امنیتی Windows را خاموش نکنید.

حذف برنامه فایل‌های اجرایی را پاک می‌کند اما دادهٔ کاربر را عمداً حفظ می‌کند. به‌روزرسان خودکار وجود ندارد؛ پیش از ارتقا یا انتقال، یک نسخهٔ مستقل تهیه کنید.
