import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt, { type SignOptions } from 'jsonwebtoken';
import { AdminRole, type AdminUser } from '@prisma/client';
import type { Database } from '@/database/prisma.client';
import { config } from '@/config';
import { secondsFromNow } from '@/utils/time';
import { UnauthorizedError, ConflictError, ForbiddenError } from '@/utils/errors';
import type { AccessTokenPayload, RefreshTokenPayload } from '@/types';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface AuthedAdmin {
  id: string;
  email: string;
  role: AdminRole;
  name: string | null;
}

/**
 * Dashboard authentication: password login, JWT issuance, and refresh-token
 * rotation with revocation. Telegram identities are never involved here.
 */
export class AuthService {
  constructor(private readonly db: Database) {}

  async register(
    email: string,
    password: string,
    role: AdminRole = AdminRole.VIEWER,
    name?: string,
  ): Promise<AuthedAdmin> {
    const existing = await this.db.adminUser.findUnique({ where: { email } });
    if (existing) throw new ConflictError('An account with this email already exists');

    const passwordHash = await bcrypt.hash(password, config.BCRYPT_ROUNDS);
    const user = await this.db.adminUser.create({
      data: { email, passwordHash, role, name: name ?? null },
    });
    return this.toAuthed(user);
  }

  async login(email: string, password: string): Promise<{ admin: AuthedAdmin; tokens: TokenPair }> {
    const user = await this.db.adminUser.findUnique({ where: { email } });
    // Constant-ish work whether or not the user exists, to blunt enumeration.
    const hash = user?.passwordHash ?? '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hash);

    if (!user || !ok) throw new UnauthorizedError('Invalid credentials');
    if (!user.active) throw new ForbiddenError('Account disabled');

    await this.db.adminUser.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const tokens = await this.issueTokens(user);
    return { admin: this.toAuthed(user), tokens };
  }

  /** Rotates a refresh token: validates, revokes the old, issues a new pair. */
  async refresh(refreshToken: string): Promise<TokenPair> {
    let payload: RefreshTokenPayload;
    try {
      payload = jwt.verify(refreshToken, config.JWT_SECRET) as RefreshTokenPayload;
    } catch {
      throw new UnauthorizedError('Invalid refresh token');
    }
    if (payload.type !== 'refresh') throw new UnauthorizedError('Wrong token type');

    const tokenHash = hashToken(refreshToken);
    const stored = await this.db.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      // Presenting a revoked/expired token is suspicious — revoke the whole
      // family for that user as a defensive measure.
      if (stored) {
        await this.db.refreshToken.updateMany({
          where: { adminUserId: stored.adminUserId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      throw new UnauthorizedError('Refresh token no longer valid');
    }

    await this.db.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    const user = await this.db.adminUser.findUniqueOrThrow({ where: { id: payload.sub } });
    return this.issueTokens(user);
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.db.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Verifies an access token and returns its payload. Used by API middleware. */
  verifyAccessToken(token: string): AccessTokenPayload {
    try {
      const payload = jwt.verify(token, config.JWT_SECRET) as AccessTokenPayload;
      if (payload.type !== 'access') throw new Error('wrong type');
      return payload;
    } catch {
      throw new UnauthorizedError('Invalid or expired access token');
    }
  }

  private async issueTokens(user: AdminUser): Promise<TokenPair> {
    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      type: 'access',
    };
    const accessToken = jwt.sign(accessPayload, config.JWT_SECRET, {
      expiresIn: config.JWT_ACCESS_TTL,
    } as SignOptions);

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti, type: 'refresh' };
    const refreshToken = jwt.sign(refreshPayload, config.JWT_SECRET, {
      expiresIn: config.JWT_REFRESH_TTL,
    } as SignOptions);

    await this.db.refreshToken.create({
      data: {
        adminUserId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: secondsFromNow(config.JWT_REFRESH_TTL),
      },
    });

    return { accessToken, refreshToken, expiresIn: config.JWT_ACCESS_TTL };
  }

  private toAuthed(user: AdminUser): AuthedAdmin {
    return { id: user.id, email: user.email, role: user.role, name: user.name };
  }
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
