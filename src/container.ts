import type { Telegram } from 'telegraf';
import { prisma } from '@/database/prisma.client';

import { TelegramGateway } from '@/services/telegram.gateway';
import { AdminCacheService } from '@/services/admin-cache.service';
import { UserService } from '@/services/user.service';
import { ModerationLogService } from '@/services/moderation-log.service';
import { WarningService } from '@/services/warning.service';
import { MuteService } from '@/services/mute.service';
import { BanService } from '@/services/ban.service';
import { ModerationService } from '@/services/moderation.service';
import { TaggingService } from '@/services/tagging.service';
import { SchedulerService } from '@/services/scheduler.service';
import { AuthService } from '@/services/auth.service';

import { ModerationEngine } from '@/moderation/moderation.engine';
import { BannedWordsDetector } from '@/moderation/detectors/banned-words.detector';
import { ScamLinkDetector } from '@/moderation/detectors/scam-link.detector';
import { SpamDetector } from '@/moderation/detectors/spam.detector';
import { FloodDetector } from '@/moderation/detectors/flood.detector';
import { DuplicateDetector } from '@/moderation/detectors/duplicate.detector';

/**
 * The composition root. Constructs and wires every service exactly once.
 * Nothing else in the codebase calls `new` on a service — they receive their
 * collaborators through this container, which is what keeps the architecture
 * testable and the dependency graph explicit.
 */
export class Container {
  public readonly prisma = prisma;
  public readonly telegram: TelegramGateway;
  public readonly adminCache: AdminCacheService;
  public readonly users: UserService;
  public readonly logs: ModerationLogService;
  public readonly warnings: WarningService;
  public readonly mutes: MuteService;
  public readonly bans: BanService;
  public readonly moderation: ModerationService;
  public readonly tagging: TaggingService;
  public readonly scheduler: SchedulerService;
  public readonly auth: AuthService;
  public readonly engine: ModerationEngine;
  public readonly bannedWords: BannedWordsDetector;

  constructor(telegramApi: Telegram) {
    // Gateways & leaf services
    this.telegram = new TelegramGateway(telegramApi);
    this.adminCache = new AdminCacheService(this.telegram);
    this.users = new UserService(prisma);
    this.logs = new ModerationLogService(prisma);
    this.warnings = new WarningService(prisma);
    this.mutes = new MuteService(prisma, this.telegram);
    this.bans = new BanService(prisma, this.telegram);
    this.auth = new AuthService(prisma);

    // Orchestrators
    this.moderation = new ModerationService(
      this.warnings,
      this.mutes,
      this.bans,
      this.logs,
      this.telegram,
    );
    this.tagging = new TaggingService(prisma, this.telegram);
    this.scheduler = new SchedulerService(prisma, this.tagging, this.mutes);

    // Detection pipeline. Order matters: high-severity scam/banned-word checks
    // run before the heuristic spam scorer and stateful flood/duplicate checks.
    this.bannedWords = new BannedWordsDetector(prisma);
    this.engine = new ModerationEngine(prisma, [
      this.bannedWords,
      new ScamLinkDetector(),
      new SpamDetector(),
      new DuplicateDetector(prisma),
      new FloodDetector(prisma),
    ]);
  }
}

export type AppContainer = Container;
