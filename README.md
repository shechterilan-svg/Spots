# Spots

אפליקציית ווב אישית (PWA) למסעדות ובתי קפה, ובהמשך גם למלונות ולמקומות בילוי.
האפיון המלא נמצא ב-PRD: https://claude.ai/artifact/Gav9Y1E1b77N1S6tUZcmS4

## מבנה

| קובץ | תפקיד |
|---|---|
| `index.html` | מעטפת האפליקציה, סרגל עליון וניווט תחתון |
| `app.js` | ניתוב (hash) ושמונת המסכים |
| `styles.css` | עיצוב: גוונים חמים, כרטיסים, מצב כהה, RTL |
| `config.js` | כתובת Supabase ומפתח anon (ציבורי) |
| `sw.js` | Service Worker לעבודה בלי רשת |
| `manifest.webmanifest`, `icons/` | התקנה למסך הבית |

בלי שלב build: קבצים סטטיים שעולים כמו שהם ל-GitHub Pages.

## מסכים

`#/now` עכשיו · `#/list` רשימה · `#/map` מפה · `#/place/:id` דף מקום · `#/add` הוספה · `#/inbox` תיבת אישור · `#/outings` יציאות (ו-`#/vote/:id` לחברים) · `#/settings` הגדרות

## הקמה (שלב 1)

1. **GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* → `main` / `root`.
2. **Supabase:** פרויקט חדש בשם `spots` (אזור Frankfurt, הכי קרוב לישראל).
   מעתיקים מ-Project Settings → API את ה-URL ואת מפתח ה-anon / publishable ל-`config.js`.
3. **Auth:** Authentication → Providers → Google (אותו Client כמו בליסטה, או חדש).
   ב-URL Configuration מוסיפים את כתובת ה-GitHub Pages כ-Site URL וכ-Redirect URL.

מסך ההגדרות מראה ״מחובר ל-Supabase ✓״ כשהחיבור תקין.

## אבטחה

רק מפתח ה-anon נכנס לקוד. מפתחות service-role, Google Places, Claude ו-Meta נשמרים כ-secrets של Supabase Edge Functions בלבד.

## שלבים

1. שלד וניווט ← **כאן**
2. נתונים וכניסה: טבלאות, RLS, כניסה עם Google, ייבוא 72 המקומות
3. MVP: מיקום והצעה חכמה, שמירה מקישור ומקיצור דרך, חברים, יציאות, הזמנה ויומן
4. חיבורים: PA, רענון שעות, תקרת עלות, התראות
5. הרחבות: משפיענים וכתבות, יומן ביקורים, מפה, ייבוא וואטסאפ
6. קבלה ושחרור
