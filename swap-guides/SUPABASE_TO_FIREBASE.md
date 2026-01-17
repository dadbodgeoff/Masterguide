# Swap Guide: Supabase → Firebase

> Replace Supabase with Firebase for auth, database, and storage

## Overview

| Supabase | Firebase Equivalent |
|----------|---------------------|
| Supabase Auth | Firebase Auth |
| PostgreSQL + RLS | Firestore + Security Rules |
| Supabase Storage | Firebase Storage |
| Realtime subscriptions | Firestore listeners |

## Affected Files

### Must Replace (Delete and Recreate)

```
apps/web/lib/supabase/        → apps/web/lib/firebase/
├── client.ts                 → client.ts (Firebase app init)
├── server.ts                 → admin.ts (Firebase Admin SDK)
└── middleware.ts             → middleware.ts (session handling)

supabase/                     → firebase/
├── config.toml               → firebase.json
├── migrations/               → firestore.rules + firestore.indexes.json
└── seed.sql                  → (seed script or Firestore import)
```

### Must Update (Modify in Place)

```
apps/web/lib/auth/
├── context.tsx               # Change auth provider
├── hooks.ts                  # Change auth hooks
└── middleware.ts             # Change session validation

apps/web/lib/storage/
├── client.ts                 # Change storage client
└── hooks.ts                  # Update upload logic

packages/backend/src/
├── database.py               # Change to Firestore client
├── auth/jwt.py               # Change token validation
└── storage/service.py        # Change storage service

Environment files:
├── .env.example              # Update variable names
├── .env                      # Update values
└── apps/web/.env.local       # Update frontend vars
```

### No Change Needed

```
packages/backend/src/resilience/   # Service-agnostic
packages/backend/src/jobs/         # Uses Redis, not Supabase
packages/backend/src/cache/        # Uses Redis
packages/backend/src/integrations/ # Stripe, email unchanged
packages/backend/src/security/     # Patterns unchanged
packages/types/                    # Types stay the same
apps/web/components/               # UI unchanged
apps/web/lib/api/                  # API client unchanged
```

---

## Current Pattern (Supabase)

### Frontend Auth (`apps/web/lib/auth/context.tsx`)
```typescript
// Current: Supabase Auth
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();
const { data: { user } } = await supabase.auth.getUser();
await supabase.auth.signInWithPassword({ email, password });
await supabase.auth.signOut();
```

### Backend Database (`packages/backend/src/database.py`)
```python
# Current: Supabase client with RLS
from supabase import create_client

client = create_client(url, key)
result = client.table("users").select("*").eq("id", user_id).execute()
```

### Storage (`apps/web/lib/storage/client.ts`)
```typescript
// Current: Supabase Storage
const { data, error } = await supabase.storage
  .from(bucket)
  .upload(path, file);
```

---

## Replacement Pattern (Firebase)

### Frontend Auth (`apps/web/lib/auth/context.tsx`)
```typescript
// New: Firebase Auth
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { app } from '@/lib/firebase/client';

const auth = getAuth(app);

// Listen to auth state
onAuthStateChanged(auth, (user) => {
  setUser(user);
});

// Sign in
await signInWithEmailAndPassword(auth, email, password);

// Sign out
await signOut(auth);

// Get current user
const user = auth.currentUser;

// Get ID token for backend
const token = await user.getIdToken();
```

### Firebase Client (`apps/web/lib/firebase/client.ts`)
```typescript
import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const app = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
```

### Backend Database (`packages/backend/src/database.py`)
```python
# New: Firebase Admin SDK with Firestore
import firebase_admin
from firebase_admin import credentials, firestore, auth

# Initialize once
cred = credentials.Certificate("path/to/serviceAccount.json")
firebase_admin.initialize_app(cred)

db = firestore.client()

# Query (no automatic RLS - must filter manually)
def get_user_data(user_id: str):
    doc = db.collection("users").document(user_id).get()
    return doc.to_dict() if doc.exists else None

# Query with ownership check
def get_user_jobs(user_id: str):
    jobs = db.collection("jobs").where("user_id", "==", user_id).stream()
    return [job.to_dict() for job in jobs]
```

### Backend Auth (`packages/backend/src/auth/jwt.py`)
```python
# New: Firebase token validation
from firebase_admin import auth

def verify_firebase_token(token: str) -> dict:
    """Verify Firebase ID token."""
    try:
        decoded = auth.verify_id_token(token)
        return {
            "uid": decoded["uid"],
            "email": decoded.get("email"),
        }
    except Exception as e:
        raise AuthenticationError(f"Invalid token: {e}")
```

### Storage (`apps/web/lib/storage/client.ts`)
```typescript
// New: Firebase Storage
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '@/lib/firebase/client';

export async function uploadFile(bucket: string, path: string, file: File) {
  const storageRef = ref(storage, `${bucket}/${path}`);
  const snapshot = await uploadBytes(storageRef, file);
  const url = await getDownloadURL(snapshot.ref);
  return { path: snapshot.ref.fullPath, url };
}
```

### Firestore Security Rules (`firebase/firestore.rules`)
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users can only read/write their own document
    match /users/{userId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Users can only access their own jobs
    match /jobs/{jobId} {
      allow read, write: if request.auth != null 
        && resource.data.user_id == request.auth.uid;
      allow create: if request.auth != null 
        && request.resource.data.user_id == request.auth.uid;
    }
  }
}
```

### Storage Security Rules (`firebase/storage.rules`)
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Avatars: public read, owner write
    match /avatars/{userId}/{allPaths=**} {
      allow read: if true;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Documents: owner only
    match /documents/{userId}/{allPaths=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

---

## Migration Steps

### 1. Install Dependencies

```bash
# Frontend
pnpm add firebase --filter @project/web

# Backend
pip install firebase-admin
```

### 2. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com)
2. Create new project
3. Enable Authentication (Email/Password)
4. Create Firestore database
5. Enable Storage
6. Download service account key for backend

### 3. Update Environment Variables

```bash
# .env.example - Remove Supabase vars, add Firebase
# Frontend (public)
NEXT_PUBLIC_FIREBASE_API_KEY=xxx
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=xxx.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=xxx
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=xxx.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=xxx
NEXT_PUBLIC_FIREBASE_APP_ID=xxx

# Backend (private)
FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json
# Or use FIREBASE_SERVICE_ACCOUNT_JSON for the JSON content directly
```

### 4. Replace Frontend Files

1. Delete `apps/web/lib/supabase/`
2. Create `apps/web/lib/firebase/client.ts`
3. Update `apps/web/lib/auth/context.tsx`
4. Update `apps/web/lib/auth/hooks.ts`
5. Update `apps/web/lib/storage/client.ts`
6. Update `apps/web/middleware.ts`

### 5. Replace Backend Files

1. Update `packages/backend/src/database.py`
2. Update `packages/backend/src/auth/jwt.py`
3. Update `packages/backend/src/auth/dependencies.py`
4. Update `packages/backend/src/storage/service.py`

### 6. Create Firebase Config

1. Delete `supabase/` directory
2. Create `firebase/` directory
3. Add `firebase.json`
4. Add `firestore.rules`
5. Add `firestore.indexes.json`
6. Add `storage.rules`

### 7. Migrate Data (if existing)

```bash
# Export from Supabase
# Import to Firestore using Firebase CLI or Admin SDK
```

### 8. Update STEERING.md Files

Update these files to reference Firebase instead of Supabase:
- `.kiro/steering/architecture-overview.md`
- `apps/web/STEERING.md`
- `apps/web/lib/auth/STEERING.md`
- `packages/backend/STEERING.md`
- `packages/backend/src/auth/STEERING.md`
- `supabase/STEERING.md` → `firebase/STEERING.md`

### 9. Deploy Security Rules

```bash
firebase deploy --only firestore:rules,storage
```

---

## Key Differences to Remember

| Supabase | Firebase |
|----------|----------|
| RLS enforced at DB level | Security rules enforced at API level |
| SQL queries | NoSQL document queries |
| Automatic user table | Must create users collection manually |
| `auth.uid()` in RLS | `request.auth.uid` in rules |
| Migrations for schema | Schema-less (indexes for queries) |
| Service role bypasses RLS | Admin SDK bypasses rules |

---

## Verification Checklist

- [ ] Firebase project created and configured
- [ ] Environment variables updated
- [ ] Frontend auth works (sign in, sign out, persist session)
- [ ] Backend token validation works
- [ ] Firestore reads work with ownership filtering
- [ ] Firestore writes work
- [ ] Storage uploads work
- [ ] Storage downloads/signed URLs work
- [ ] Security rules deployed and tested
- [ ] All existing tests pass (with mocks updated)
- [ ] STEERING.md files updated
