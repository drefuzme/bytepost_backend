# Backend CORS Sozlamalarini To'g'rilash

## ⚠️ MUHIM: dist/index.js Compiled Kod

`dist/index.js` compiled kod, uni to'g'ridan-to'g'ri o'zgartirish yaxshi yechim emas. Source kod (`src/index.ts`) topish kerak.

## ✅ Yechim: Backend Source Kodini Topish

1. **Backend source kod mavjudmi?**

   Agar `backend/src/index.ts` mavjud bo'lsa:
   - Uni yangilaymiz
   - `npm run build` qilamiz
   - Railway'da redeploy qilamiz

2. **Agar source kod yo'q bo'lsa:**

   Railway'da environment variable orqali CORS sozlang.

---

## 🔧 Yechim 1: Source Kodda CORS Sozlash (Afzal)

Agar `backend/src/index.ts` mavjud bo'lsa:

```typescript
import cors from 'cors';

app.use(cors({
  origin: [
    'http://localhost:3000',
    'http://localhost:5173',
    'https://bytepostorg.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

Keyin:
```bash
npm run build
```

---

## 🔧 Yechim 2: Railway Environment Variable (Agar source kod yo'q bo'lsa)

Railway dashboard → Backend service → **Settings** → **Variables**:

1. **Add Variable:**
   - Key: `CORS_ORIGIN`
   - Value: `https://bytepostorg.vercel.app,http://localhost:3000,http://localhost:5173`

2. Backend kodini yangilang (agar source kod mavjud bo'lsa):

```typescript
const allowedOrigins = process.env.CORS_ORIGIN?.split(',') || [
  'http://localhost:3000',
  'http://localhost:5173',
  'https://bytepostorg.vercel.app'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
```

---

## 📋 Tekshirish

Backend'ni test qiling:

```bash
# Browser'da
https://bytepostbackend-production.up.railway.app/api/health
```

Agar `{ "status": "ok", "message": "BytePost API is running" }` qaytsa, backend ishlayapti.

Frontend'dan test qiling:
- Browser console → Network tab
- Biror API so'rov yuboring
- CORS xatosi bo'lmasligi kerak

---

## 🚨 Hozirgi Holat

`dist/index.js` da CORS sozlangan, lekin rebuild qilinganda yo'qoladi. Source kodni topish va u yerda sozlash kerak!


