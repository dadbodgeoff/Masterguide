# JWT Refresh Token Rotation Pattern

> **Time to implement:** 4-6 hours  
> **Complexity:** Medium-High  
> **Prerequisites:** Redis, JWT library (jose)

## The Problem

Standard JWT auth has security gaps:
- Stolen refresh tokens can be used indefinitely
- No way to detect token theft
- No mechanism to invalidate all sessions

## The Solution

Refresh token rotation with reuse detection:
1. Issue new refresh token on every refresh
2. Track token usage in Redis
3. If old token is reused → **security breach** → invalidate ALL sessions

## Architecture

```
Login → Issue RT1 → Store RT1 in Redis
                         ↓
Refresh with RT1 → Mark RT1 used → Issue RT2 → Store RT2
                         ↓
Attacker uses RT1 → RT1 already used! → INVALIDATE ALL TOKENS
```

## Core Implementation

### Types

```typescript
// lib/auth/types.ts
export interface TokenPayload {
  sub: string;      // User ID
  type: 'access' | 'refresh';
  tier?: string;    // Subscription tier (access only)
  email?: string;   // User email (access only)
  exp: number;      // Expiration timestamp
  iat: number;      // Issued at timestamp
  jti: string;      // JWT ID for tracking
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}

export class TokenReuseDetectedError extends Error {
  constructor(public userId: string, public jti: string) {
    super(`Token reuse detected for user ${userId}`);
    this.name = 'TokenReuseDetectedError';
  }
}
```

### JWT Service

```typescript
// lib/auth/jwt-service.ts
import { SignJWT, jwtVerify } from 'jose';
import { v4 as uuid } from 'uuid';

const ACCESS_TOKEN_EXPIRY = '24h';
const REFRESH_TOKEN_EXPIRY = '30d';

export class JWTService {
  private secret: Uint8Array;

  constructor(secretKey: string) {
    this.secret = new TextEncoder().encode(secretKey);
  }

  async createAccessToken(
    userId: string,
    tier: string,
    email: string
  ): Promise<string> {
    return new SignJWT({
      sub: userId,
      type: 'access',
      tier,
      email,
      jti: uuid(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(ACCESS_TOKEN_EXPIRY)
      .sign(this.secret);
  }

  async createRefreshToken(userId: string): Promise<string> {
    return new SignJWT({
      sub: userId,
      type: 'refresh',
      jti: uuid(),
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime(REFRESH_TOKEN_EXPIRY)
      .sign(this.secret);
  }

  async verifyAccessToken(token: string): Promise<TokenPayload> {
    const { payload } = await jwtVerify(token, this.secret);
    
    if (payload.type !== 'access') {
      throw new Error('Invalid token type');
    }

    return payload as unknown as TokenPayload;
  }

  async verifyRefreshToken(token: string): Promise<TokenPayload> {
    const { payload } = await jwtVerify(token, this.secret);
    
    if (payload.type !== 'refresh') {
      throw new Error('Invalid token type');
    }

    return payload as unknown as TokenPayload;
  }
}
```

### Token Store (Redis)

```typescript
// lib/auth/token-store.ts
import Redis from 'ioredis';

const TOKEN_TTL_DAYS = 30;
const TOKEN_PREFIX = 'refresh_token:';
const USER_TOKENS_PREFIX = 'user_tokens:';

interface StoredToken {
  userId: string;
  createdAt: string;
  used: boolean;
  usedAt?: string;
  replacedBy?: string;
}

export class TokenStore {
  constructor(private redis: Redis) {}

  /**
   * Register a new refresh token for tracking
   */
  async registerToken(jti: string, userId: string): Promise<void> {
    const key = `${TOKEN_PREFIX}${jti}`;
    const userKey = `${USER_TOKENS_PREFIX}${userId}`;
    const ttl = TOKEN_TTL_DAYS * 86400;

    const tokenData: StoredToken = {
      userId,
      createdAt: new Date().toISOString(),
      used: false,
    };

    const pipeline = this.redis.pipeline();
    pipeline.set(key, JSON.stringify(tokenData), 'EX', ttl);
    pipeline.sadd(userKey, jti);
    pipeline.expire(userKey, ttl);
    await pipeline.exec();
  }

  /**
   * Attempt to use a refresh token
   * Returns true if valid, throws if reused
   */
  async useToken(jti: string, userId: string, newJti?: string): Promise<boolean> {
    const key = `${TOKEN_PREFIX}${jti}`;
    const data = await this.redis.get(key);

    if (!data) {
      return false; // Token doesn't exist
    }

    const tokenData: StoredToken = JSON.parse(data);

    // Verify ownership
    if (tokenData.userId !== userId) {
      return false;
    }

    // SECURITY ALERT: Token already used!
    if (tokenData.used) {
      console.error('🚨 SECURITY ALERT: Refresh token reuse detected!', {
        jti,
        userId,
        originalUsedAt: tokenData.usedAt,
      });

      // Invalidate ALL user tokens
      await this.invalidateAllUserTokens(userId);
      
      throw new TokenReuseDetectedError(userId, jti);
    }

    // Mark as used
    tokenData.used = true;
    tokenData.usedAt = new Date().toISOString();
    if (newJti) {
      tokenData.replacedBy = newJti;
    }

    await this.redis.set(key, JSON.stringify(tokenData), 'KEEPTTL');
    return true;
  }

  /**
   * Invalidate a specific token (logout)
   */
  async invalidateToken(jti: string): Promise<void> {
    const key = `${TOKEN_PREFIX}${jti}`;
    const data = await this.redis.get(key);

    if (data) {
      const tokenData: StoredToken = JSON.parse(data);
      const userKey = `${USER_TOKENS_PREFIX}${tokenData.userId}`;
      
      await this.redis.pipeline()
        .del(key)
        .srem(userKey, jti)
        .exec();
    }
  }

  /**
   * Invalidate ALL tokens for a user (security breach response)
   */
  async invalidateAllUserTokens(userId: string): Promise<number> {
    const userKey = `${USER_TOKENS_PREFIX}${userId}`;
    const tokenJtis = await this.redis.smembers(userKey);

    if (tokenJtis.length === 0) return 0;

    const pipeline = this.redis.pipeline();
    
    for (const jti of tokenJtis) {
      pipeline.del(`${TOKEN_PREFIX}${jti}`);
    }
    pipeline.del(userKey);

    await pipeline.exec();
    
    console.warn(`Invalidated ${tokenJtis.length} tokens for user ${userId}`);
    return tokenJtis.length;
  }
}
```

### Auth Service

```typescript
// lib/auth/auth-service.ts
import bcrypt from 'bcrypt';

const BCRYPT_ROUNDS = 12;

export class AuthService {
  constructor(
    private jwtService: JWTService,
    private tokenStore: TokenStore,
    private db: Database // Your database client
  ) {}

  async login(
    email: string,
    password: string
  ): Promise<{ tokens: TokenPair; user: User }> {
    // Find user
    const user = await this.db.users.findByEmail(email.toLowerCase());
    if (!user) {
      throw new Error('Invalid credentials');
    }

    // Verify password (timing-safe)
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      throw new Error('Invalid credentials');
    }

    // Create tokens
    const tokens = await this.createTokenPair(user);

    return { tokens, user };
  }

  async refresh(refreshToken: string): Promise<TokenPair> {
    // Verify token signature
    const payload = await this.jwtService.verifyRefreshToken(refreshToken);

    // Create new refresh token FIRST (for rotation)
    const user = await this.db.users.findById(payload.sub);
    if (!user) {
      throw new Error('User not found');
    }

    const newRefreshToken = await this.jwtService.createRefreshToken(user.id);
    const newPayload = await this.jwtService.verifyRefreshToken(newRefreshToken);

    // Check for reuse (this may throw TokenReuseDetectedError)
    try {
      const valid = await this.tokenStore.useToken(
        payload.jti,
        payload.sub,
        newPayload.jti
      );

      if (!valid) {
        throw new Error('Invalid refresh token');
      }
    } catch (err) {
      if (err instanceof TokenReuseDetectedError) {
        throw new Error(
          'Security alert: This token was already used. All sessions invalidated.'
        );
      }
      throw err;
    }

    // Register new token
    await this.tokenStore.registerToken(newPayload.jti, user.id);

    // Create new access token
    const accessToken = await this.jwtService.createAccessToken(
      user.id,
      user.subscriptionTier,
      user.email
    );

    return {
      accessToken,
      refreshToken: newRefreshToken, // NEW token (rotation)
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }

  async logout(refreshToken: string): Promise<void> {
    try {
      const payload = await this.jwtService.verifyRefreshToken(refreshToken);
      await this.tokenStore.invalidateToken(payload.jti);
    } catch {
      // Token invalid, nothing to invalidate
    }
  }

  async logoutAllDevices(userId: string): Promise<void> {
    await this.tokenStore.invalidateAllUserTokens(userId);
  }

  async changePassword(
    userId: string,
    newPassword: string
  ): Promise<void> {
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.db.users.updatePassword(userId, hash);

    // IMPORTANT: Invalidate all tokens on password change
    await this.tokenStore.invalidateAllUserTokens(userId);
  }

  private async createTokenPair(user: User): Promise<TokenPair> {
    const accessToken = await this.jwtService.createAccessToken(
      user.id,
      user.subscriptionTier,
      user.email
    );

    const refreshToken = await this.jwtService.createRefreshToken(user.id);
    const payload = await this.jwtService.verifyRefreshToken(refreshToken);

    // Register for tracking
    await this.tokenStore.registerToken(payload.jti, user.id);

    return {
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    };
  }
}
```

## API Routes

```typescript
// app/api/auth/login/route.ts
export async function POST(req: Request) {
  const { email, password } = await req.json();

  try {
    const { tokens, user } = await authService.login(email, password);

    const response = NextResponse.json({ user });

    // Set HTTP-only cookies
    response.cookies.set('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60, // 24 hours
    });

    response.cookies.set('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (err) {
    return NextResponse.json(
      { error: 'Invalid credentials' },
      { status: 401 }
    );
  }
}
```

```typescript
// app/api/auth/refresh/route.ts
export async function POST(req: Request) {
  const refreshToken = req.cookies.get('refresh_token')?.value;

  if (!refreshToken) {
    return NextResponse.json(
      { error: 'No refresh token' },
      { status: 401 }
    );
  }

  try {
    const tokens = await authService.refresh(refreshToken);

    const response = NextResponse.json({ success: true });

    // Update cookies with new tokens
    response.cookies.set('access_token', tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60,
    });

    response.cookies.set('refresh_token', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 30 * 24 * 60 * 60,
    });

    return response;
  } catch (err) {
    // Clear cookies on failure
    const response = NextResponse.json(
      { error: 'Session expired' },
      { status: 401 }
    );
    response.cookies.delete('access_token');
    response.cookies.delete('refresh_token');
    return response;
  }
}
```

## Redis Key Structure

```
refresh_token:{jti}
├── userId: "user_123"
├── createdAt: "2024-01-15T10:00:00Z"
├── used: true/false
├── usedAt: "2024-01-15T12:00:00Z"
└── replacedBy: "new_jti_456"
TTL: 30 days

user_tokens:{userId}
└── Set of active JTIs: ["jti_1", "jti_2", ...]
TTL: 30 days
```

## Security Flow

```
NORMAL FLOW:
User logs in → RT1 issued → RT1 stored (used: false)
User refreshes → RT1 marked used → RT2 issued → RT2 stored
User refreshes → RT2 marked used → RT3 issued → RT3 stored

ATTACK DETECTED:
Attacker steals RT1
User refreshes → RT1 marked used → RT2 issued
Attacker uses RT1 → RT1 already used! → ALL TOKENS INVALIDATED
Both user and attacker forced to re-login
```

## Environment Variables

```bash
JWT_SECRET_KEY=your-256-bit-secret-key-here
REDIS_URL=redis://localhost:6379
```

## Checklist

- [ ] JWT service with access/refresh token creation
- [ ] Token store with Redis tracking
- [ ] Reuse detection logic
- [ ] Invalidate all tokens on reuse detection
- [ ] Invalidate all tokens on password change
- [ ] HTTP-only cookies for token storage
- [ ] Secure cookie settings in production
- [ ] Logout endpoint clears tokens
- [ ] "Logout all devices" functionality
- [ ] Proper error messages (don't leak info)
