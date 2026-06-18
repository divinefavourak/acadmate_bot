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
import { AiAssistantService } from '@/services/ai-assistant.service';
import { QuizService } from '@/services/quiz.service';
import { MessageBufferService } from '@/services/message-buffer.service';
import { ErrorReporterService } from '@/services/error-reporter.service';

import { buildAiRouter } from '@/ai/ai-router.factory';
import type { AiRouter } from '@/ai/ai-router';

import { ModerationEngine } from '@/moderation/moderation.engine';
import { BannedWordsDetector } from '@/moderation/detectors/banned-words.detector';
import { ScamLinkDetector } from '@/moderation/detectors/scam-link.detector';
import { SpamDetector } from '@/moderation/detectors/spam.detector';
import { FloodDetector } from '@/moderation/detectors/flood.detector';
import { DuplicateDetector } from '@/moderation/detectors/duplicate.detector';
import { AiModerationDetector } from '@/moderation/detectors/ai-moderation.detector';

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
  public readonly aiRouter: AiRouter;
  public readonly ai: AiAssistantService;
  public readonly quiz: QuizService;
  public readonly messageBuffer: MessageBufferService;
  public readonly errorReporter: ErrorReporterService;
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
    this.messageBuffer = new MessageBufferService(prisma);
    this.errorReporter = new ErrorReporterService(this.telegram);

    // AI: failover router + high-level assistant.
    this.aiRouter = buildAiRouter();
    this.ai = new AiAssistantService(this.aiRouter);
    this.quiz = new QuizService(prisma, this.ai);

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

    // Detection pipeline. Order matters: cheap, high-confidence checks run
    // first; the AI classifier runs LAST so it's only consulted for messages
    // the heuristics didn't already flag (saving free-tier quota).
    this.bannedWords = new BannedWordsDetector(prisma);
    this.engine = new ModerationEngine(prisma, [
      this.bannedWords,
      new ScamLinkDetector(),
      new SpamDetector(),
      new DuplicateDetector(prisma),
      new FloodDetector(prisma),
      new AiModerationDetector(this.ai),
    ]);
  }
}

export type AppContainer = Container;
