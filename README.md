# YMusic API

مستودع مستقل لخدمة API الخاصة بتطبيق YMusic. يستخدم نفس طريقة الكود المرفق: يرسل طلبًا إلى صفحة نتائج YouTube، يستخرج `ytInitialData` ثم يقرأ عناصر `videoRenderer`، بدون YouTube API Key.

## النشر على Vercel

1. في Vercel اختر **Add New → Project**.
2. استورد هذا المستودع.
3. اترك Framework Preset على **Other**.
4. لا تضف Environment Variables ولا Build Command.
5. اضغط **Deploy**.

## اختبار النشر

بعد ظهور الرابط، اختبر:

```text
https://YOUR-DOMAIN.vercel.app/api/trpc/system.health
```

واختبر البحث:

```text
https://YOUR-DOMAIN.vercel.app/api/trpc/youtube.search?input={"json":{"query":"lofi","limit":8}}
```

المسار يدعم CORS حتى يستطيع تطبيق Android استهلاك النتائج.
