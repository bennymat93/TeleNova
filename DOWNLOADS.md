# הורדות - BN Stream לאייפון, לאייפד ולאנדרואיד

כל הגרסאות נשמרות בעמוד ה-Releases של הריפו, וכל גרסה נשארת זמינה להורדה גם אחרי שיוצאת חדשה:

**https://github.com/bennymat93/TeleNova/releases**

| אפליקציה | איפה | שם הקובץ | התקנה |
|---|---|---|---|
| iPhone / iPad (IPA לא חתום) | גרסאות שהתג שלהן מתחיל ב-`ios-` | `BN-Stream-iOS-<גרסה>-b<בנייה>.ipa` | [ios/README-app.md](ios/README-app.md) - חתימה עצמית (Sideloadly / AltStore) |
| Android (טלפון, טאבלט, Android TV, רכב) | גרסאות שהתג שלהן מתחיל ב-`apk-` | `BN-Stream-Android-<גרסה>.apk` | [apk/README.md](apk/README.md) |

קישורים ישירים לגרסה האחרונה (מהאתר, תמיד הקובץ העדכני):

- iOS: https://bennymat93.github.io/TeleNova/ios/TeleNova-Web-2.0.ipa
- Android: https://bennymat93.github.io/TeleNova/apk/TeleNova.apk

איך זה מתעדכן:
- **iOS** - אוטומטי: כל בנייה ירוקה של `.github/workflows/ios-app.yml` יוצרת Release חדש `ios-<גרסה>-b<מספר בנייה>`
  ומחליפה את הקובץ שב-`ios/`.
- **Android** - אחרי כל שחרור APK מריצים פעם אחת, מתיקיית הפרויקט, עם מספר הגרסה החדש:
  `cp apk/TeleNova.apk BN-Stream-Android-X.Y.Z.apk` ואז
  `gh release create apk-X.Y.Z BN-Stream-Android-X.Y.Z.apk --target gh-pages --latest --title "BN Stream Android X.Y.Z"`

האפליקציות מציגות את האתר החי, ולכן רוב העדכונים מגיעים ברענון בלי להתקין קובץ חדש. גרסה ישנה נדרשת רק אם
גרסה חדשה של האפליקציה עצמה עושה בעיה במכשיר.
