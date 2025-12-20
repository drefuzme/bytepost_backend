# Backend CORS Sozlamalari

## Frontend URL

Frontend URL: `https://bytepostorg.vercel.app/`

## CORS Sozlamalarini Yangilash

Backend kodida CORS sozlamalarini yangilash kerak.

### Hozirgi holat (dist/index.js):

```javascript
app.use(cors()); // Barcha origin'larni ruxsat beradi
```

### Yangi holat:

```javascript
app.use(cors({
  origin: [
    'http://localhost:3000',  // Development
    'https://bytepostorg.vercel.app'  // Production
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

## Backend Source Kodini Yangilash

Agar backend source kod (`src/index.ts`) mavjud bo'lsa, uni quyidagicha yangilang:

```typescript
import cors from 'cors';

app.use(cors({
  origin: [
    'http://localhost:3000',
    'https://bytepostorg.vercel.app'
  ],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));
```

Keyin rebuild qiling:
```bash
npm run build
```

## Yoki Environment Variable Orqali

Backend `.env` faylida:

```env
FRONTEND_URL=https://bytepostorg.vercel.app
```

Va kodda:

```typescript
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL || 'https://bytepostorg.vercel.app'
].filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));
```

## Railway'da Environment Variable Qo'shish

1. Railway dashboard → Backend service → **Settings** → **Variables**
2. **Add Variable** tugmasini bosing
3. Quyidagilarni qo'shing:

| Key | Value |
|-----|-------|
| `FRONTEND_URL` | `https://bytepostorg.vercel.app` |

4. **Save** tugmasini bosing
5. **Redeploy** qiling

## Tekshirish

CORS sozlangandan keyin:

1. Frontend'da API so'rov yuboring
2. Browser console'da xatolarni tekshiring
3. Network tab'da CORS headers'ni tekshiring
4. Agar `Access-Control-Allow-Origin: https://bytepostorg.vercel.app` ko'rsatilsa, to'g'ri sozlangan!

## Muammolarni Hal Qilish

### "CORS policy" xatosi

- Backend'da frontend URL qo'shilganini tekshiring
- Backend'ni redeploy qiling
- Browser cache'ni tozalang

### "Credentials" xatosi

- `credentials: true` qo'shilganini tekshiring
- Frontend'da axios so'rovlarida `withCredentials: true` qo'shing (agar kerak bo'lsa)


