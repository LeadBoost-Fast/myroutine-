// Отправляет пуш-напоминания «Моей рутины».
// Сайт сам кладёт в Firestore (коллекция rutina) список напоминаний на 2 суток вперёд и токены устройств.
// Этот скрипт запускается по расписанию GitHub Actions, находит наступившие напоминания и отправляет их через Firebase Cloud Messaging.
import admin from 'firebase-admin';

const sa = JSON.parse(process.env.FIREBASE_SA || '{}');
if (!sa.project_id) { console.log('Нет секрета FIREBASE_SA — пропускаю'); process.exit(0); }
admin.initializeApp({ credential: admin.credential.cert(sa) });
const db = admin.firestore();
const LINK = 'https://leadboost-fast.github.io/myroutine-/';
const now = Date.now();
const WINDOW_BACK = 25 * 60 * 1000;  // не отправлять то, что опоздало больше чем на 25 минут
const AHEAD = 2 * 60 * 1000;

const snap = await db.collection('rutina').get();
let sent = 0;
for (const doc of snap.docs) {
  const { rem = [], tokens = [] } = doc.data();
  if (!tokens.length || !rem.length) continue;
  const logRef = db.collection('rutina_sent').doc(doc.id);
  const log = (await logRef.get()).data()?.ids || {};
  const due = rem.filter(r => r.at <= now + AHEAD && r.at > now - WINDOW_BACK && !log[r.id]);
  const bad = new Set();
  for (const r of due) {
    for (const token of tokens) {
      try {
        await admin.messaging().send({
          token,
          notification: { title: r.t, body: r.b },
          webpush: { fcmOptions: { link: LINK }, notification: { icon: LINK + 'icon-192.png', badge: LINK + 'icon-192.png' } },
        });
        sent++;
      } catch (e) {
        const c = e.errorInfo?.code || '';
        if (c.includes('registration-token-not-registered') || c.includes('invalid-argument')) bad.add(token);
        console.log('Ошибка отправки', c || e.message);
      }
    }
    log[r.id] = now;
  }
  for (const id of Object.keys(log)) if (log[id] < now - 3 * 86400000) delete log[id];
  await logRef.set({ ids: log });
  if (bad.size) await doc.ref.update({ tokens: admin.firestore.FieldValue.arrayRemove(...bad) });
}
console.log('Отправлено уведомлений:', sent);
