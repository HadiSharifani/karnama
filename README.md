# کارنما

پایه‌ی یک برنامه دسکتاپ Windows برای ثبت کار روزانه، آفلاین و تک‌کاربره. رابط فارسی و راست‌به‌چپ است و تنظیمات در SQLite محلی نگهداری می‌شوند.

## اجرا

```powershell
npm install
npm run dev
```

## بررسی کیفیت

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npm run build
```

برای اجرای آزمون Electron با Playwright ابتدا `npm run build:app` و سپس `npm run test:e2e` را اجرا کنید.

## محدوده فعلی

فاز یک پوسته‌ی هفت‌بخشی، راهنمای آغاز کار، تم، تنظیمات و زیرساخت امن ذخیره‌سازی را فراهم می‌کند. ایجاد/ویرایش تسک، ثبت جلسه کاری، تایمر، محاسبات تعهد و تقویم داده‌محور در فازهای بعدی ساخته می‌شوند؛ تا آن زمان صفحاتشان وضعیت خالی واقعی دارند.

جزئیات معماری و فازها در [ARCHITECTURE.md](ARCHITECTURE.md) و [DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) آمده‌اند.
